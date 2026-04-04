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

	commentRepo := repository.NewInMemoryCommentRepository()

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

	commentSvc := service.NewCommentService(commentRepo, shipmentRepo)
	shipmentSvc := service.NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, mlClient)
	routeSvc := service.NewRouteService(routeRepo, shipmentRepo)
	shipmentHandler := handler.NewShipmentHandler(shipmentSvc, routeSvc, commentSvc)
	commentHandler := handler.NewCommentHandler(commentSvc)
	authHandler := handler.NewAuthHandler(authRepo)
	branchSvc := service.NewBranchService(branchRepo)
	branchHandler := handler.NewBranchHandler(branchSvc)
	vehicleHandler := handler.NewVehicleHandler(vehicleRepo, shipmentSvc, branchRepo)
	driverHandler := handler.NewDriverHandler(routeSvc)
	userHandler := handler.NewUserHandler(authRepo)
	customerHandler := handler.NewCustomerHandler(customerRepo)

	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
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

	// Branches — list/search: non-driver roles, create/update: admin only, status: supervisor+admin
	nonDriver := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	canManageBranch := middleware.RequireRoles(model.RoleAdmin)
	canChangeBranchStatus := middleware.RequireRoles(model.RoleSupervisor, model.RoleAdmin)
	protected.GET("/branches", nonDriver, branchHandler.List)
	protected.GET("/branches/search", nonDriver, branchHandler.Search)
	protected.POST("/branches", canManageBranch, branchHandler.Create)
	protected.PATCH("/branches/:id", canManageBranch, branchHandler.Update)
	protected.PATCH("/branches/:id/status", canChangeBranchStatus, branchHandler.UpdateStatus)

	// Shipment detail/events — all authenticated roles including driver
	allRoles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin, model.RoleDriver)

	// Vehicles — list: non-driver roles, create: admin only, read detail: supervisor+manager+admin, write: supervisor+admin
	protected.GET("/vehicles", nonDriver, vehicleHandler.List)
	canViewVehicle := middleware.RequireRoles(model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	canViewAvailableVehicles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/vehicles/available", canViewAvailableVehicles, vehicleHandler.ListAvailable)
	canCreateVehicle := middleware.RequireRoles(model.RoleAdmin)
	protected.POST("/vehicles", canCreateVehicle, vehicleHandler.Create)
	protected.GET("/vehicles/by-plate/:plate", canViewVehicle, vehicleHandler.GetByPlate)
	protected.GET("/vehicles/by-shipment/:trackingId", allRoles, vehicleHandler.GetByShipment)
	canWriteVehicle := middleware.RequireRoles(model.RoleSupervisor, model.RoleAdmin)
	canAssignShipment := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.PATCH("/vehicles/by-plate/:plate/status", canWriteVehicle, vehicleHandler.UpdateStatusByPlate)
	protected.POST("/vehicles/by-plate/:plate/assign", canAssignShipment, vehicleHandler.AssignToShipment)
	protected.POST("/vehicles/by-plate/:plate/assign-branch", canWriteVehicle, vehicleHandler.AssignBranch)
	protected.POST("/vehicles/by-plate/:plate/start-trip", canWriteVehicle, vehicleHandler.StartTrip)
	protected.POST("/vehicles/by-plate/:plate/end-trip", canWriteVehicle, vehicleHandler.EndTrip)
	protected.DELETE("/vehicles/by-plate/:plate/shipments/:trackingId", canWriteVehicle, vehicleHandler.UnassignShipment)

	// Shipments list/search — non-driver roles only
	protected.GET("/shipments", nonDriver, shipmentHandler.List)
	protected.GET("/search", nonDriver, shipmentHandler.Search)
	protected.GET("/shipments/:tracking_id", allRoles, shipmentHandler.GetByTrackingID)
	protected.GET("/shipments/:tracking_id/events", allRoles, shipmentHandler.GetEvents)

	// Create / draft shipment — operator, supervisor, admin
	canCreate := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments", canCreate, shipmentHandler.Create)
	protected.POST("/shipments/draft", canCreate, shipmentHandler.SaveDraft)
	protected.PATCH("/shipments/:tracking_id/draft", canCreate, shipmentHandler.UpdateDraft)
	protected.POST("/shipments/:tracking_id/confirm", canCreate, shipmentHandler.ConfirmDraft)

	// Comments — read: all authenticated, write: supervisor/admin
	protected.GET("/shipments/:tracking_id/comments", allRoles, commentHandler.GetComments)
	canComment := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments/:tracking_id/comments", canComment, commentHandler.AddComment)

	// Correct shipment data (non-destructive) — operator, supervisor, admin
	canCorrect := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin)
	protected.PATCH("/shipments/:tracking_id/correct", canCorrect, shipmentHandler.CorrectShipment)

	// Cancel shipment — supervisor, admin
	canCancel := middleware.RequireRoles(model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments/:tracking_id/cancel", canCancel, shipmentHandler.CancelShipment)

	// Change status — supervisor, admin, driver (driver further restricted in handler)
	canChangeStatus := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleAdmin, model.RoleDriver)
	protected.PATCH("/shipments/:tracking_id/status", canChangeStatus, shipmentHandler.UpdateStatus)

	// Stats / dashboard — supervisor, manager, admin
	canViewStats := middleware.RequireRoles(model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/stats", canViewStats, shipmentHandler.Stats)

	// Driver route — driver only
	driverOnly := middleware.RequireRoles(model.RoleDriver)
	protected.GET("/driver/route", driverOnly, driverHandler.GetRoute)

	// Users — list drivers (supervisor, admin)
	canManageRoutes := middleware.RequireRoles(model.RoleSupervisor, model.RoleAdmin)
	protected.GET("/users/drivers", canManageRoutes, userHandler.ListDrivers)

	// Customers — autocomplete by DNI (operator+)
	protected.GET("/customers", nonDriver, customerHandler.GetByDNI)

	// ML config — admin only
	adminOnly := middleware.RequireRoles(model.RoleAdmin)
	protected.GET("/ml/config", adminOnly, mlConfigHandler.GetActive)
	protected.GET("/ml/config/history", adminOnly, mlConfigHandler.ListHistory)
	protected.POST("/ml/config/regenerate", adminOnly, mlConfigHandler.Regenerate)
	protected.POST("/ml/config/:id/activate", adminOnly, mlConfigHandler.Activate)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("LogiTrack API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
