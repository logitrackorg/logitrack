package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type deliverRequest struct {
	Keyword      string  `json:"keyword"`
	RecipientDNI string  `json:"recipient_dni"`
	Contingency  bool    `json:"contingency"`
	CurrentSpeed float64 `json:"current_speed"`
	SpeedSource  string  `json:"speed_source"`
}

// DeliverShipment handles POST /shipments/:tracking_id/deliver (driverOnly).
func (h *ShipmentHandler) DeliverShipment(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")

	var req deliverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updated, err := h.svc.DeliverShipment(trackingID, service.DeliverRequest{
		Keyword:      req.Keyword,
		RecipientDNI: req.RecipientDNI,
		Contingency:  req.Contingency,
		DriverID:     user.ID,
		ChangedBy:    user.Username,
		CurrentSpeed: req.CurrentSpeed,
		SpeedSource:  req.SpeedSource,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}
