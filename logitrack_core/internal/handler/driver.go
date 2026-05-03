package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type DriverHandler struct {
	routeSvc *service.RouteService
}

func NewDriverHandler(routeSvc *service.RouteService) *DriverHandler {
	return &DriverHandler{routeSvc: routeSvc}
}

// GetRoute returns today's assigned route and shipments for the authenticated driver.
func (h *DriverHandler) GetRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, shipments, err := h.routeSvc.GetTodayRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no tenés una ruta asignada para hoy"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": route, "shipments": shipments})
}

// StartRoute transitions the driver's today route from pendiente → en_curso.
func (h *DriverHandler) StartRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, err := h.routeSvc.StartRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": route})
}
