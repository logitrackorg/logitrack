package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type BranchZoneHandler struct {
	svc *service.BranchZoneService
}

func NewBranchZoneHandler(svc *service.BranchZoneService) *BranchZoneHandler {
	return &BranchZoneHandler{svc: svc}
}

type MoveZoneRequest struct {
	Zone  string `json:"zone" binding:"required"`
	Notes string `json:"notes,omitempty"`
}

func (h *BranchZoneHandler) ListZones(c *gin.Context) {
	branchID := c.Param("id")
	includeInactive := c.Query("include_inactive") == "true"
	zones, err := h.svc.ListByBranch(branchID, includeInactive)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"zones": zones})
}

func (h *BranchZoneHandler) MoveZone(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	user := c.MustGet(middleware.UserKey).(model.User)

	// Branch scope check
	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "no tenés una sucursal asignada"})
		return
	}

	var req MoveZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	toZone := model.BranchZoneType(req.Zone)
	if toZone != model.ZoneEntrada && toZone != model.ZoneSalida &&
		toZone != model.ZoneRevision && toZone != model.ZoneDevolucion {
		c.JSON(http.StatusBadRequest, gin.H{"error": "zona inválida"})
		return
	}

	if err := h.svc.MoveShipment(trackingID, user.Username, user.BranchID, req.Notes, toZone, user.Role); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
