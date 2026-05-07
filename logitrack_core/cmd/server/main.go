package main

import (
	"log"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/db"
	"github.com/logitrack/core/internal/handler"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/seed"
	"github.com/logitrack/core/internal/service"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
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

	commentSvc := service.NewCommentService(commentRepo, shipmentRepo)
	incidentSvc := service.NewIncidentService(incidentRepo, shipmentRepo, eventStore, shipmentProj)
	shipmentSvc := service.NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, mlClient)
	shipmentSvc.SetSystemConfig(sysConfigSvc)
	shipmentSvc.SetPricingService(pricingSvc)
	routeSvc := service.NewRouteService(routeRepo, shipmentRepo)
	shipmentHandler := handler.NewShipmentHandler(shipmentSvc, routeSvc, commentSvc)
	qrHandler := handler.NewQRHandler(shipmentSvc)
	commentHandler := handler.NewCommentHandler(commentSvc, shipmentSvc)
	incidentHandler := handler.NewIncidentHandler(incidentSvc, shipmentSvc)
	authHandler := handler.NewAuthHandler(authRepo, accessLogRepo)
	accessLogHandler := handler.NewAccessLogHandler(accessLogRepo)
	branchSvc := service.NewBranchService(branchRepo, shipmentProj)
	branchHandler := handler.NewBranchHandler(branchSvc)
	vehicleHandler := handler.NewVehicleHandler(vehicleRepo, shipmentSvc, branchRepo)
	driverHandler := handler.NewDriverHandler(routeSvc)
	userSvc := service.NewUserService(authRepo, branchRepo)
	userHandler := handler.NewUserHandler(authRepo, userSvc)
	adminHandler := handler.NewAdminHandler(authRepo)
	customerHandler := handler.NewCustomerHandler(customerRepo)

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
	canViewVehicle := middleware.RequireRoles(model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	canViewAvailableVehicles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager)
	protected.GET("/vehicles/available", canViewAvailableVehicles, vehicleHandler.ListAvailable)
	protected.POST("/vehicles", adminOnly, vehicleHandler.Create)
	protected.GET("/vehicles/by-plate/:plate", canViewVehicle, vehicleHandler.GetByPlate)
	protected.GET("/vehicles/by-shipment/:trackingId", shipmentDetailRead, vehicleHandler.GetByShipment)
	protected.PATCH("/vehicles/by-plate/:plate/status", shipmentWrite, vehicleHandler.UpdateStatusByPlate)
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

	// Driver route — driver only
	driverOnly := middleware.RequireRoles(model.RoleDriver)
	protected.GET("/driver/route", driverOnly, driverHandler.GetRoute)
	protected.POST("/driver/route/start", driverOnly, driverHandler.StartRoute)

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

	// Pricing — quote belongs to the shipment-creation flow (operator/supervisor); config is admin-only
	protected.POST("/pricing/quote", shipmentWrite, pricingHandler.Quote)
	protected.GET("/pricing/config", adminOnly, pricingHandler.GetConfig)
	protected.PATCH("/pricing/config", adminOnly, pricingHandler.UpdateConfig)

	// ML config — admin only
	protected.GET("/admin/users", adminOnly, adminHandler.ListUsers)
	protected.POST("/admin/users", adminOnly, adminHandler.CreateUser)
	protected.PATCH("/admin/users/:id", adminOnly, adminHandler.UpdateUser)
	protected.GET("/ml/config", adminOnly, mlConfigHandler.GetActive)
	protected.GET("/ml/config/history", adminOnly, mlConfigHandler.ListHistory)
	protected.POST("/ml/config/regenerate", adminOnly, mlConfigHandler.Regenerate)
	protected.POST("/ml/config/:id/activate", adminOnly, mlConfigHandler.Activate)
	protected.GET("/admin/access-logs", adminOnly, accessLogHandler.List)

	// Public tracking — no auth required
	publicAPI := api.Group("/public")
	publicAPI.GET("/track/:tracking_id", shipmentHandler.GetByTrackingID)
	publicAPI.GET("/track/:tracking_id/events", shipmentHandler.GetEvents)
	publicAPI.GET("/branches", branchHandler.List)

	publicAPI.GET("/track/:tracking_id/qr", qrHandler.GenerateShipmentQR)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("LogiTrack API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
