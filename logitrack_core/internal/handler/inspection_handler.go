package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type InspectionHandler struct {
	branchZoneSvc *service.BranchZoneService
}

func NewInspectionHandler(branchZoneSvc *service.BranchZoneService) *InspectionHandler {
	return &InspectionHandler{branchZoneSvc: branchZoneSvc}
}

type ApproveRevisionRequest struct {
	Notes string `json:"notes,omitempty"`
}

// ApproveFromRevision mueve un envío de Revisión a Salida (solo supervisor).
func (h *InspectionHandler) ApproveFromRevision(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	user := c.MustGet(middleware.UserKey).(model.User)

	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "no tenés una sucursal asignada"})
		return
	}

	var req ApproveRevisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		req.Notes = ""
	}

	if err := h.branchZoneSvc.ApproveFromRevision(trackingID, user.Username, user.BranchID, req.Notes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type ClassifyShipmentRequest struct {
	Classification string `json:"classification" binding:"required"`
	Notes          string `json:"notes,omitempty"`
}

// Classify clasifica un envío como lost o destroyed (solo supervisor).
func (h *InspectionHandler) Classify(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	user := c.MustGet(middleware.UserKey).(model.User)

	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "no tenés una sucursal asignada"})
		return
	}

	var req ClassifyShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Classification != "lost" && req.Classification != "destroyed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "clasificación inválida: debe ser 'lost' o 'destroyed'"})
		return
	}

	if err := h.branchZoneSvc.ClassifyShipment(trackingID, user.Username, user.BranchID, req.Classification, req.Notes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
