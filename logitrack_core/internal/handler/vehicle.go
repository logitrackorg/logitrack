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
	branchRepo  repository.BranchRepository
}

// effectiveWeight returns the shipment's weight after applying any weight correction.
func effectiveWeight(s model.Shipment) float64 {
	if s.Corrections != nil && s.Corrections.WeightKg != nil {
		if v, err := strconv.ParseFloat(*s.Corrections.WeightKg, 64); err == nil {
			return v
		}
	}
	return s.WeightKg
}

func NewVehicleHandler(repo repository.VehicleRepository, shipmentSvc *service.ShipmentService, branchRepo repository.BranchRepository) *VehicleHandler {
	return &VehicleHandler{repo: repo, shipmentSvc: shipmentSvc, branchRepo: branchRepo}
}

// List returns all vehicles in the fleet.
func (h *VehicleHandler) List(c *gin.Context) {
	c.JSON(http.StatusOK, h.repo.List())
}

// ListAvailable returns available vehicles, optionally filtered by type, min_capacity, and branch_id.
func (h *VehicleHandler) ListAvailable(c *gin.Context) {
	vehicles := h.repo.List()
	result := make([]model.Vehicle, 0)

	vehicleType := c.Query("type")
	branchFilter := c.Query("branch_id")

	var minCapacity float64 = 0
	if minCapacityStr := c.Query("min_capacity"); minCapacityStr != "" {
		if val, err := strconv.ParseFloat(minCapacityStr, 64); err == nil {
			minCapacity = val
		}
	}

	for _, v := range vehicles {
		if v.Status != model.VehicleStatusAvailable && v.Status != model.VehicleStatusLoading {
			continue
		}
		if vehicleType != "" && string(v.Type) != vehicleType {
			continue
		}
		if minCapacity > 0 && v.CapacityKg < minCapacity {
			continue
		}
		if branchFilter != "" && (v.AssignedBranch == nil || *v.AssignedBranch != branchFilter) {
			continue
		}
		result = append(result, v)
	}

	c.JSON(http.StatusOK, result)
}

// Create adds a new vehicle to the fleet. Branch is required.
func (h *VehicleHandler) Create(c *gin.Context) {
	var req model.CreateVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate branch exists
	_, found := h.branchRepo.GetByID(req.BranchID)
	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Branch not found: " + req.BranchID})
		return
	}

	branchID := req.BranchID
	vehicle := model.Vehicle{
		LicensePlate:   req.LicensePlate,
		Type:           req.Type,
		CapacityKg:     req.CapacityKg,
		Status:         model.VehicleStatusAvailable,
		AssignedBranch: &branchID,
		UpdatedAt:      time.Now(),
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

// GetByPlate returns a vehicle by license plate with status info.
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

	c.JSON(http.StatusOK, buildVehicleResponse(vehicle))
}

func getStatusLabel(status model.VehicleStatus) string {
	switch status {
	case model.VehicleStatusAvailable:
		return "Disponible"
	case model.VehicleStatusLoading:
		return "En Carga"
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

// buildVehicleResponse constructs the standard vehicle response map.
func buildVehicleResponse(v model.Vehicle) gin.H {
	return gin.H{
		"id":                 v.ID,
		"license_plate":      v.LicensePlate,
		"type":               v.Type,
		"capacity_kg":        v.CapacityKg,
		"status":             v.Status,
		"status_label":       getStatusLabel(v.Status),
		"updated_at":         v.UpdatedAt,
		"updated_by":         v.UpdatedBy,
		"assigned_shipments": v.AssignedShipments,
		"assigned_branch":    v.AssignedBranch,
		"destination_branch": v.DestinationBranch,
	}
}

// UpdateStatusByPlate updates a vehicle's status by license plate (pure status update, no cascade).
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

	validStatuses := map[model.VehicleStatus]bool{
		model.VehicleStatusAvailable:     true,
		model.VehicleStatusLoading:       true,
		model.VehicleStatusInMaintenance: true,
		model.VehicleStatusInTransit:     true,
		model.VehicleStatusInactive:      true,
	}
	if !validStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido"})
		return
	}

	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	if !req.Force {
		if err := validateStatusTransition(vehicle.Status, req.Status, len(vehicle.AssignedShipments) > 0); err != nil {
			c.JSON(http.StatusConflict, gin.H{
				"error":          err.Error(),
				"current_status": getStatusLabel(vehicle.Status),
				"new_status":     getStatusLabel(req.Status),
				"requires_force": true,
			})
			return
		}
	}

	user := c.MustGet(middleware.UserKey).(model.User)

	if err := h.repo.UpdateStatusByUser(vehicle.ID, req.Status, user.Username); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el estado"})
		return
	}

	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)
	c.JSON(http.StatusOK, buildVehicleResponse(updatedVehicle))
}

