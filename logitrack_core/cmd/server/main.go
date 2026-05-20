package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/logitrack/core/internal/db"
	"github.com/logitrack/core/internal/handler"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/mercadopago"
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
	accessLogRepo := repository.NewPostgresAccessLogRepository(database)

	// Event-sourced shipment repository
	shipmentRepo := repository.NewEventSourcedShipmentRepository(eventStore, shipmentProj)

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
	if mpClient == nil {
		log.Println("[mercadopago] MP_ACCESS_TOKEN no configurado — pagos deshabilitados")
	}

	// Cuando el reloj cambia, re-ejecutar los jobs de ciclo de vida para que la
	// expiración/purga se aplique inmediatamente con el nuevo timestamp.
	clockHandler := handler.NewClockHandler(func() {
		draftLifecycleSvc.RunExpirationJob()
		draftLifecycleSvc.RunPurgeJob()
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
	shipmentSvc := service.NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, mlClient)
	shipmentSvc.SetSystemConfig(sysConfigSvc)
	shipmentSvc.SetPricingService(pricingSvc)
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
	routeSvc := service.NewRouteService(routeRepo, shipmentRepo)
	branchSvc := service.NewBranchService(branchRepo, shipmentProj)
	branchHandler := handler.NewBranchHandler(branchSvc)
	shipmentHandler := handler.NewShipmentHandler(shipmentSvc, routeSvc, commentSvc, branchSvc)
	qrHandler := handler.NewQRHandler(shipmentSvc)
	commentHandler := handler.NewCommentHandler(commentSvc, shipmentSvc)
	incidentHandler := handler.NewIncidentHandler(incidentSvc, shipmentSvc)
	authHandler := handler.NewAuthHandler(authRepo, accessLogRepo)
	accessLogHandler := handler.NewAccessLogHandler(accessLogRepo)
	vehicleHandler := handler.NewVehicleHandler(vehicleRepo, shipmentSvc, branchRepo)
	driverHandler := handler.NewDriverHandler(routeSvc, branchRepo, fatigueConfigSvc, auditLogRepo)
	userSvc := service.NewUserService(authRepo, branchRepo)
	userHandler := handler.NewUserHandler(authRepo, userSvc)
	adminHandler := handler.NewAdminHandler(authRepo)
	customerHandler := handler.NewCustomerHandler(customerRepo)

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
	interBranchTripHandler := handler.NewInterBranchTripHandler(interBranchTripSvc)
	vehicleHandler.SetTripService(interBranchTripSvc)

	routingPlanRepo := repository.NewPostgresRoutingPlanRepository(database)
	routingSvc := service.NewRoutingService(routingCfgSvc, shipmentRepo, vehicleRepo, branchRepo, authRepo, routeSvc, shipmentSvc, routingPlanRepo, osrmClient)
	routingSvc.SetInterBranchTripService(interBranchTripSvc)
	routingSvc.SetZoneService(zoneSvc)
	routingSvc.SetORSClient(orsClient)

	// Branch graph: necesario para multi-hop (addMultiHopStops, addCrossBranchPickups,
	// consolidateCrossBranchDispatches). El seed inicializa aristas auto-derivadas
	// del grafo de sucursales.
	branchGraphRepo := repository.NewPostgresBranchGraphRepository(database)
	branchGraphSvc := service.NewBranchGraphService(branchGraphRepo, branchRepo)
	seed.LoadBranchGraph(branchGraphRepo, branchRepo)
	routingSvc.SetBranchGraphService(branchGraphSvc)
	shipmentSvc.SetBranchGraphService(branchGraphSvc)

	routingHandler := handler.NewRoutingHandler(routingSvc)

	// Generar plan global al arrancar para que el plan del día esté disponible
	// desde el primer request, sin esperar el cron de las 08:00.
	if _, err := routingSvc.RegenerateTodayPlan(context.Background()); err != nil {
		log.Fatalf("no se pudo generar el plan inicial: %v", err)
	}
	log.Println("[startup] plan global del día generado correctamente")

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
	protected.POST("/shipments/:tracking_id/confirm", shipmentWrite, shipmentHandler.ConfirmDraft)

	// Payment flow — operator, supervisor
	protected.POST("/shipments/:tracking_id/request-payment", shipmentWrite, paymentHandler.RequestPayment)
	protected.POST("/shipments/:tracking_id/back-to-draft", shipmentWrite, paymentHandler.BackToDraft)
	protected.GET("/shipments/:tracking_id/payment", shipmentDetailRead, paymentHandler.GetPayment)
	protected.GET("/shipments/:tracking_id/payment/qr", shipmentDetailRead, paymentHandler.GeneratePaymentQR)
	protected.POST("/shipments/:tracking_id/simulate-payment", shipmentWrite, paymentHandler.SimulatePayment)

	// Comments — read: shipment-detail roles, write: operator/supervisor
	protected.GET("/shipments/:tracking_id/comments", shipmentDetailRead, commentHandler.GetComments)
	protected.POST("/shipments/:tracking_id/comments", shipmentWrite, commentHandler.AddComment)

	// Incidents — read: shipment-detail roles, write: operator/supervisor
	protected.GET("/shipments/:tracking_id/incidents", shipmentDetailRead, incidentHandler.GetIncidents)
	protected.POST("/shipments/:tracking_id/incidents", shipmentWrite, incidentHandler.ReportIncident)

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
	protected.GET("/supervisor/fatigue-dashboard", canViewStats, supervisorFatigueHandler.GetDashboard)

	// Driver route — driver only
	driverOnly := middleware.RequireRoles(model.RoleDriver)
	protected.GET("/driver/route", driverOnly, driverHandler.GetRoute)
	protected.POST("/driver/route/start", driverOnly, driverHandler.StartRoute)
	protected.GET("/driver/checkin/today", driverOnly, driverHandler.GetTodayCheckin)
	protected.POST("/driver/checkin", driverOnly, driverHandler.SubmitCheckin)
	protected.POST("/driver/checkin/skip", driverOnly, driverHandler.SkipCheckin)
	protected.POST("/driver/pvt-test", driverOnly, driverHandler.SubmitPVT)         // US6: PVT mini-game
	protected.POST("/driver/touch-events", driverOnly, driverHandler.SubmitTouchEvent) // US4: tactile events
	protected.GET("/driver/control-phrase", driverOnly, driverHandler.GetControlPhrase)
	protected.POST("/driver/voice-upload", driverOnly, driverHandler.UploadVoice)

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

	// Routing — operativo (operator + supervisor restringido por sucursal en handler); config admin-only.
	protected.GET("/routing/config", adminOnly, routingCfgHandler.Get)
	protected.PATCH("/routing/config", adminOnly, routingCfgHandler.Update)
	protected.GET("/routing/plan/today", shipmentRead, routingHandler.GetTodayPlan)
	protected.POST("/routing/regenerate", shipmentWrite, routingHandler.Regenerate)         // operator+supervisor: su sucursal
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

	publicAPI.GET("/track/:tracking_id/qr", qrHandler.GenerateShipmentQR)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("LogiTrack API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
