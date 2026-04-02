package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
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
	r.GET("/vehicles/by-plate/:plate", h.GetByPlate)
	r.PATCH("/vehicles/by-plate/:plate/status", h.UpdateStatusByPlate)
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
		UpdatedAt:    time.Now(),
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

// GetByPlate returns a vehicle by its license plate with its current status and assigned shipment info.
//
// @Summary      Get vehicle by plate
// @Description  Returns vehicle status and info by license plate. Shows assigned shipment if any. Accessible to supervisor, manager, and admin roles.
// @Tags         vehicles
// @Produce      json
// @Security     BearerAuth
// @Param        plate  path      string  true  "License plate (patente)"
// @Success      200    {object}  model.Vehicle
// @Failure      401    {object}  map[string]string
// @Failure      403    {object}  map[string]string
// @Failure      404    {object}  map[string]string
// @Router       /vehicles/by-plate/{plate} [get]
func (h *VehicleHandler) GetByPlate(c *gin.Context) {
	plate := c.Param("plate")
	if plate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La patente es obligatoria"})
		return
	}

	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	// Build response with status labels
	response := gin.H{
		"id":                vehicle.ID,
		"license_plate":     vehicle.LicensePlate,
		"type":              vehicle.Type,
		"capacity_kg":       vehicle.CapacityKg,
		"status":            vehicle.Status,
		"status_label":      getStatusLabel(vehicle.Status),
		"updated_at":        vehicle.UpdatedAt,
		"assigned_shipment": vehicle.AssignedShipment,
	}

	c.JSON(http.StatusOK, response)
}

func getStatusLabel(status model.VehicleStatus) string {
	switch status {
	case model.VehicleStatusAvailable:
		return "Disponible"
	case model.VehicleStatusInMaintenance:
		return "En Reparación"
	case model.VehicleStatusInTransit:
		return "En Ruta"
	case model.VehicleStatusInactive:
		return "Inactivo"
	default:
		return string(status)
	}
}

// UpdateStatusByPlate updates a vehicle's status by its license plate.
//
// @Summary      Update vehicle status by plate
// @Description  Updates a vehicle's status by license plate. Records the user who made the change. Validates incompatible transitions. Supervisor and admin only.
// @Tags         vehicles
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        plate  path      string                      true  "License plate (patente)"
// @Param        body  body      model.UpdateVehicleStatusRequest  true  "New status and optional notes"
// @Success      200   {object}  model.Vehicle
// @Failure      400   {object}  map[string]string
// @Failure      401   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Failure      409   {object}  map[string]string  "Incompatible transition"
// @Router       /vehicles/by-plate/{plate}/status [patch]
func (h *VehicleHandler) UpdateStatusByPlate(c *gin.Context) {
	plate := c.Param("plate")
	if plate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La patente es obligatoria"})
		return
	}

	var req model.UpdateVehicleStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate status
	validStatuses := map[model.VehicleStatus]bool{
		model.VehicleStatusAvailable:     true,
		model.VehicleStatusInMaintenance: true,
		model.VehicleStatusInTransit:     true,
		model.VehicleStatusInactive:      true,
	}
	if !validStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido"})
		return
	}

	// Get current vehicle
	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	// Check for incompatible transitions
	if !req.Force {
		if err := validateStatusTransition(vehicle.Status, req.Status, vehicle.AssignedShipment != nil); err != nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":          err.Error(),
				"current_status": getStatusLabel(vehicle.Status),
				"new_status":     getStatusLabel(req.Status),
				"requires_force": true,
			})
			return
		}
	}

	// Get user from context
	user := c.MustGet(middleware.UserKey).(model.User)

	// Update status
	if err := h.repo.UpdateStatusByUser(vehicle.ID, req.Status, user.Username); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el estado"})
		return
	}

	// Get updated vehicle
	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)

	// Build response
	response := gin.H{
		"id":                updatedVehicle.ID,
		"license_plate":     updatedVehicle.LicensePlate,
		"type":              updatedVehicle.Type,
		"capacity_kg":       updatedVehicle.CapacityKg,
		"status":            updatedVehicle.Status,
		"status_label":      getStatusLabel(updatedVehicle.Status),
		"updated_at":        updatedVehicle.UpdatedAt,
		"updated_by":        updatedVehicle.UpdatedBy,
		"assigned_shipment": updatedVehicle.AssignedShipment,
	}

	c.JSON(http.StatusOK, response)
}

// validateStatusTransition checks if a status transition is valid.
// Returns an error if the transition is incompatible.
func validateStatusTransition(from, to model.VehicleStatus, hasAssignedShipment bool) error {
	// Cannot change from "En Ruta" to "Disponible" if there's an assigned shipment
	if from == model.VehicleStatusInTransit && to == model.VehicleStatusAvailable && hasAssignedShipment {
		return errors.New("No se puede cambiar de 'En Ruta' a 'Disponible' mientras tenga un envío asignado. Finalice o reasigne el envío primero.")
	}

	// Cannot change from "En Ruta" to "En Reparación" if there's an assigned shipment
	if from == model.VehicleStatusInTransit && to == model.VehicleStatusInMaintenance && hasAssignedShipment {
		return errors.New("No se puede cambiar de 'En Ruta' a 'En Reparación' mientras tenga un envío asignado. Finalice o reasigne el envío primero.")
	}

	// Cannot change from "En Ruta" to "Inactivo" if there's an assigned shipment
	if from == model.VehicleStatusInTransit && to == model.VehicleStatusInactive && hasAssignedShipment {
		return errors.New("No se puede cambiar de 'En Ruta' a 'Inactivo' mientras tenga un envío asignado. Finalice o reasigne el envío primero.")
	}

	return nil
}
