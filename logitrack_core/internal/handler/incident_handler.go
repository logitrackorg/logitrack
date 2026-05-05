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
	if shipment, err := h.shipmentSvc.GetByTrackingID(trackingID); err == nil {
		if operatorReadForbidden(c, user, shipment) {
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

// terminalStatusForIncident maps terminal incident types to their resulting shipment status.
func terminalStatusForIncident(t model.IncidentType) model.Status {
	switch t {
	case model.IncidentTypeExtraviado:
		return model.StatusLost
	case model.IncidentTypeDanioTotal:
		return model.StatusDestroyed
	}
	return ""
}

func (h *IncidentHandler) ReportIncident(c *gin.Context) {
	var req model.ReportIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")

	existing, err := h.shipmentSvc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	if branchForbidden(c, user, existing.ReceivingBranchID) {
		return
	}
	if model.IsTerminalStatus(existing.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "el envío se encuentra en un estado terminal que no admite nuevas incidencias"})
		return
	}

	// For terminal incident types (extraviado, daño total), update the shipment status
	// as part of the same request so both operations succeed or fail together.
	if terminalStatus := terminalStatusForIncident(req.IncidentType); terminalStatus != "" {
		if (user.Role == model.RoleOperator || user.Role == model.RoleSupervisor) && existing.Status == model.StatusOutForDelivery {
			c.JSON(http.StatusForbidden, gin.H{"error": "solo los choferes pueden registrar incidencias terminales en envíos en reparto"})
			return
		}
		if _, err := h.shipmentSvc.UpdateStatus(trackingID, model.UpdateStatusRequest{
			Status:    terminalStatus,
			ChangedBy: user.Username,
			Notes:     req.Description,
		}); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
