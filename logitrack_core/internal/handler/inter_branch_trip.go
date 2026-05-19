package handler

import (
	"encoding/base64"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type InterBranchTripHandler struct {
	svc *service.InterBranchTripService
}

func NewInterBranchTripHandler(svc *service.InterBranchTripService) *InterBranchTripHandler {
	return &InterBranchTripHandler{svc: svc}
}

// GetMyTrip returns the active (pending or in_progress) trip for the authenticated inter-branch driver.
func (h *InterBranchTripHandler) GetMyTrip(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trip, err := h.svc.GetActiveByDriver(user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// StartTrip is called by the driver to begin their trip (last-mile or inter-branch).
func (h *InterBranchTripHandler) StartTrip(c *gin.Context) {
	tripID := c.Param("id")
	user := c.MustGet(middleware.UserKey).(model.User)

	trip, err := h.svc.Start(tripID, user.ID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// ClaimByVehicleQR is called by a driver scanning the vehicle's QR code to claim the trip.
func (h *InterBranchTripHandler) ClaimByVehicleQR(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var req struct {
		QRToken string `json:"qr_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	trip, err := h.svc.ClaimByQR(req.QRToken, user.ID, user.BranchID, user.DriverType)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// CloseByVehicleQR is called by an operator/supervisor scanning the vehicle QR when the driver returns.
func (h *InterBranchTripHandler) CloseByVehicleQR(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var req struct {
		QRToken string `json:"qr_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}
	trip, err := h.svc.CloseByVehicleQR(req.QRToken, user.ID, user.BranchID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Viaje cerrado correctamente.",
		"trip":    trip,
	})
}

// GetTripQR generates a QR code containing the trip ID for the driver to show at the destination.
func (h *InterBranchTripHandler) GetTripQR(c *gin.Context) {
	tripID := c.Param("id")
	user := c.MustGet(middleware.UserKey).(model.User)

	trip, err := h.svc.GetByID(tripID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Only the assigned driver or managers/admins can get the QR
	if user.Role == model.RoleDriver && (trip.DriverID == nil || *trip.DriverID != user.ID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "no sos el chofer de este viaje"})
		return
	}

	if trip.Status == model.TripStatusCompleted || trip.Status == model.TripStatusCancelled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "el viaje ya está finalizado"})
		return
	}

	// QR encodes the raw trip ID — the operator app parses it and calls the finish endpoint
	qrPNG, err := qrcode.Encode(trip.ID, qrcode.Medium, 512)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al generar el QR"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"trip_id":       trip.ID,
		"qr_code_base64": base64.StdEncoding.EncodeToString(qrPNG),
	})
}

// FinishByScan is called by operator/supervisor at the destination branch after scanning the driver's QR.
func (h *InterBranchTripHandler) FinishByScan(c *gin.Context) {
	tripID := c.Param("id")
	user := c.MustGet(middleware.UserKey).(model.User)

	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}

	trip, err := h.svc.FinishByScan(tripID, user.ID, user.BranchID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Viaje recibido correctamente. Envíos disponibles en la sucursal.",
		"trip":    trip,
	})
}

// AssignDriver manually assigns a driver to a pending trip.
func (h *InterBranchTripHandler) AssignDriver(c *gin.Context) {
	tripID := c.Param("id")
	user := c.MustGet(middleware.UserKey).(model.User)

	var req model.AssignDriverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}

	trip, err := h.svc.AssignDriver(tripID, req.DriverID, user.BranchID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// Cancel cancels a pending inter-branch trip and reverts vehicle/shipment state.
func (h *InterBranchTripHandler) Cancel(c *gin.Context) {
	tripID := c.Param("id")
	user := c.MustGet(middleware.UserKey).(model.User)

	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}

	trip, err := h.svc.Cancel(tripID, user.BranchID, user.Username)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Viaje cancelado. Envíos y vehículo revertidos.",
		"trip":    trip,
	})
}

// GetTripByID devuelve un viaje por ID para que el operador pueda ver los detalles
// de la recepción antes de confirmar descarga/carga.
func (h *InterBranchTripHandler) GetTripByID(c *gin.Context) {
	tripID := c.Param("id")
	user := c.MustGet(middleware.UserKey).(model.User)

	branchID := user.BranchID
	if user.Role == model.RoleManager {
		branchID = "" // manager puede ver cualquier viaje sin restricción de sucursal
	}
	trip, err := h.svc.GetTripByID(tripID, branchID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trip)
}

// ConfirmUnload confirma la descarga física de envíos en una parada intermedia (paso 1).
func (h *InterBranchTripHandler) ConfirmUnload(c *gin.Context) {
	tripID := c.Param("id")
	idxStr := c.Param("idx")
	idx, err := strconv.Atoi(idxStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parada inválida"})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}

	var req struct {
		Delivered []string `json:"delivered"`
		Missing   []string `json:"missing"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	trip, err := h.svc.ConfirmUnload(tripID, idx, user.ID, user.BranchID, req.Delivered, req.Missing)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Descarga confirmada.", "trip": trip})
}

// ConfirmLoad confirma la carga de pickups y cierra la parada (paso 2).
func (h *InterBranchTripHandler) ConfirmLoad(c *gin.Context) {
	tripID := c.Param("id")
	idxStr := c.Param("idx")
	idx, err := strconv.Atoi(idxStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parada inválida"})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}

	var req struct {
		Loaded  []string `json:"loaded"`
		Skipped []string `json:"skipped"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	trip, err := h.svc.ConfirmLoad(tripID, idx, user.ID, user.BranchID, req.Loaded, req.Skipped)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	msg := "Parada cerrada. El vehículo continúa al próximo destino."
	if trip.Status == model.TripStatusCompleted {
		msg = "Viaje completado. Todos los envíos entregados."
	}
	c.JSON(http.StatusOK, gin.H{"message": msg, "trip": trip})
}

// ListByBranch returns trips visible to the user.
// - operator/supervisor: trips donde su sucursal participa (origin, destination o stop intermedio).
// - manager: todos los trips activos de la red, opcionalmente filtrados por ?branch_id=
// Admin no tiene acceso (scope = configuración únicamente).
func (h *InterBranchTripHandler) ListByBranch(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	switch user.Role {
	case model.RoleManager:
		// Manager: ver toda la red, con filtro opcional
		branchFilter := c.Query("branch_id")
		var trips []model.InterBranchTrip
		if branchFilter != "" {
			trips = h.svc.ListByBranch(branchFilter)
		} else {
			trips = h.svc.ListAllActive()
		}
		if trips == nil {
			trips = []model.InterBranchTrip{}
		}
		c.JSON(http.StatusOK, trips)
		return
	}

	// operator/supervisor: su sucursal
	branchID := user.BranchID
	if branchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "debés tener una sucursal asignada"})
		return
	}
	trips := h.svc.ListByBranch(branchID)
	if trips == nil {
		trips = []model.InterBranchTrip{}
	}
	c.JSON(http.StatusOK, trips)
}