// validateStatusTransition checks if a vehicle status transition is valid.
func validateStatusTransition(from, to model.VehicleStatus, hasShipments bool) error {
	if hasShipments && from == model.VehicleStatusInTransit && to != model.VehicleStatusInTransit {
		return errors.New("No se puede cambiar el estado mientras el vehículo esté en ruta con envíos asignados. Finalice el viaje primero.")
	}
	return nil
}

// AssignShipmentRequest is the request body for assigning a vehicle to a shipment.
type AssignShipmentRequest struct {
	TrackingID string `json:"tracking_id" binding:"required"`
}

// AssignToShipment assigns a shipment to a vehicle from ShipmentDetail.
// Supports multiple shipments per vehicle with weight validation.
// Shipment must be at the same branch as the vehicle.
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

	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	// Vehicle must be disponible (first shipment) or en_carga (adding more)
	if vehicle.Status != model.VehicleStatusAvailable && vehicle.Status != model.VehicleStatusLoading {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "El vehículo no está disponible para asignación",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	// Vehicle must have an assigned branch
	if vehicle.AssignedBranch == nil || *vehicle.AssignedBranch == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "El vehículo debe tener un branch asignado"})
		return
	}

	// Check shipment exists and status allows pre_transit assignment
	shipment, err := h.shipmentSvc.GetByTrackingID(req.TrackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "El envío '" + req.TrackingID + "' no existe"})
		return
	}

	allowedStatuses := map[model.Status]bool{
		model.StatusInProgress:     true,
		model.StatusAtBranch:       true,
		model.StatusReadyForPickup: true,
	}
	if !allowedStatuses[shipment.Status] {
		c.JSON(http.StatusConflict, gin.H{
			"error": "El envío no puede asignarse a un vehículo en su estado actual: " + string(shipment.Status),
		})
		return
	}

	// Branch match: shipment must be at the same branch as the vehicle
	shipmentBranch := shipment.ReceivingBranchID
	if shipment.Status == model.StatusAtBranch || shipment.Status == model.StatusReadyForPickup {
		shipmentBranch = shipment.CurrentLocation
	}
	if shipmentBranch != *vehicle.AssignedBranch {
		c.JSON(http.StatusConflict, gin.H{
			"error": "El envío no está en el mismo branch que el vehículo",
		})
		return
	}

	// Check shipment is not already assigned to this vehicle
	for _, s := range vehicle.AssignedShipments {
		if s == req.TrackingID {
			c.JSON(http.StatusConflict, gin.H{"error": "El envío ya está asignado a este vehículo"})
			return
		}
	}

	// Capacity check: sum current assigned shipments + new shipment weight (respecting corrections)
	var totalWeight float64 = effectiveWeight(shipment)
	for _, tid := range vehicle.AssignedShipments {
		existing, err := h.shipmentSvc.GetByTrackingID(tid)
		if err == nil {
			totalWeight += effectiveWeight(existing)
		}
	}
	if totalWeight > vehicle.CapacityKg {
		c.JSON(http.StatusConflict, gin.H{
			"error":           "El peso total de los envíos supera la capacidad del vehículo",
			"capacity_kg":     vehicle.CapacityKg,
			"total_weight_kg": totalWeight,
		})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)

	// Add shipment to vehicle
	if err := h.repo.AddShipment(vehicle.ID, req.TrackingID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al asignar el envío al vehículo"})
		return
	}

	// Transition shipment to pre_transit
	statusReq := model.UpdateStatusRequest{
		Status:    model.StatusPreTransit,
		ChangedBy: user.Username,
		Notes:     "Vehicle assigned: " + vehicle.LicensePlate,
	}
	if _, err := h.shipmentSvc.UpdateStatus(req.TrackingID, statusReq); err != nil {
		// Log but don't fail — assignment succeeded
		_ = err
	}

	// If vehicle was disponible, move it to en_carga
	if vehicle.Status == model.VehicleStatusAvailable {
		if err := h.repo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusLoading, user.Username); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el estado del vehículo"})
			return
		}
	}

	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)
	resp := buildVehicleResponse(updatedVehicle)
	resp["message"] = "Envío asignado exitosamente al vehículo"
	c.JSON(http.StatusOK, resp)
}

