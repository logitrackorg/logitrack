package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type VehicleHandler struct {
	repo        repository.VehicleRepository
	shipmentSvc *service.ShipmentService
}

func NewVehicleHandler(repo repository.VehicleRepository, shipmentSvc *service.ShipmentService) *VehicleHandler {
	return &VehicleHandler{repo: repo, shipmentSvc: shipmentSvc}
}

func (h *VehicleHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/vehicles", h.List)
	r.POST("/vehicles", h.Create)
	r.GET("/vehicles/available", h.ListAvailable)
	r.GET("/vehicles/by-plate/:plate", h.GetByPlate)
	r.GET("/vehicles/by-shipment/:trackingId", h.GetByShipment)
	r.PATCH("/vehicles/by-plate/:plate/status", h.UpdateStatusByPlate)
	r.POST("/vehicles/by-plate/:plate/assign", h.AssignToShipment)
	r.POST("/vehicles/by-plate/:plate/assign-branch", h.AssignBranch)
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

// ListAvailable returns only vehicles with status 'disponible', optionally filtered by type and min capacity.
//
// @Summary      List available vehicles
// @Description  Returns only available vehicles. Supports filtering by type and minimum capacity. Accessible to supervisor, manager, and admin roles.
// @Tags         vehicles
// @Produce      json
// @Security     BearerAuth
// @Param        type     query     string  false  "Filter by vehicle type (motocicleta, furgoneta, camion, camion_grande)"
// @Param        min_capacity  query  float64 false  "Minimum capacity in kg"
// @Success      200      {array}   model.Vehicle
// @Failure      401      {object}  map[string]string
// @Failure      403      {object}  map[string]string
// @Router       /vehicles/available [get]
func (h *VehicleHandler) ListAvailable(c *gin.Context) {
	vehicles := h.repo.List()
	result := make([]model.Vehicle, 0)

	// Get filter parameters
	vehicleType := c.Query("type")
	minCapacityStr := c.Query("min_capacity")

	var minCapacity float64 = 0
	if minCapacityStr != "" {
		if val, err := parseFloat(minCapacityStr); err == nil {
			minCapacity = val
		}
	}

	for _, v := range vehicles {
		// Filter only available vehicles
		if v.Status != model.VehicleStatusAvailable {
			continue
		}

		// Filter by type
		if vehicleType != "" && string(v.Type) != vehicleType {
			continue
		}

		// Filter by minimum capacity
		if minCapacity > 0 && v.CapacityKg < minCapacity {
			continue
		}

		result = append(result, v)
	}

	c.JSON(http.StatusOK, result)
}

func parseFloat(s string) (float64, error) {
	return strconv.ParseFloat(s, 64)
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
		"assigned_branch":   vehicle.AssignedBranch,
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

	// Cannot change from "En Ruta" a "Inactivo" if there's an assigned shipment
	if from == model.VehicleStatusInTransit && to == model.VehicleStatusInactive && hasAssignedShipment {
		return errors.New("No se puede cambiar de 'En Ruta' a 'Inactivo' mientras tenga un envío asignado. Finalice o reasigne el envío primero.")
	}

	return nil
}

// AssignToShipment assigns a vehicle to a specific shipment.
//
// @Summary      Assign vehicle to shipment
// @Description  Assigns a vehicle to a shipment. Validates that the vehicle is available and the shipment exists. Updates vehicle status to 'en_transito'. Supervisor and admin only.
// @Tags         vehicles
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        plate  path      string  true  "License plate (patente)"
// @Param        body  body      AssignShipmentRequest  true  "Shipment tracking ID"
// @Success      200   {object}  model.Vehicle
// @Failure      400   {object}  map[string]string
// @Failure      401   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Failure      409   {object}  map[string]string  "Vehicle already assigned"
// @Router       /vehicles/by-plate/{plate}/assign [post]
func (h *VehicleHandler) AssignToShipment(c *gin.Context) {
	plate := c.Param("plate")
	if plate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La patente es obligatoria"})
		return
	}

	var req AssignShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.TrackingID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El tracking ID del envío es obligatorio"})
		return
	}

	// Get vehicle
	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	// Check if vehicle is already assigned
	if vehicle.AssignedShipment != nil && *vehicle.AssignedShipment != "" {
		c.JSON(http.StatusConflict, gin.H{
			"error":             "El vehículo ya está asignado a un envío",
			"assigned_shipment": *vehicle.AssignedShipment,
			"current_status":    getStatusLabel(vehicle.Status),
		})
		return
	}

	// Check if vehicle is available
	if vehicle.Status != model.VehicleStatusAvailable {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "El vehículo no está disponible para asignación",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	// Validate that the shipment exists and check its status
	shipment, err := h.shipmentSvc.GetByTrackingID(req.TrackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "El envío con tracking ID '" + req.TrackingID + "' no existe"})
		return
	}

	// Only allow assignment if shipment is in_progress (not yet pre_transit or in_transit)
	if shipment.Status != model.StatusInProgress {
		c.JSON(http.StatusConflict, gin.H{
			"error": "El envío no está en estado 'In Progress'. Estado actual: " + string(shipment.Status),
		})
		return
	}

	// Get user from context
	user := c.MustGet(middleware.UserKey).(model.User)

	// Assign shipment to vehicle
	trackingID := req.TrackingID
	if err := h.repo.AssignShipment(vehicle.ID, &trackingID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al asignar el vehículo"})
		return
	}

	// Update shipment status to "pre_transit" automatically
	shipmentUpdateReq := model.UpdateStatusRequest{
		Status:    model.StatusPreTransit,
		ChangedBy: user.Username,
		Notes:     "Vehículo asignado: " + vehicle.LicensePlate,
	}
	if _, err := h.shipmentSvc.UpdateStatus(trackingID, shipmentUpdateReq); err != nil {
		// Log warning but don't fail - vehicle assignment was successful
		// The shipment status can be updated manually if needed
	}

	// Update vehicle status to "en_transito"
	if err := h.repo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusInTransit, user.Username); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el estado del vehículo"})
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
		"message":           "Vehículo asignado exitosamente al envío",
	}

	c.JSON(http.StatusOK, response)
}

