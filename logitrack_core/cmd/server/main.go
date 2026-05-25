package main

import (
	"context"
	"log"
	"os"
	"strconv"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/db"
	"github.com/logitrack/core/internal/email"
	"github.com/logitrack/core/internal/handler"
	"github.com/logitrack/core/internal/mercadopago"
	"github.com/logitrack/core/internal/messaging"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/ors"
	"github.com/logitrack/core/internal/osrm"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/scheduler"
	"github.com/logitrack/core/internal/seed"
	"github.com/logitrack/core/internal/service"
	"github.com/logitrack/core/internal/sse"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	// Carga .env si existe (silenciosamente lo ignora si no está). Útil para
	// configurar localmente vars como ORS_API_KEY sin tener que exportarlas
	// en cada sesión de shell. En producción las vars vienen del entorno
	// directamente y .env no existe.
	_ = godotenv.Load()

	// PostgreSQL connection
	database, err := db.NewDB(
		getenv("DB_HOST", "localhost"),
		getenv("DB_PORT", "5432"),
		getenv("DB_USER", "logitrack"),
		getenv("DB_PASSWORD", ""),
		getenv("DB_NAME", "logitrack"),
		getenv("DB_SSLMODE", "require"),
	)
	if err != nil {
		log.Fatalf("cannot connect to database: %v", err)
	}
	if err := db.RunMigrations(database); err != nil {
		log.Fatalf("migrations failed: %v", err)
	}

	// Event store and projection for event-sourced shipment repository
	eventStore := repository.NewPostgresEventStore(database)
	shipmentProj := projection.NewPostgresShipmentProjection(database)

	// Other repositories
	authRepo := repository.NewPostgresAuthRepository(database)
	branchRepo := repository.NewPostgresBranchRepository(database)
	vehicleRepo := repository.NewPostgresVehicleRepository(database)
	routeRepo := repository.NewPostgresRouteRepository(database)
	customerRepo := repository.NewPostgresCustomerRepository(database)

	pricingConfigRepo := repository.NewPostgresPricingConfigRepository(database)
	pricingSvc := service.NewPricingService(pricingConfigRepo)
	pricingHandler := handler.NewPricingHandler(pricingSvc)

	zoneRepo := repository.NewPostgresZoneRepository(database)
	zoneSvc := service.NewZoneService(zoneRepo)
	zoneHandler := handler.NewZoneHandler(zoneSvc)
	pricingSvc.SetZoneService(zoneSvc)
	seed.LoadZones(zoneRepo)

	seed.LoadBranches(branchRepo)
	seed.LoadVehicles(vehicleRepo)
	seed.Load(eventStore, shipmentProj, customerRepo, routeRepo, branchRepo, pricingSvc)

	commentRepo := repository.NewPostgresCommentRepository(database)
	incidentRepo := repository.NewPostgresIncidentRepository(database)
	claimRepo := repository.NewPostgresClaimRepository(database)
	accessLogRepo := repository.NewPostgresAccessLogRepository(database)

	// Event-sourced shipment repository
	shipmentRepo := repository.NewEventSourcedShipmentRepository(eventStore, shipmentProj)

	statsExtendedRepo := repository.NewPostgresStatsExtendedRepository(database)

	// Branch zones (ubicaciones internas de sucursal)
	branchZoneRepo := repository.NewPostgresBranchZoneRepository(database)
	branchZoneSvc := service.NewBranchZoneService(branchZoneRepo, shipmentRepo, eventStore, shipmentProj)
	branchZoneHandler := handler.NewBranchZoneHandler(branchZoneSvc)
	inspectionHandler := handler.NewInspectionHandler(branchZoneSvc)

	// Ensure zones exist for every active branch (idempotent)
	for _, b := range branchRepo.List() {
		if b.Status == model.BranchStatusActive {
			if err := branchZoneSvc.EnsureZonesForBranch(b.ID); err != nil {
				log.Printf("[startup] error asegurando zonas para sucursal %s: %v", b.ID, err)
			}
		}
	}

	// Services & handlers
	modelPath := os.Getenv("ML_MODEL_PATH")
	if modelPath == "" {
		modelPath = "model.json"
	}
	mlClient := service.NewMLService(modelPath)

	// ML config: load active config and model from DB (falls back to file-based model if none)
	mlConfigRepo := repository.NewPostgresMLConfigRepository(database)
	mlConfigSvc := service.NewMLConfigService(mlConfigRepo, mlClient, shipmentRepo, database)
	mlConfigSvc.InitFromDB()
	mlConfigHandler := handler.NewMLConfigHandler(mlConfigSvc)

	orgRepo := repository.NewPostgresOrganizationRepository(database)
	orgSvc := service.NewOrganizationService(orgRepo)
	orgHandler := handler.NewOrganizationHandler(orgSvc)

	sysConfigRepo := repository.NewPostgresSystemConfigRepository(database)
	sysConfigSvc := service.NewSystemConfigService(sysConfigRepo)
	sysConfigHandler := handler.NewSystemConfigHandler(sysConfigSvc)
	draftLifecycleRepo := repository.NewPostgresDraftLifecycleRepository(database)
	draftLifecycleSvc := service.NewDraftLifecycleService(draftLifecycleRepo, sysConfigSvc)
	draftLifecycleHandler := handler.NewDraftLifecycleHandler(draftLifecycleSvc)
	draftScheduler := service.NewDraftScheduler(draftLifecycleSvc)
	draftScheduler.Start()

	// Mercado Pago — nil cuando no está configurado (dev sin MP)
	mpClient := mercadopago.NewClient(
		os.Getenv("MP_ACCESS_TOKEN"),
		os.Getenv("MP_WEBHOOK_SECRET"),
		getenv("MP_NOTIFICATION_URL", ""),
	)
	if mpClient != nil {
		log.Println("[mercadopago] cliente configurado — webhooks activos")
	} else {
		log.Println("[mercadopago] MP_ACCESS_TOKEN no configurado — integración real deshabilitada")
	}
	// Cuando el reloj cambia, re-ejecutar los jobs de ciclo de vida para que la
	// expiración/purga se aplique inmediatamente con el nuevo timestamp.
	// También se dispara el chequeo de SLA en riesgo/vencido para que las
	// notificaciones reflejen el nuevo momento sin esperar al siguiente plan.
	// slaRiskChecker se asigna más abajo, después de crear routingSvc.
	var slaRiskChecker func()
	clockHandler := handler.NewClockHandler(func() {
		draftLifecycleSvc.RunExpirationJob()
		draftLifecycleSvc.RunPurgeJob()
		if slaRiskChecker != nil {
			slaRiskChecker()
		}
	})

	routingCfgRepo := repository.NewPostgresRoutingConfigRepository(database)
	routingCfgSvc := service.NewRoutingConfigService(routingCfgRepo)
	routingCfgHandler := handler.NewRoutingConfigHandler(routingCfgSvc)

	fatigueConfigRepo := repository.NewFatigueConfigRepository()
	fatigueConfigSvc := service.NewFatigueConfigService(fatigueConfigRepo)
	auditLogRepo := repository.NewAuditLogRepository()
	fatigueConfigHandler := handler.NewFatigueConfigHandler(fatigueConfigSvc, auditLogRepo)
	supervisorFatigueHandler := handler.NewSupervisorFatigueHandler(authRepo, fatigueConfigSvc)

	commentSvc := service.NewCommentService(commentRepo, shipmentRepo)
	incidentSvc := service.NewIncidentService(incidentRepo, shipmentRepo, eventStore, shipmentProj)
	claimEventRepo := repository.NewPostgresClaimEventRepository(database)
	claimSvc := service.NewClaimService(claimRepo, claimEventRepo, shipmentRepo, eventStore)
	shipmentSvc := service.NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, mlClient)
	shipmentSvc.SetSystemConfig(sysConfigSvc)
	shipmentSvc.SetPricingService(pricingSvc)
	branchZoneSvc.SetShipmentService(shipmentSvc)
	paymentRepo := repository.NewPostgresPaymentRepository(database)
	paymentSvc := service.NewPaymentService(paymentRepo, shipmentSvc, mpClient)
	paymentHandler := handler.NewPaymentHandler(paymentSvc, mpClient, shipmentSvc)
	paymentScheduler := service.NewPaymentScheduler(paymentSvc)
	paymentScheduler.Start()

	notifRepo := repository.NewPostgresNotificationRepository(database)
	notifSvc := service.NewNotificationService(notifRepo)
	notifHub := sse.NewHub()
	notifSvc.SetHub(notifHub)
	notifHandler := handler.NewNotificationHandler(notifSvc, notifHub)
	shipmentSvc.SetNotificationService(notifSvc)

	// Email transaccional — deshabilitado cuando SMTP_HOST no está configurado.
	smtpPort := 587
	if p := os.Getenv("SMTP_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			smtpPort = n
		}
	}
	emailSvc := email.New(email.Config{
		Host:         os.Getenv("SMTP_HOST"),
		Port:         smtpPort,
		Username:     os.Getenv("SMTP_USER"),
		Password:     os.Getenv("SMTP_PASS"),
		From:         getenv("SMTP_FROM", os.Getenv("SMTP_USER")),
		TrackBaseURL: os.Getenv("TRACK_BASE_URL"),
	}, orgSvc)
	if emailSvc != nil {
		shipmentSvc.SetEmailService(emailSvc)
		log.Printf("[email] servicio SMTP habilitado — host: %s:%d", os.Getenv("SMTP_HOST"), smtpPort)
	} else {
		log.Println("[email] SMTP_HOST no configurado — emails deshabilitados")
	}

	// Mensajería — WhatsApp (Twilio) con fallback a email para última milla y retiro en sucursal.
	messagingSvc := messaging.New(
		os.Getenv("TWILIO_ACCOUNT_SID"),
		os.Getenv("TWILIO_AUTH_TOKEN"),
		os.Getenv("TWILIO_WHATSAPP_FROM"),
		os.Getenv("TRACK_BASE_URL"),
		emailSvc,
		routingCfgSvc,
	)
	messagingSvc.SetPickupEmailFallback(emailSvc)            // email fallback para ready_for_pickup
	messagingSvc.SetDeliveryConfirmedEmailFallback(emailSvc) // email fallback para entrega confirmada
	messagingSvc.SetRejectedEmailFallback(emailSvc)          // email fallback para rechazo (LOGITRACK-429)
	messagingSvc.SetDeliveryFailedEmailService(emailSvc)     // email siempre (+ WhatsApp si tiene tel) para entrega fallida (LOGITRACK-437)
	shipmentSvc.SetWhatsAppConfirmationService(messagingSvc) // confirmación al registrar envío (LOGITRACK-406)
	shipmentSvc.SetMessagingService(messagingSvc)
	shipmentSvc.SetReadyForPickupEmailService(messagingSvc)  // WhatsApp primero, email fallback
	shipmentSvc.SetDeliveryConfirmedService(messagingSvc)    // WhatsApp primero, email fallback (CA-01/CA-02)
	shipmentSvc.SetRejectedService(messagingSvc)             // WhatsApp primero, email fallback (LOGITRACK-429)
	shipmentSvc.SetDeliveryFailedService(messagingSvc)       // email siempre + WhatsApp si tiene tel (LOGITRACK-437)
	if os.Getenv("TWILIO_ACCOUNT_SID") != "" {
		log.Printf("[messaging] WhatsApp habilitado — from: %s", os.Getenv("TWILIO_WHATSAPP_FROM"))
	} else {
		log.Println("[messaging] Twilio no configurado — WhatsApp deshabilitado (usará email como fallback si SMTP configurado)")
	}

	routeSvc := service.NewRouteService(routeRepo, shipmentRepo)
	branchSvc := service.NewBranchService(branchRepo, shipmentProj)
	branchSvc.SetBranchZoneService(branchZoneSvc)
	branchHandler := handler.NewBranchHandler(branchSvc)
	shipmentHandler := handler.NewShipmentHandler(shipmentSvc, routeSvc, commentSvc, branchSvc, claimSvc)
	chatbotHandler := handler.NewChatbotHandler(shipmentRepo, branchRepo, notifSvc)
	qrHandler := handler.NewQRHandler(shipmentSvc)
	commentHandler := handler.NewCommentHandler(commentSvc, shipmentSvc)
	incidentHandler := handler.NewIncidentHandler(incidentSvc, shipmentSvc)
	claimHandler := handler.NewClaimHandler(claimSvc)
	authHandler := handler.NewAuthHandler(authRepo, accessLogRepo)
	accessLogHandler := handler.NewAccessLogHandler(accessLogRepo)
	vehicleHandler := handler.NewVehicleHandler(vehicleRepo, shipmentSvc, branchRepo)
	vehicleHandler.SetBranchZoneService(branchZoneSvc)
	driverHandler := handler.NewDriverHandler(routeSvc, branchRepo, fatigueConfigSvc, auditLogRepo, notifSvc)
	userSvc := service.NewUserService(authRepo, branchRepo)
	userHandler := handler.NewUserHandler(authRepo, userSvc)
	adminHandler := handler.NewAdminHandler(authRepo)
	customerHandler := handler.NewCustomerHandler(customerRepo)

	statsExtendedSvc := service.NewStatsExtendedService(statsExtendedRepo, branchRepo)
	statsExtendedHandler := handler.NewStatsExtendedHandler(statsExtendedSvc)

	// OSRM público (sin SLA, dev-only). Si falla, el VRP cae automáticamente
	// a Haversine. Para producción conviene self-hostear y cambiar la URL.
	osrmClient := osrm.NewClient("https://router.project-osrm.org")
	// OpenRouteService — opcional. Cuando hay ORS_API_KEY se usa para el modo
	// segura (avoid_polygons nativo). Sin la key, segura cae al fallback de
	// OSRM con waypoints de bordeado.
	orsClient := ors.NewClient(os.Getenv("ORS_BASE_URL"), os.Getenv("ORS_API_KEY"))
	if orsClient != nil {
		log.Printf("[routing] OpenRouteService HABILITADO — modo segura usará avoid_polygons nativo")
	} else {
		log.Printf("[routing] OpenRouteService DESHABILITADO (sin ORS_API_KEY) — modo segura usará fallback OSRM + waypoints")
	}
	interBranchTripRepo := repository.NewPostgresInterBranchTripRepository(database)
	interBranchTripSvc := service.NewInterBranchTripService(interBranchTripRepo, vehicleRepo, branchRepo, authRepo, shipmentSvc)
	interBranchTripSvc.SetRouteService(routeSvc)
	interBranchTripSvc.SetNotificationService(notifSvc)
	interBranchTripHandler := handler.NewInterBranchTripHandler(interBranchTripSvc)
	vehicleHandler.SetTripService(interBranchTripSvc)

	routingPlanRepo := repository.NewPostgresRoutingPlanRepository(database)
	routingSvc := service.NewRoutingService(routingCfgSvc, shipmentRepo, vehicleRepo, branchRepo, authRepo, routeSvc, shipmentSvc, routingPlanRepo, osrmClient)
	routingSvc.SetInterBranchTripService(interBranchTripSvc)
	routingSvc.SetZoneService(zoneSvc)
	routingSvc.SetBranchZoneService(branchZoneSvc)
	routingSvc.SetORSClient(orsClient)
	routingSvc.SetNotificationService(notifSvc)
	slaRiskChecker = routingSvc.RunSLARiskCheck // conecta el reloj admin con el chequeo de SLA

	// LOGITRACK-409: volumen mínimo de despacho — checker + dedup persistida en DB.
	dispatchVolumeRepo := repository.NewPostgresDispatchVolumeRepository(database)
	dispatchVolumeChecker := service.NewDispatchVolumeChecker(
		shipmentRepo, vehicleRepo, branchRepo, dispatchVolumeRepo, notifRepo, routingCfgSvc,
	)
	dispatchVolumeChecker.SetHub(notifHub)
	shipmentSvc.SetDispatchVolumeService(dispatchVolumeChecker)
	routingSvc.SetDispatchVolumeService(dispatchVolumeChecker)
	vehicleHandler.SetDispatchVolumeService(dispatchVolumeChecker)

	// Evaluar volumen existente en la DB al arrancar (envíos cargados vía seed o
	// acumulados antes del deploy de LOGITRACK-409).
	go func() {
		for _, b := range branchRepo.List() {
			dispatchVolumeChecker.Check(b.ID)
		}
	}()

	// Branch graph: necesario para multi-hop (addMultiHopStops, addCrossBranchPickups,
	// consolidateCrossBranchDispatches). El seed inicializa aristas auto-derivadas
	// del grafo de sucursales.
	branchGraphRepo := repository.NewPostgresBranchGraphRepository(database)
	branchGraphSvc := service.NewBranchGraphService(branchGraphRepo, branchRepo)
	seed.LoadBranchGraph(branchGraphRepo, branchRepo)
	routingSvc.SetBranchGraphService(branchGraphSvc)
	shipmentSvc.SetBranchGraphService(branchGraphSvc)

	routingHandler := handler.NewRoutingHandler(routingSvc)

	// Generar plan global al arrancar solo si no existe uno para hoy,
	// para no sobreescribir un plan ya aplicado entre reinicios del servidor.
	{
		local := clock.Now().In(clock.LocalTZ)
		planDate := local.Format("2006-01-02")
		existing, err := routingPlanRepo.GetByDate(planDate)
		if err != nil {
			log.Fatalf("no se pudo verificar plan existente: %v", err)
		}
		if existing == nil {
			if _, err := routingSvc.GenerateAndPersistGlobalPlan(context.Background()); err != nil {
				log.Fatalf("no se pudo generar el plan inicial: %v", err)
			}
			log.Println("[startup] plan global del día generado correctamente")
		} else {
			log.Printf("[startup] plan del día ya existe (status: %s), no se regenera", existing.Status)
		}
	}

	// Scheduler: genera el plan global de ruteo todos los días a las 08:00 ART.
	sched := scheduler.New(routingSvc)
	if err := sched.Start(); err != nil {
		log.Fatalf("error iniciando scheduler: %v", err)
	}
	defer sched.Stop()

	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
	}))

	api := r.Group("/api/v1")

	// Public routes
	authHandler.RegisterRoutes(api)
	api.POST("/webhooks/mercadopago", paymentHandler.Webhook)

	// Protected routes
	protected := api.Group("")
	protected.Use(middleware.Auth(authRepo))

	protected.GET("/auth/me", authHandler.Me)

	// Role groups
	// Admin manages configuration only — never participates in operational shipment flows.
	adminOnly := middleware.RequireRoles(model.RoleAdmin)
	authenticated := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin, model.RoleDriver)
	// Management screens (branches, fleet config, customers list) — admin included.
	mgmtNonDriver := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	// Operational shipment access — admin EXCLUDED.
	shipmentRead := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager)
	shipmentDetailRead := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleDriver)
	shipmentWrite := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor)
	claimRead := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager)
	claimWrite := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor)

	// Branches — list/search: management roles incl. admin, create/update/status: admin only, capacity: management roles
	canManageBranch := middleware.RequireRoles(model.RoleAdmin)
	protected.GET("/branches", mgmtNonDriver, branchHandler.List)
	protected.GET("/branches/search", mgmtNonDriver, branchHandler.Search)
	protected.POST("/branches", canManageBranch, branchHandler.Create)
	protected.PATCH("/branches/:id", canManageBranch, branchHandler.Update)
	protected.PATCH("/branches/:id/status", canManageBranch, branchHandler.UpdateStatus)
	protected.GET("/branches/:id/capacity", mgmtNonDriver, branchHandler.GetCapacity)

	// Vehicles — fleet management: list/create/admin actions include admin; operational vehicle actions exclude admin.
	protected.GET("/vehicles", mgmtNonDriver, vehicleHandler.List)
	canViewVehicle := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	canViewAvailableVehicles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager)
	canChangeVehicleStatus := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.GET("/vehicles/available", canViewAvailableVehicles, vehicleHandler.ListAvailable)
	protected.POST("/vehicles", adminOnly, vehicleHandler.Create)
	protected.GET("/vehicles/by-plate/:plate", canViewVehicle, vehicleHandler.GetByPlate)
	protected.GET("/vehicles/by-shipment/:trackingId", shipmentDetailRead, vehicleHandler.GetByShipment)
	protected.PATCH("/vehicles/by-plate/:plate/status", canChangeVehicleStatus, vehicleHandler.UpdateStatusByPlate)
	protected.POST("/vehicles/by-plate/:plate/assign", shipmentWrite, vehicleHandler.AssignToShipment)
	protected.POST("/vehicles/by-plate/:plate/assign-branch", adminOnly, vehicleHandler.AssignBranch)
	protected.POST("/vehicles/by-plate/:plate/start-trip", shipmentWrite, vehicleHandler.StartTrip)
	protected.POST("/vehicles/by-plate/:plate/end-trip", shipmentWrite, vehicleHandler.EndTrip)
	protected.DELETE("/vehicles/by-plate/:plate/shipments/:trackingId", shipmentWrite, vehicleHandler.UnassignShipment)

	// Shipments — admin EXCLUDED from every shipment-related route (read and write).
	protected.GET("/shipments", shipmentRead, shipmentHandler.List)
	protected.GET("/search", shipmentRead, shipmentHandler.Search)
	protected.GET("/shipments/:tracking_id", shipmentDetailRead, shipmentHandler.GetByTrackingID)
	protected.GET("/shipments/:tracking_id/events", shipmentDetailRead, shipmentHandler.GetEvents)

	// QR generation — same scope as shipment detail
	protected.GET("/shipments/:tracking_id/qr", shipmentDetailRead, qrHandler.GenerateShipmentQR)
	protected.GET("/shipments/:tracking_id/qr/download", shipmentDetailRead, qrHandler.DownloadShipmentQR)

	// Create / draft shipment — operator, supervisor
	protected.POST("/shipments", shipmentWrite, shipmentHandler.Create)
	protected.POST("/shipments/draft", shipmentWrite, shipmentHandler.SaveDraft)
	protected.PATCH("/shipments/:tracking_id/draft", shipmentWrite, shipmentHandler.UpdateDraft)

	// Payment flow — operator, supervisor
	protected.POST("/shipments/:tracking_id/request-payment", shipmentWrite, paymentHandler.RequestPayment)
	protected.POST("/shipments/:tracking_id/back-to-draft", shipmentWrite, paymentHandler.BackToDraft)
	protected.GET("/shipments/:tracking_id/payment", shipmentDetailRead, paymentHandler.GetPayment)
	protected.GET("/shipments/:tracking_id/payment/qr", shipmentDetailRead, paymentHandler.GeneratePaymentQR)
	protected.POST("/shipments/:tracking_id/cash-payment", shipmentWrite, paymentHandler.ConfirmCashPayment)

	// Comments — read: shipment-detail roles, write: operator/supervisor
	protected.GET("/shipments/:tracking_id/comments", shipmentDetailRead, commentHandler.GetComments)
	protected.POST("/shipments/:tracking_id/comments", shipmentWrite, commentHandler.AddComment)

	// Incidents — read: shipment-detail roles, write: operator/supervisor
	protected.GET("/shipments/:tracking_id/incidents", shipmentDetailRead, incidentHandler.GetIncidents)
	protected.POST("/shipments/:tracking_id/incidents", shipmentWrite, incidentHandler.ReportIncident)

	// Claims — list/detail/derive/resolve for operator/supervisor
	protected.GET("/claims", claimRead, claimHandler.ListClaims)
	protected.GET("/claims/:id", claimRead, claimHandler.GetClaim)
	protected.GET("/claims/:id/events", claimRead, claimHandler.GetClaimEvents)
	protected.GET("/claims/:id/evidence/download", claimRead, claimHandler.DownloadClaimEvidence)
	protected.PATCH("/claims/:id/category", claimWrite, claimHandler.UpdateClaimCategory)
	protected.POST("/claims/:id/resolve", claimWrite, claimHandler.ResolveClaim)
	protected.POST("/claims/:id/request-info", claimWrite, claimHandler.RequestCustomerInfo)
	protected.POST("/claims/:id/review", claimWrite, claimHandler.MarkClaimInReview)

	// Correct / cancel shipment — operator, supervisor (branch check enforced in handler/service)
	protected.PATCH("/shipments/:tracking_id/correct", shipmentWrite, shipmentHandler.CorrectShipment)
	protected.POST("/shipments/:tracking_id/cancel", shipmentWrite, shipmentHandler.CancelShipment)

	// Change status — operator, supervisor, driver (driver further restricted in handler)
	canChangeStatus := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleDriver)
	protected.PATCH("/shipments/:tracking_id/status", canChangeStatus, shipmentHandler.UpdateStatus)

	// Bulk status update — operator, supervisor
	protected.POST("/shipments/bulk-status", shipmentWrite, shipmentHandler.BulkUpdateStatus)

	// Stats / dashboard — supervisor, manager
	canViewStats := middleware.RequireRoles(model.RoleSupervisor, model.RoleManager)
	protected.GET("/stats", canViewStats, shipmentHandler.Stats)
	protected.GET("/stats/detail", canViewStats, shipmentHandler.StatsDetail)
	protected.GET("/stats/cancellations", canViewStats, shipmentHandler.CancellationStats)
	protected.GET("/stats/avg-time-per-status", canViewStats, shipmentHandler.AvgTimePerStatus)
	protected.GET("/stats/driver-performance", canViewStats, statsExtendedHandler.DriverPerformance)
	protected.GET("/stats/incidents-by-branch", canViewStats, statsExtendedHandler.IncidentsByBranch)
	protected.GET("/stats/billing-metrics", canViewStats, statsExtendedHandler.BillingMetrics)
	protected.GET("/stats/branch-ranking", canViewStats, statsExtendedHandler.BranchRanking)
	protected.GET("/stats/volume-by-time-window", canViewStats, statsExtendedHandler.VolumeByTimeWindow)
	protected.GET("/stats/return-metrics", canViewStats, statsExtendedHandler.ReturnMetrics)
	protected.GET("/stats/success-rate-by-branch", canViewStats, statsExtendedHandler.SuccessRateByBranch)
	protected.GET("/supervisor/fatigue-dashboard", canViewStats, supervisorFatigueHandler.GetDashboard)

	// Driver route — driver only
	driverOnly := middleware.RequireRoles(model.RoleDriver)
	protected.GET("/driver/route", driverOnly, driverHandler.GetRoute)
	protected.POST("/driver/route/start", driverOnly, driverHandler.StartRoute)
	protected.GET("/driver/checkin/today", driverOnly, driverHandler.GetTodayCheckin)
	protected.POST("/driver/checkin", driverOnly, driverHandler.SubmitCheckin)
	protected.POST("/driver/checkin/skip", driverOnly, driverHandler.SkipCheckin)
	protected.POST("/driver/pvt-test", driverOnly, driverHandler.SubmitPVT)                 // US6: PVT mini-game
	protected.POST("/driver/touch-events", driverOnly, driverHandler.SubmitTouchEvent)      // US4: tactile events
	protected.GET("/driver/test-eligibility", driverOnly, driverHandler.GetTestEligibility) // US4+: re-test gate
	protected.POST("/driver/reset-misfires", driverOnly, driverHandler.ResetMisfires)       // US4+: reset per-package misfire counter
	protected.GET("/driver/control-phrase", driverOnly, driverHandler.GetControlPhrase)
	protected.POST("/driver/voice-upload", driverOnly, driverHandler.UploadVoice)
	protected.POST("/dev/simulator/fast-forward-time", driverOnly, driverHandler.FastForwardCheckinTime) // DEV: simula paso de 2h

	// Inter-branch trips — driver self-service + operator/supervisor receive
	protected.GET("/driver/inter-branch-trip", driverOnly, interBranchTripHandler.GetMyTrip)
	protected.POST("/inter-branch-trips/:id/start", driverOnly, interBranchTripHandler.StartTrip)
	protected.GET("/inter-branch-trips/:id", shipmentRead, interBranchTripHandler.GetTripByID)
	protected.GET("/inter-branch-trips/:id/qr", shipmentDetailRead, interBranchTripHandler.GetTripQR)
	protected.POST("/inter-branch-trips/:id/scan/finish", shipmentWrite, interBranchTripHandler.FinishByScan)
	protected.POST("/inter-branch-trips/:id/stops/:idx/unload", shipmentWrite, interBranchTripHandler.ConfirmUnload)
	protected.POST("/inter-branch-trips/:id/stops/:idx/load", shipmentWrite, interBranchTripHandler.ConfirmLoad)
	protected.POST("/inter-branch-trips/:id/assign-driver", shipmentWrite, interBranchTripHandler.AssignDriver)
	protected.POST("/inter-branch-trips/:id/cancel", middleware.RequireRoles(model.RoleSupervisor), interBranchTripHandler.Cancel)
	protected.GET("/inter-branch-trips", shipmentRead, interBranchTripHandler.ListByBranch)
	// QR-based vehicle claim (driver) and close (operator/supervisor)
	protected.POST("/trips/claim-by-qr", driverOnly, interBranchTripHandler.ClaimByVehicleQR)
	protected.POST("/trips/close-by-qr", shipmentWrite, interBranchTripHandler.CloseByVehicleQR)

	// Vehicle QR management
	canViewVehicleQR := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/vehicles/by-plate/:plate/qr", canViewVehicleQR, vehicleHandler.GetVehicleQR)

	// Users — list drivers (operator, supervisor) for shipment assignment
	protected.GET("/users/drivers", shipmentWrite, userHandler.ListDrivers)
	protected.GET("/users/me", authenticated, userHandler.GetMe)
	protected.POST("/users/me/password", authenticated, userHandler.ChangePassword)

	// Customers — autocomplete by DNI used during shipment creation
	protected.GET("/customers", shipmentWrite, customerHandler.GetByDNI)

	// Organization config — read: all authenticated, write: admin only
	protected.GET("/organization", authenticated, orgHandler.Get)
	protected.PUT("/organization", adminOnly, orgHandler.Update)

	// System config — admin only
	protected.GET("/system/config", adminOnly, sysConfigHandler.Get)
	protected.PATCH("/system/config", adminOnly, sysConfigHandler.Update)

	// System clock override — GET is open to all authenticated users (read-only, safe).
	// PATCH/DELETE are admin-only (mutations).
	protected.GET("/admin/clock", clockHandler.Get)
	protected.PATCH("/admin/clock", adminOnly, clockHandler.Set)
	protected.DELETE("/admin/clock", adminOnly, clockHandler.Clear)

	// Fatigue model configuration — admin only, persisted to data/fatigue_config.json.
	protected.GET("/admin/fatigue-config", adminOnly, fatigueConfigHandler.Get)
	protected.PUT("/admin/fatigue-config", adminOnly, fatigueConfigHandler.Update)
	protected.POST("/admin/fatigue-config/reset-checkins", adminOnly, fatigueConfigHandler.ResetCheckins)
	// Audit logs — strictly GET only. No DELETE/PUT (immutability enforced, AC2).
	protected.GET("/admin/audit-logs", adminOnly, fatigueConfigHandler.ListAuditLogs)
	// Draft lifecycle / compliance (Ley 25.326) — admin only
	protected.GET("/admin/compliance/audit", adminOnly, draftLifecycleHandler.GetAuditLog)
	protected.GET("/admin/compliance/drafts", adminOnly, draftLifecycleHandler.FindByDNI)
	protected.POST("/admin/compliance/suppress", adminOnly, draftLifecycleHandler.Suppress)
	protected.POST("/admin/compliance/expire-drafts", adminOnly, draftLifecycleHandler.TriggerExpiration)
	protected.POST("/admin/compliance/purge-pii", adminOnly, draftLifecycleHandler.TriggerPurge)

	// Pricing — quote belongs to the shipment-creation flow (operator/supervisor); config is admin-only
	protected.POST("/pricing/quote", shipmentWrite, pricingHandler.Quote)
	protected.GET("/pricing/config", adminOnly, pricingHandler.GetConfig)
	protected.PATCH("/pricing/config", adminOnly, pricingHandler.UpdateConfig)

	// Notifications — standard routes on the protected group.
	notifHandler.RegisterRoutes(protected, authenticated)
	// SSE stream is registered on the public api group (not protected) so the
	// group-level header-only Auth middleware doesn't block EventSource clients.
	// sseAuth validates the token from ?token= query param as a fallback.
	sseAuth := middleware.AuthWithQueryParam(authRepo)
	notifHandler.RegisterStreamRoute(api, sseAuth)

	// Zones — read: all authenticated; write: admin only
	protected.GET("/zones", authenticated, zoneHandler.List)
	protected.POST("/zones", adminOnly, zoneHandler.Create)
	protected.PATCH("/zones/:id", adminOnly, zoneHandler.Update)
	protected.DELETE("/zones/:id", adminOnly, zoneHandler.Delete)

	// Branch zones — read: all authenticated, move: operator/supervisor
	protected.GET("/branches/:id/zones", authenticated, branchZoneHandler.ListZones)
	protected.POST("/shipments/:tracking_id/move-zone", shipmentWrite, branchZoneHandler.MoveZone)

	// Inspection (supervisor-only) — approve from Revision or classify lost/destroyed
	supervisorOnly := middleware.RequireRoles(model.RoleSupervisor)
	protected.POST("/shipments/:tracking_id/approve-revision", supervisorOnly, inspectionHandler.ApproveFromRevision)
	protected.POST("/shipments/:tracking_id/classify", supervisorOnly, inspectionHandler.Classify)

	// Routing — operativo (operator + supervisor restringido por sucursal en handler); config admin-only.
	protected.GET("/routing/config", adminOnly, routingCfgHandler.Get)
	protected.PATCH("/routing/config", adminOnly, routingCfgHandler.Update)
	protected.GET("/routing/plan/today", shipmentRead, routingHandler.GetTodayPlan)
	protected.POST("/routing/regenerate", shipmentWrite, routingHandler.Regenerate)          // operator+supervisor: su sucursal
	protected.POST("/routing/regenerate/global", adminOnly, routingHandler.RegenerateGlobal) // admin: toda la red
	protected.POST("/routing/apply", shipmentWrite, routingHandler.Apply)
	protected.POST("/routing/last-mile/recompute", shipmentWrite, routingHandler.RecomputeLastMile)

	// ML config — admin only
	protected.GET("/admin/users", adminOnly, adminHandler.ListUsers)
	protected.POST("/admin/users", adminOnly, adminHandler.CreateUser)
	protected.PATCH("/admin/users/:id", adminOnly, adminHandler.UpdateUser)
	protected.GET("/ml/config", adminOnly, mlConfigHandler.GetActive)
	protected.GET("/ml/config/history", adminOnly, mlConfigHandler.ListHistory)
	protected.POST("/ml/config/regenerate", adminOnly, mlConfigHandler.Regenerate)
	protected.POST("/ml/config/:id/activate", adminOnly, mlConfigHandler.Activate)
	protected.GET("/admin/access-logs", adminOnly, accessLogHandler.List)

	// Public tracking — no auth required. Dedicated handlers return a redacted
	// view (no personal data) and 404 on drafts.
	publicAPI := api.Group("/public")
	publicAPI.GET("/track/:tracking_id", shipmentHandler.GetPublicByTrackingID)
	publicAPI.GET("/track/:tracking_id/events", shipmentHandler.GetPublicEvents)
	publicAPI.GET("/branches", branchHandler.List)
	publicAPI.GET("/stats", shipmentHandler.PublicStats)
	publicAPI.POST("/claims", claimHandler.CreatePublicClaim)
	publicAPI.GET("/claims/:id", claimHandler.GetPublicClaim)

	publicAPI.GET("/track/:tracking_id/qr", qrHandler.GenerateShipmentQR)
	chatbotHandler.RegisterRoutes(publicAPI)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("LogiTrack API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