// GetByShipment returns the vehicle assigned to a specific shipment.
func (h *VehicleHandler) GetByShipment(c *gin.Context) {
	trackingId := c.Param("trackingId")
	if trackingId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El tracking ID es obligatorio"})
		return
	}

	for _, v := range h.repo.List() {
		for _, s := range v.AssignedShipments {
			if s == trackingId {
				c.JSON(http.StatusOK, buildVehicleResponse(v))
				return
			}
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "No hay un vehículo asignado a este envío"})
}

// StartTripRequest is the request body for starting a trip.
type StartTripRequest struct {
	DestinationBranch string `json:"destination_branch" binding:"required"`
}

// StartTrip initiates a trip: sets destination branch, transitions vehicle to en_transito,
// and moves all assigned shipments to in_transit.
func (h *VehicleHandler) StartTrip(c *gin.Context) {
	plate := c.Param("plate")
	if plate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La patente es obligatoria"})
		return
	}

	var req StartTripRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	if vehicle.Status != model.VehicleStatusLoading {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "Solo se puede iniciar el viaje de vehículos en estado 'En Carga'",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	if len(vehicle.AssignedShipments) == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "El vehículo no tiene envíos asignados para iniciar un viaje"})
		return
	}

	// Validate destination branch is different from current branch
	if vehicle.AssignedBranch != nil && *vehicle.AssignedBranch == req.DestinationBranch {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El branch de destino debe ser diferente al branch actual"})
		return
	}

	// Validate destination branch exists and get its city for shipment location
	destBranch, found := h.branchRepo.GetByID(req.DestinationBranch)
	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Branch de destino no encontrado: " + req.DestinationBranch})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)

	// Set destination branch
	destID := req.DestinationBranch
	if err := h.repo.SetDestinationBranch(vehicle.ID, &destID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al establecer el branch de destino"})
		return
	}

	// Update vehicle status to en_transito
	if err := h.repo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusInTransit, user.Username); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el estado del vehículo"})
		return
	}

	// Transition all assigned shipments to in_transit
	for _, tid := range vehicle.AssignedShipments {
		statusReq := model.UpdateStatusRequest{
			Status:    model.StatusInTransit,
			ChangedBy: user.Username,
			Location:  destBranch.Address.City,
			Notes:     "Trip started. Vehicle: " + vehicle.LicensePlate,
		}
		if _, err := h.shipmentSvc.UpdateStatus(tid, statusReq); err != nil {
			// Log but continue for other shipments
			_ = err
		}
	}

	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)
	resp := buildVehicleResponse(updatedVehicle)
	resp["message"] = "Viaje iniciado. Todos los envíos están en tránsito."
	c.JSON(http.StatusOK, resp)
}

// AssignBranchRequest is the request body for assigning a vehicle to a branch.
type AssignBranchRequest struct {
	BranchID string `json:"branch_id" binding:"required"`
}

// EndTripRequest is the request body for ending a trip.
type EndTripRequest struct {
	Notes string `json:"notes,omitempty"`
}

// AssignBranch assigns a vehicle to a branch (kept for compatibility; only available vehicles).
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

	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehículo no registrado"})
		return
	}

	if vehicle.Status != model.VehicleStatusAvailable {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "Solo se puede asignar branch a vehículos disponibles",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	branchID := req.BranchID
	if err := h.repo.AssignBranch(vehicle.ID, &branchID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al asignar el branch: " + err.Error()})
		return
	}

	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)
	resp := buildVehicleResponse(updatedVehicle)
	resp["message"] = "Vehículo asignado exitosamente al branch"
	c.JSON(http.StatusOK, resp)
}

