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

	seed.LoadBranches(branchRepo)
	seed.LoadVehicles(vehicleRepo)
	seed.Load(eventStore, shipmentProj, customerRepo, routeRepo)

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

	// Branches — list/search: non-driver roles, create/update/status: admin only, capacity: operator+supervisor+manager+admin
	nonDriver := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	canManageBranch := middleware.RequireRoles(model.RoleAdmin)
	canViewCapacity := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/branches", nonDriver, branchHandler.List)
	protected.GET("/branches/search", nonDriver, branchHandler.Search)
	protected.POST("/branches", canManageBranch, branchHandler.Create)
	protected.PATCH("/branches/:id", canManageBranch, branchHandler.Update)
	protected.PATCH("/branches/:id/status", canManageBranch, branchHandler.UpdateStatus)
	protected.GET("/branches/:id/capacity", canViewCapacity, branchHandler.GetCapacity)

	// Shipment detail/events — all authenticated roles including driver
	allRoles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin, model.RoleDriver)

	// Admin only middleware (reused across vehicles, ML config, admin routes)
	adminOnly := middleware.RequireRoles(model.RoleAdmin)

	// Vehicles — list: non-driver roles, create: admin only, read detail: supervisor+manager+admin, write: supervisor+admin
	protected.GET("/vehicles", nonDriver, vehicleHandler.List)
	canViewVehicle := middleware.RequireRoles(model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	canViewAvailableVehicles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/vehicles/available", canViewAvailableVehicles, vehicleHandler.ListAvailable)
	canCreateVehicle := middleware.RequireRoles(model.RoleAdmin)
	protected.POST("/vehicles", canCreateVehicle, vehicleHandler.Create)
	protected.GET("/vehicles/by-plate/:plate", canViewVehicle, vehicleHandler.GetByPlate)
	protected.GET("/vehicles/by-shipment/:trackingId", allRoles, vehicleHandler.GetByShipment)
	canWriteVehicle := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	canAssignShipment := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.PATCH("/vehicles/by-plate/:plate/status", canWriteVehicle, vehicleHandler.UpdateStatusByPlate)
	protected.POST("/vehicles/by-plate/:plate/assign", canAssignShipment, vehicleHandler.AssignToShipment)
	protected.POST("/vehicles/by-plate/:plate/assign-branch", adminOnly, vehicleHandler.AssignBranch)
	protected.POST("/vehicles/by-plate/:plate/start-trip", canWriteVehicle, vehicleHandler.StartTrip)
	protected.POST("/vehicles/by-plate/:plate/end-trip", canWriteVehicle, vehicleHandler.EndTrip)
	protected.DELETE("/vehicles/by-plate/:plate/shipments/:trackingId", canWriteVehicle, vehicleHandler.UnassignShipment)

	// Shipments list/search — non-driver roles only
	protected.GET("/shipments", nonDriver, shipmentHandler.List)
	protected.GET("/search", nonDriver, shipmentHandler.Search)
	protected.GET("/shipments/:tracking_id", allRoles, shipmentHandler.GetByTrackingID)
	protected.GET("/shipments/:tracking_id/events", allRoles, shipmentHandler.GetEvents)

	// QR generation — all authenticated roles
	protected.GET("/shipments/:tracking_id/qr", allRoles, qrHandler.GenerateShipmentQR)
	protected.GET("/shipments/:tracking_id/qr/download", allRoles, qrHandler.DownloadShipmentQR)

	// Create / draft shipment — operator, supervisor, admin
	canCreate := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments", canCreate, shipmentHandler.Create)
	protected.POST("/shipments/draft", canCreate, shipmentHandler.SaveDraft)
	protected.PATCH("/shipments/:tracking_id/draft", canCreate, shipmentHandler.UpdateDraft)
	protected.POST("/shipments/:tracking_id/confirm", canCreate, shipmentHandler.ConfirmDraft)

	// Comments — read: all authenticated, write: operator/supervisor/admin
	protected.GET("/shipments/:tracking_id/comments", allRoles, commentHandler.GetComments)
	canComment := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments/:tracking_id/comments", canComment, commentHandler.AddComment)

	// Incidents — read: all authenticated, write: operator/supervisor/admin
	protected.GET("/shipments/:tracking_id/incidents", allRoles, incidentHandler.GetIncidents)
	canReportIncident := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments/:tracking_id/incidents", canReportIncident, incidentHandler.ReportIncident)

	// Correct shipment data (non-destructive) — operator, supervisor, admin
	canCorrect := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.PATCH("/shipments/:tracking_id/correct", canCorrect, shipmentHandler.CorrectShipment)

	// Cancel shipment — operator, supervisor, admin (branch check enforced in handler/service)
	canCancel := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments/:tracking_id/cancel", canCancel, shipmentHandler.CancelShipment)

	// Change status — supervisor, admin, driver (driver further restricted in handler)
	canChangeStatus := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleDriver)
	protected.PATCH("/shipments/:tracking_id/status", canChangeStatus, shipmentHandler.UpdateStatus)

	// Bulk status update — operator, supervisor, admin (not driver)
	canBulkStatus := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor)
	protected.POST("/shipments/bulk-status", canBulkStatus, shipmentHandler.BulkUpdateStatus)

	// Stats / dashboard — supervisor, manager, admin
	canViewStats := middleware.RequireRoles(model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/stats", canViewStats, shipmentHandler.Stats)

	// Driver route — driver only
	driverOnly := middleware.RequireRoles(model.RoleDriver)
	protected.GET("/driver/route", driverOnly, driverHandler.GetRoute)

	// Users — list drivers (operator, supervisor, admin)
	canListDrivers := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.GET("/users/drivers", canListDrivers, userHandler.ListDrivers)
	protected.GET("/users/me", allRoles, userHandler.GetMe)
	protected.POST("/users/me/password", allRoles, userHandler.ChangePassword)

	// Customers — autocomplete by DNI (operator+)
	protected.GET("/customers", nonDriver, customerHandler.GetByDNI)

	// Organization config — read: all authenticated, write: admin only
	protected.GET("/organization", middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin, model.RoleDriver), orgHandler.Get)
	protected.PUT("/organization", adminOnly, orgHandler.Update)

	// System config — admin only
	protected.GET("/system/config", adminOnly, sysConfigHandler.Get)
	protected.PATCH("/system/config", adminOnly, sysConfigHandler.Update)

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
