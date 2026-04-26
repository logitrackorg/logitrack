package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type IncidentHandler struct {
	svc         *service.IncidentService
	shipmentSvc *service.ShipmentService
}

func NewIncidentHandler(svc *service.IncidentService, shipmentSvc *service.ShipmentService) *IncidentHandler {
	return &IncidentHandler{svc: svc, shipmentSvc: shipmentSvc}
}

func (h *IncidentHandler) GetIncidents(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	user := c.MustGet(middleware.UserKey).(model.User)
	if user.Role == model.RoleOperator && user.BranchID != "" {
		if shipment, err := h.shipmentSvc.GetByTrackingID(trackingID); err != nil || shipment.ReceivingBranchID != user.BranchID {
			c.JSON(http.StatusForbidden, gin.H{"error": "solo podés ver envíos asignados a tu sucursal"})
			return
		}
	}
	incidents, err := h.svc.GetIncidents(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if incidents == nil {
		incidents = []model.ShipmentIncident{}
	}
	c.JSON(http.StatusOK, incidents)
}

func (h *IncidentHandler) ReportIncident(c *gin.Context) {
	var req model.ReportIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.shipmentSvc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	incident, err := h.svc.ReportIncident(trackingID, user.Username, req.IncidentType, req.Description)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "envío no encontrado" {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, incident)
}
