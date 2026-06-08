package main

import (
	"context"
	"time"
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
	"github.com/logitrack/core/internal/ml"
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
	twoFARepo := repository.NewTwoFARepository(database)
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
	seed.LoadProjectedDispatchScenario(vehicleRepo)

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

	// Mercado Pago — siempre non-nil; IsConfigured() depende de credenciales (DB > env vars)
	mpClient := mercadopago.NewClient(
		os.Getenv("MP_ACCESS_TOKEN"),
		os.Getenv("MP_WEBHOOK_SECRET"),
		getenv("MP_NOTIFICATION_URL", ""),
	)
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
	fatigueBlockRepo := repository.NewPostgresFatigueBlockRepository(database)
	supervisorFatigueHandler := handler.NewSupervisorFatigueHandler(authRepo, fatigueConfigSvc, fatigueBlockRepo)

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

	paymentConfigRepo := repository.NewPostgresPaymentConfigRepository(database)
	paymentConfigSvc := service.NewPaymentConfigService(paymentConfigRepo)
	paymentConfigHandler := handler.NewPaymentConfigHandler(paymentConfigSvc)
	paymentHandler.SetPaymentConfigService(paymentConfigSvc)
	mpClient.SetCredentialProvider(paymentConfigSvc.GetMPCredentials)
	if mpClient.IsConfigured() {
		log.Println("[mercadopago] cliente configurado — webhooks activos")
	} else {
		log.Println("[mercadopago] sin credenciales MP — modo simulación activo")
	}

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
		claimSvc.SetClaimEmailService(emailSvc)
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
		orgSvc,
	)
	messagingSvc.SetPickupEmailFallback(emailSvc)            // email fallback para ready_for_pickup
	messagingSvc.SetDeliveryConfirmedEmailFallback(emailSvc) // email fallback para entrega confirmada
	messagingSvc.SetRejectedEmailFallback(emailSvc)          // email fallback para rechazo (LOGITRACK-429)
	messagingSvc.SetDeliveryFailedEmailService(emailSvc)      // email siempre (+ WhatsApp si tiene tel) para entrega fallida (LOGITRACK-437)
	messagingSvc.SetSLAExpiredEmailFallback(emailSvc)          // email fallback cuando WhatsApp no disponible para SLA vencido (LOGITRACK-124)
	messagingSvc.SetClaimEmailFallback(emailSvc)               // email fallback cuando WhatsApp no disponible para reclamos (LOGITRACK-123/125/486)
	messagingSvc.SetSystemConfigGetter(sysConfigSvc)           // permite forzar email desde config de admin
	claimSvc.SetClaimWAService(messagingSvc)                   // WhatsApp al reclamante, email como fallback (LOGITRACK-123/125/486)
	shipmentSvc.SetWhatsAppConfirmationService(messagingSvc) // confirmación al registrar envío (LOGITRACK-406)
	shipmentSvc.SetMessagingService(messagingSvc)
	shipmentSvc.SetReadyForPickupEmailService(messagingSvc) // WhatsApp primero, email fallback
	shipmentSvc.SetDeliveryConfirmedService(messagingSvc)   // WhatsApp primero, email fallback (CA-01/CA-02)
	shipmentSvc.SetRejectedService(messagingSvc)            // WhatsApp primero, email fallback (LOGITRACK-429)
	shipmentSvc.SetDeliveryFailedService(messagingSvc)      // email siempre + WhatsApp si tiene tel (LOGITRACK-437)
	if os.Getenv("TWILIO_ACCOUNT_SID") != "" {
		log.Printf("[messaging] WhatsApp habilitado — from: %s", os.Getenv("TWILIO_WHATSAPP_FROM"))
	} else {
		log.Println("[messaging] Twilio no configurado — WhatsApp deshabilitado (usará email como fallback si SMTP configurado)")
	}
	twoFAService := service.NewTwoFAService(twoFARepo, authRepo)

	routeSvc := service.NewRouteService(routeRepo, shipmentRepo)
	shipmentSvc.SetRouteService(routeSvc)
	branchSvc := service.NewBranchService(branchRepo, shipmentProj)
	branchSvc.SetBranchZoneService(branchZoneSvc)
	branchHandler := handler.NewBranchHandler(branchSvc)
	shipmentHandler := handler.NewShipmentHandler(shipmentSvc, routeSvc, commentSvc, branchSvc, claimSvc)
	chatbotHandler := handler.NewChatbotHandler(shipmentRepo, branchRepo, notifSvc, shipmentSvc, sysConfigSvc, claimSvc)
	qrHandler := handler.NewQRHandler(shipmentSvc)
	commentHandler := handler.NewCommentHandler(commentSvc, shipmentSvc)
	incidentHandler := handler.NewIncidentHandler(incidentSvc, shipmentSvc)
	claimHandler := handler.NewClaimHandler(claimSvc)
	authHandler := handler.NewAuthHandler(authRepo, accessLogRepo, twoFARepo)
	accessLogHandler := handler.NewAccessLogHandler(accessLogRepo)
	vehicleHandler := handler.NewVehicleHandler(vehicleRepo, shipmentSvc, branchRepo)
	vehicleHandler.SetBranchZoneService(branchZoneSvc)
	notifSvc.SetFatigueBlockRepo(fatigueBlockRepo)
	driverHandler := handler.NewDriverHandler(routeSvc, branchRepo, fatigueConfigSvc, auditLogRepo, notifSvc, fatigueBlockRepo)
	userSvc := service.NewUserService(authRepo, branchRepo)
	userHandler := handler.NewUserHandler(authRepo, userSvc)
	adminHandler := handler.NewAdminHandler(authRepo)
	customerHandler := handler.NewCustomerHandler(customerRepo)

	statsExtendedSvc := service.NewStatsExtendedService(statsExtendedRepo, branchRepo)
	statsExtendedHandler := handler.NewStatsExtendedHandler(statsExtendedSvc)
	twoFAHandler := handler.NewTwoFAHandler(twoFAService, accessLogRepo)

	// Reportes automáticos (LOGITRACK — US gerente): manager + admin configuran
	// schedules; el scheduler in-process dispara la generación y guarda el snapshot.
	autoReportRepo := repository.NewPostgresAutoReportRepository(database)
	autoReportSvc := service.NewAutoReportService(autoReportRepo, statsExtendedSvc, notifSvc)
	autoReportHandler := handler.NewAutoReportHandler(autoReportSvc)
	autoReportScheduler := service.NewAutoReportScheduler(autoReportSvc)
	autoReportScheduler.Start()

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
	notifSvc.SetInterBranchTripService(interBranchTripSvc)
	interBranchTripHandler := handler.NewInterBranchTripHandler(interBranchTripSvc)
	vehicleHandler.SetTripService(interBranchTripSvc)

	routingPlanRepo := repository.NewPostgresRoutingPlanRepository(database)
	routingSvc := service.NewRoutingService(routingCfgSvc, shipmentRepo, vehicleRepo, branchRepo, authRepo, routeSvc, shipmentSvc, routingPlanRepo, osrmClient)
	routingSvc.SetInterBranchTripService(interBranchTripSvc)
	routingSvc.SetZoneService(zoneSvc)
	routingSvc.SetBranchZoneService(branchZoneSvc)
	routingSvc.SetSLAExpiredEmailService(emailSvc)
	routingSvc.SetSLAExpiredWAService(messagingSvc) // WhatsApp al cliente en SLA vencido, email como fallback (LOGITRACK-124)
	routingSvc.SetORSClient(orsClient)
	routingSvc.SetNotificationService(notifSvc)
	slaRiskChecker = routingSvc.RunSLARiskCheck // conecta el reloj admin con el chequeo de SLA
	shipmentHandler.SetRoutingService(routingSvc)

	// Motor de detección de anomalías SLA y repriorización automática (AC1-AC3).
	priorityLogRepo := repository.NewPriorityLogRepository()
	priorityLogHandler := handler.NewPriorityLogHandler(priorityLogRepo, shipmentRepo, branchRepo)
	slaSettingsRepo := repository.NewSLASettingsRepository()
	// Migración de arranque: fuerza la lista EnabledStates a la lista canónica
	// derivada de las constantes de estado del modelo, sobreescribiendo cualquier
	// configuración obsoleta en disco (p. ej. una escrita antes de agregar at_hub).
	if changed, err := slaSettingsRepo.SyncEnabledStates(); err != nil {
		log.Printf("[SLA] no se pudo sincronizar EnabledStates: %v", err)
	} else if changed {
		log.Printf("[SLA] EnabledStates sincronizado a la lista canónica: %v", model.MonitoredStatusCodes())
	} else {
		log.Printf("[SLA] EnabledStates ya estaba sincronizado")
	}
	slaAnomalySvc := service.NewSLAAnomalyService(database, priorityLogRepo, slaSettingsRepo)
	// Both handlers need the service to expose runtime state (LastCalculatedAt,
	// CurrentAverages), so they are created after the service.
	slaSettingsHandler := handler.NewSLASettingsHandler(slaSettingsRepo, slaAnomalySvc)

	fleetModelPath := os.Getenv("FLEET_ML_MODEL_PATH")
	if fleetModelPath == "" {
		fleetModelPath = "fleet_model.json"
	}
	fleetMLSvc := ml.NewFleetMLService(fleetModelPath)

	slaMetricsHandler := handler.NewSLAMetricsHandler(database, priorityLogRepo, slaAnomalySvc, fleetMLSvc)
	// Attach to the clock callback so every admin clock tick triggers a check.
	// The service runs in its own goroutine and is mutex-guarded against overlap.
	_ = slaAnomalySvc // referenced via closure below
	origSLARiskChecker := slaRiskChecker
	slaRiskChecker = func() {
		if origSLARiskChecker != nil {
			origSLARiskChecker()
		}
		slaAnomalySvc.RunCheck()
	}

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

	// Shared metrics repo
	metricsRepo := repository.NewPostgresRoutingMetricsRepository(database)

	// BranchGraph handler (repo+svc already exist above)
	branchGraphHandler := handler.NewBranchGraphHandler(branchGraphSvc)

	// Forecast + RollingPlan
	forecastSvc := service.NewForecastService(metricsRepo, branchRepo)
	rollingPlanSvc := service.NewRollingPlanService(forecastSvc, routingPlanRepo, vehicleRepo)
	routingForecastHandler := handler.NewRoutingForecastHandler(forecastSvc, rollingPlanSvc)

	// Metrics
	routingMetricsSvc := service.NewRoutingMetricsService(metricsRepo)
	routingMetricsHandler := handler.NewRoutingMetricsHandler(routingMetricsSvc)

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

	// Password reset via OTP (LOGITRACK-397) — sin autenticación
	passwordResetRepo := repository.NewPostgresPasswordResetRepository(database)
	passwordResetSvc := service.NewPasswordResetService(
		authRepo,
		passwordResetRepo,
		emailSvc,
		os.Getenv("TWILIO_ACCOUNT_SID"),
		os.Getenv("TWILIO_AUTH_TOKEN"),
		os.Getenv("TWILIO_WHATSAPP_FROM"),
		accessLogRepo,
	)
	passwordResetHandler := handler.NewPasswordResetHandler(passwordResetSvc)

	// Public routes
	authHandler.RegisterRoutes(api)
	twoFAHandler.RegisterRoutes(api, middleware.Auth(authRepo)) 
	passwordResetHandler.RegisterRoutes(api)
	api.POST("/webhooks/mercadopago", paymentHandler.Webhook)

	// Protected routes
	protected := api.Group("")
	protected.Use(middleware.Auth(authRepo))

	// Tarea periódica: limpiar códigos OTP expirados (cada 5 minutos)
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = twoFARepo.CleanupExpiredCodes(ctx)
			cancel()
		}
	}()

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
	claimRead := middleware.RequireRoles(model.RoleAdmin, model.RoleOperator, model.RoleSupervisor, model.RoleManager)
	claimWrite := middleware.RequireRoles(model.RoleAdmin, model.RoleOperator, model.RoleSupervisor)

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
	protected.POST("/shipments/:tracking_id/transfer-payment", shipmentWrite, paymentHandler.ConfirmTransferPayment)
	protected.GET("/payment/config", authenticated, paymentConfigHandler.Get)
	protected.PATCH("/payment/config", adminOnly, paymentConfigHandler.Update)
	protected.PATCH("/payment/config/credentials", adminOnly, paymentConfigHandler.UpdateCredentials)

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
	protected.GET("/claims/:id/response-evidence/download", claimRead, claimHandler.DownloadClaimResponseEvidence)
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
	protected.GET("/stats/volume-by-shipment-type", canViewStats, statsExtendedHandler.VolumeByShipmentType)
	protected.GET("/stats/volume-by-delivery-method", canViewStats, statsExtendedHandler.VolumeByDeliveryMethod)
	protected.GET("/stats/return-metrics", canViewStats, statsExtendedHandler.ReturnMetrics)
	protected.GET("/stats/success-rate-by-branch", canViewStats, statsExtendedHandler.SuccessRateByBranch)
	protected.GET("/supervisor/priority-logs", canViewStats, priorityLogHandler.List)
	protected.GET("/stats/sla-metrics", canViewStats, slaMetricsHandler.Get)
	protected.GET("/admin/sla-settings", adminOnly, slaSettingsHandler.Get)
	protected.PUT("/admin/sla-settings", adminOnly, slaSettingsHandler.Update)
	protected.GET("/supervisor/fatigue-dashboard", canViewStats, supervisorFatigueHandler.GetDashboard)
	protected.GET("/supervisor/fatigue-history", canViewStats, supervisorFatigueHandler.GetHistory)
	protected.GET("/supervisor/fatigue-alerts", canViewStats, supervisorFatigueHandler.GetActiveAlerts)
	protected.POST("/supervisor/fatigue-alerts/:driver_id/dismiss", canViewStats, supervisorFatigueHandler.DismissAlert)
	protected.POST("/supervisor/fatigue-alerts/:driver_id/recall", canViewStats, supervisorFatigueHandler.RecallDriver)
	protected.GET("/supervisor/fatigue/blocked-drivers", canViewStats, supervisorFatigueHandler.GetBlockedDrivers)
	protected.POST("/supervisor/fatigue/:driver_id/unblock", canViewStats, supervisorFatigueHandler.UnblockDriver)
	protected.GET("/supervisor/history-requests", canViewStats, supervisorFatigueHandler.ListHistoryRequests)
	protected.PATCH("/supervisor/history-requests/:driver_id", canViewStats, supervisorFatigueHandler.ReviewHistoryRequest)

	// Reportes automáticos — manager + admin. Operadores y choferes reciben 403 (CA-03).
	managerAdmin := middleware.RequireRoles(model.RoleManager, model.RoleAdmin)
	protected.GET("/auto-reports/schedules", managerAdmin, autoReportHandler.ListSchedules)
	protected.POST("/auto-reports/schedules", managerAdmin, autoReportHandler.CreateSchedule)
	protected.PATCH("/auto-reports/schedules/:id", managerAdmin, autoReportHandler.UpdateSchedule)
	protected.DELETE("/auto-reports/schedules/:id", managerAdmin, autoReportHandler.DeleteSchedule)
	protected.POST("/auto-reports/schedules/:id/run", managerAdmin, autoReportHandler.RunNow)
	protected.GET("/auto-reports/generated", managerAdmin, autoReportHandler.ListGenerated)
	protected.GET("/auto-reports/generated/:id", managerAdmin, autoReportHandler.GetGenerated)
	protected.GET("/auto-reports/generated/:id/csv", managerAdmin, autoReportHandler.DownloadCSV)

	// RoutingForecast — manager + admin
	protected.GET("/admin/routing/forecast", managerAdmin, routingForecastHandler.GetForecast)
	protected.GET("/admin/routing/forecast/quality", managerAdmin, routingForecastHandler.GetForecastQuality)
	protected.GET("/admin/routing/rolling-plan", managerAdmin, routingForecastHandler.GetRollingPlan)

	// Keyword delivery — driver only
	driverOnly := middleware.RequireRoles(model.RoleDriver)
	protected.POST("/shipments/:tracking_id/deliver", driverOnly, shipmentHandler.DeliverShipment)

	// Driver route — driver only
	protected.GET("/driver/route", driverOnly, driverHandler.GetRoute)
	protected.POST("/driver/route/start", driverOnly, driverHandler.StartRoute)
	protected.GET("/driver/checkin/today", driverOnly, driverHandler.GetTodayCheckin)
	protected.POST("/driver/checkin", driverOnly, driverHandler.SubmitCheckin)
	protected.POST("/driver/checkin/skip", driverOnly, driverHandler.SkipCheckin)
	protected.POST("/driver/route/mark-started", driverOnly, driverHandler.MarkRouteStarted)
	protected.POST("/driver/pvt-test", driverOnly, driverHandler.SubmitPVT)                 // US6: PVT mini-game
	protected.POST("/driver/touch-events", driverOnly, driverHandler.SubmitTouchEvent)      // US4: tactile events
	protected.GET("/driver/test-eligibility", driverOnly, driverHandler.GetTestEligibility) // US4+: re-test gate
	protected.POST("/driver/reset-misfires", driverOnly, driverHandler.ResetMisfires)       // US4+: reset per-package misfire counter
	protected.GET("/driver/control-phrase", driverOnly, driverHandler.GetControlPhrase)
	protected.POST("/driver/voice-upload", driverOnly, driverHandler.UploadVoice)
	protected.POST("/driver/history-request", driverOnly, driverHandler.RequestHistory)
	protected.GET("/driver/history", driverOnly, driverHandler.GetPersonalHistory)
	protected.POST("/dev/simulator/fast-forward-time", driverOnly, driverHandler.FastForwardCheckinTime) // DEV: simula paso de 2h
	protected.GET("/driver/fatigue/block-status", driverOnly, driverHandler.GetFatigueBlockStatus)       // LOGITRACK-499

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
	protected.GET("/inter-branch-trips/calendar", shipmentRead, interBranchTripHandler.Calendar)
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

	// BranchGraph — admin only
	protected.GET("/admin/branches/graph", adminOnly, branchGraphHandler.GetGraph)
	protected.POST("/admin/branches/graph/derive", adminOnly, branchGraphHandler.Derive)
	protected.POST("/admin/branches/graph", adminOnly, branchGraphHandler.CreateEdge)
	protected.PATCH("/admin/branches/graph/:from/:to", adminOnly, branchGraphHandler.SetEnabled)

	// Inspection (supervisor-only) — approve from Revision or classify lost/destroyed
	supervisorOnly := middleware.RequireRoles(model.RoleSupervisor)
	protected.POST("/shipments/:tracking_id/approve-revision", supervisorOnly, inspectionHandler.ApproveFromRevision)
	protected.POST("/shipments/:tracking_id/classify", supervisorOnly, inspectionHandler.Classify)

	// Routing — operativo (operator + supervisor restringido por sucursal en handler); config admin-only.
	protected.GET("/routing/config", adminOnly, routingCfgHandler.Get)
	protected.PATCH("/routing/config", adminOnly, routingCfgHandler.Update)
	protected.GET("/routing/plan/today", shipmentRead, routingHandler.GetTodayPlan)
	protected.GET("/routing/plan/horizon", shipmentRead, routingHandler.GetHorizonPlans)
	protected.POST("/routing/regenerate", shipmentWrite, routingHandler.Regenerate)          // operator+supervisor: su sucursal
	protected.POST("/routing/regenerate/global", adminOnly, routingHandler.RegenerateGlobal) // admin: toda la red
	protected.POST("/routing/apply", shipmentWrite, routingHandler.Apply)
	protected.POST("/routing/last-mile/recompute", shipmentWrite, routingHandler.RecomputeLastMile)

	// RoutingMetrics — admin only
	protected.GET("/admin/routing/metrics/plan", adminOnly, routingMetricsHandler.GetPlanMetrics)
	protected.GET("/admin/routing/metrics/apply", adminOnly, routingMetricsHandler.GetApplyMetrics)
	protected.GET("/admin/routing/metrics/hops", adminOnly, routingMetricsHandler.GetHopMetrics)
	protected.GET("/admin/routing/metrics/od-volume", adminOnly, routingMetricsHandler.GetODVolume)
	protected.GET("/admin/routing/metrics/summary", adminOnly, routingMetricsHandler.GetSummary)

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
	publicAPI.GET("/config", sysConfigHandler.GetPublicConfig)
	publicAPI.GET("/organization", orgHandler.GetPublic)
	chatbotHandler.RegisterRoutes(publicAPI)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("LogiTrack API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