// GetByShipment returns the vehicle assigned to a specific shipment.
//
// @Summary      Get vehicle by shipment tracking ID
// @Description  Returns the vehicle assigned to a shipment. Returns 404 if no vehicle is assigned.
// @Tags         vehicles
// @Produce      json
// @Security     BearerAuth
// @Param        trackingId  path      string  true  "Shipment tracking ID"
// @Success      200         {object}  model.Vehicle
// @Failure      401         {object}  map[string]string
// @Failure      403         {object}  map[string]string
// @Failure      404         {object}  map[string]string
// @Router       /vehicles/by-shipment/{trackingId} [get]
func (h *VehicleHandler) GetByShipment(c *gin.Context) {
	trackingId := c.Param("trackingId")
	if trackingId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El tracking ID es obligatorio"})
		return
	}

	// Search through all vehicles for one assigned to this shipment
	vehicles := h.repo.List()
	for _, v := range vehicles {
		if v.AssignedShipment != nil && *v.AssignedShipment == trackingId {
			response := gin.H{
				"id":                v.ID,
				"license_plate":     v.LicensePlate,
				"type":              v.Type,
				"capacity_kg":       v.CapacityKg,
				"status":            v.Status,
				"status_label":      getStatusLabel(v.Status),
				"updated_at":        v.UpdatedAt,
				"updated_by":        v.UpdatedBy,
				"assigned_shipment": v.AssignedShipment,
			}
			c.JSON(http.StatusOK, response)
			return
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "No hay un vehículo asignado a este envío"})
}

// AssignShipmentRequest is the request body for assigning a vehicle to a shipment.
type AssignShipmentRequest struct {
	TrackingID string `json:"tracking_id" binding:"required"`
}

// AssignBranchRequest is the request body for assigning a vehicle to a branch.
type AssignBranchRequest struct {
	BranchID string `json:"branch_id" binding:"required"`
}

// AssignBranch assigns a vehicle to a specific branch.
//
// @Summary      Assign vehicle to branch
// @Description  Assigns a vehicle to a branch. Only available vehicles can be assigned. Admin only.
// @Tags         vehicles
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        plate  path      string  true  "License plate (patente)"
// @Param        body  body      AssignBranchRequest  true  "Branch ID"
// @Success      200   {object}  model.Vehicle
// @Failure      400   {object}  map[string]string
// @Failure      401   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Failure      409   {object}  map[string]string
// @Router       /vehicles/by-plate/{plate}/assign-branch [post]
func (h *VehicleHandler) AssignBranch(c *gin.Context) {
	plate := c.Param("plate")
	if plate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La patente es obligatoria"})
		return
	}

	var req AssignBranchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.BranchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El branch ID es obligatorio"})
		return
	}

	// Get vehicle by license plate
	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	// Only allow assignment if vehicle is available
	if vehicle.Status != model.VehicleStatusAvailable {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "Solo se puede asignar branch a vehículos disponibles",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	// Assign branch to vehicle
	branchID := req.BranchID
	if err := h.repo.AssignBranch(vehicle.ID, &branchID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al asignar el branch: " + err.Error()})
		return
	}

	// Get updated vehicle
	updatedVehicle, found := h.repo.GetByID(vehicle.ID)
	if !found {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al obtener el vehículo actualizado"})
		return
	}

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
		"assigned_branch":   updatedVehicle.AssignedBranch,
		"message":           "Vehículo asignado exitosamente al branch",
	}

	c.JSON(http.StatusOK, response)
}
