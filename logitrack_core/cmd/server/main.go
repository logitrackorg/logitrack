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
	branchRepo := repository.NewInMemoryBranchRepository()
	routeRepo := repository.NewPostgresRouteRepository(database)
	customerRepo := repository.NewPostgresCustomerRepository(database)

	seed.LoadBranches(branchRepo)
	seed.Load(eventStore, shipmentProj, customerRepo, routeRepo)

	commentRepo := repository.NewInMemoryCommentRepository()

	// Event-sourced shipment repository
	shipmentRepo := repository.NewEventSourcedShipmentRepository(eventStore, shipmentProj)

	// Services & handlers
	commentSvc := service.NewCommentService(commentRepo, shipmentRepo)
	shipmentSvc := service.NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc)
	routeSvc := service.NewRouteService(routeRepo, shipmentRepo)
	shipmentHandler := handler.NewShipmentHandler(shipmentSvc, routeSvc, commentSvc)
	commentHandler := handler.NewCommentHandler(commentSvc)
	authHandler := handler.NewAuthHandler(authRepo)
	branchHandler := handler.NewBranchHandler(branchRepo)
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

	// Branches — non-driver roles
	nonDriver := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin)
	protected.GET("/branches", nonDriver, branchHandler.List)

	// Shipments list/search — non-driver roles only
	protected.GET("/shipments", nonDriver, shipmentHandler.List)
	protected.GET("/search", nonDriver, shipmentHandler.Search)

	// Shipment detail/events — all roles including driver
	allRoles := middleware.RequireRoles(model.RoleOperator, model.RoleSupervisor, model.RoleManager, model.RoleAdmin, model.RoleDriver)
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
	canComment := middleware.RequireRoles(model.RoleSupervisor, model.RoleAdmin)
	protected.POST("/shipments/:tracking_id/comments", canComment, commentHandler.AddComment)

	// Correct shipment data (non-destructive) — supervisor, admin
	protected.PATCH("/shipments/:tracking_id/correct", canComment, shipmentHandler.CorrectShipment)

	// Cancel shipment — supervisor, admin
	protected.POST("/shipments/:tracking_id/cancel", canComment, shipmentHandler.CancelShipment)

	// Change status — supervisor, admin, driver (driver further restricted in handler)
	canChangeStatus := middleware.RequireRoles(model.RoleSupervisor, model.RoleAdmin, model.RoleDriver)
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

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("LogiTrack API running on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
