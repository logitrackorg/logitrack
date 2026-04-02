package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type VehicleHandler struct {
	repo repository.VehicleRepository
}

func NewVehicleHandler(repo repository.VehicleRepository) *VehicleHandler {
	return &VehicleHandler{repo: repo}
}

func (h *VehicleHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/vehicles", h.List)
	r.POST("/vehicles", h.Create)
}

// List returns all vehicles in the fleet.
//
// @Summary      List vehicles
// @Description  Returns all vehicles. Accessible to supervisor, manager, and admin roles.
// @Tags         vehicles
// @Produce      json
// @Security     BearerAuth
// @Success      200  {array}   model.Vehicle
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Router       /vehicles [get]
func (h *VehicleHandler) List(c *gin.Context) {
	c.JSON(http.StatusOK, h.repo.List())
}

// Create adds a new vehicle to the fleet.
//
// @Summary      Create vehicle
// @Description  Adds a new vehicle to the fleet with status 'disponible'. Accessible to admin role only.
// @Tags         vehicles
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        request  body      model.CreateVehicleRequest  true  "Vehicle data"
// @Success      201      {object}  model.Vehicle
// @Failure      400      {object}  map[string]string
// @Failure      401      {object}  map[string]string
// @Failure      403      {object}  map[string]string
// @Failure      409      {object}  map[string]string  "Duplicate license plate"
// @Router       /vehicles [post]
func (h *VehicleHandler) Create(c *gin.Context) {
	var req model.CreateVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	vehicle := model.Vehicle{
		LicensePlate: req.LicensePlate,
		Type:         req.Type,
		CapacityKg:   req.CapacityKg,
		Status:       model.VehicleStatusAvailable,
	}

	if err := h.repo.Add(vehicle); err != nil {
		if err == repository.ErrDuplicateLicensePlate {
			c.JSON(http.StatusConflict, gin.H{"error": "Ya existe un vehículo con la misma patente"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create vehicle"})
		return
	}

	c.JSON(http.StatusCreated, vehicle)
}