// UnassignShipment removes one shipment from a vehicle and returns it to at_branch.
func (h *VehicleHandler) UnassignShipment(c *gin.Context) {
	plate := c.Param("plate")
	trackingID := c.Param("trackingId")
	if plate == "" || trackingID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plate and trackingId are required"})
		return
	}

	vehicle, found := h.repo.GetByLicensePlate(plate)
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "vehicle not found"})
		return
	}

	// Vehicle must be en_carga to allow unassignment
	if vehicle.Status != model.VehicleStatusLoading {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "shipments can only be removed while the vehicle is loading",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	// Verify shipment is actually assigned to this vehicle
	found = false
	for _, s := range vehicle.AssignedShipments {
		if s == trackingID {
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "shipment not assigned to this vehicle"})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)

	// Determine current branch city for location
	var branchCity string
	if vehicle.AssignedBranch != nil {
		branch, ok := h.branchRepo.GetByID(*vehicle.AssignedBranch)
		if ok {
			branchCity = branch.Address.City
		}
	}

	statusReq := model.UpdateStatusRequest{
		Status:    model.StatusAtBranch,
		ChangedBy: user.Username,
		Notes:     "Unassigned from vehicle: " + vehicle.LicensePlate,
		Location:  branchCity,
	}
	if _, err := h.shipmentSvc.UpdateStatus(trackingID, statusReq); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error transitioning shipment: " + err.Error()})
		return
	}

	// Remove from vehicle
	if err := h.repo.RemoveShipment(vehicle.ID, trackingID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error removing shipment from vehicle: " + err.Error()})
		return
	}

	// If no shipments remain, set vehicle back to disponible
	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)
	if len(updatedVehicle.AssignedShipments) == 0 {
		if err := h.repo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusAvailable, user.Username); err != nil {
			_ = err
		}
		updatedVehicle, _ = h.repo.GetByID(vehicle.ID)
	}

	resp := buildVehicleResponse(updatedVehicle)
	resp["message"] = "Shipment unassigned successfully"
	c.JSON(http.StatusOK, resp)
}

// EndTrip ends a trip: vehicle moves to the destination branch, becomes disponible,
// all assigned shipments transition to at_branch.
func (h *VehicleHandler) EndTrip(c *gin.Context) {
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

	if vehicle.Status != model.VehicleStatusInTransit {
		c.JSON(http.StatusConflict, gin.H{
			"error":          "Solo se puede finalizar el viaje de vehículos en tránsito",
			"current_status": getStatusLabel(vehicle.Status),
		})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)

	// Determine destination city for shipment location
	var destCity string
	if vehicle.DestinationBranch != nil {
		destBranch, found := h.branchRepo.GetByID(*vehicle.DestinationBranch)
		if found {
			destCity = destBranch.Address.City
		}
	}

	// Transition all assigned shipments to at_branch
	for _, tid := range vehicle.AssignedShipments {
		statusReq := model.UpdateStatusRequest{
			Status:    model.StatusAtBranch,
			ChangedBy: user.Username,
			Notes:     "Trip ended. Vehicle: " + vehicle.LicensePlate,
		}
		if destCity != "" {
			statusReq.Location = destCity
		}
		if _, err := h.shipmentSvc.UpdateStatus(tid, statusReq); err != nil {
			_ = err
		}
	}

	// Vehicle arrives at destination — set assigned_branch = destination_branch
	if vehicle.DestinationBranch != nil {
		destID := *vehicle.DestinationBranch
		if err := h.repo.AssignBranch(vehicle.ID, &destID); err != nil {
			_ = err
		}
	}

	// Clear shipments and destination
	if err := h.repo.ClearShipments(vehicle.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al liberar los envíos: " + err.Error()})
		return
	}
	if err := h.repo.SetDestinationBranch(vehicle.ID, nil); err != nil {
		_ = err
	}

	// Set vehicle to disponible
	if err := h.repo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusAvailable, user.Username); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el estado del vehículo"})
		return
	}

	updatedVehicle, _ := h.repo.GetByID(vehicle.ID)
	resp := buildVehicleResponse(updatedVehicle)
	resp["message"] = "Viaje finalizado. El vehículo está disponible en el branch de destino."
	c.JSON(http.StatusOK, resp)
}
