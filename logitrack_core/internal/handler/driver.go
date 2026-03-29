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
//
// @Summary      Driver route
// @Description  Returns today's route with full shipment details for the authenticated driver. Driver role only.
// @Tags         driver
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  map[string]interface{}  "route and shipments"
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /driver/route [get]
func (h *DriverHandler) GetRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, shipments, err := h.routeSvc.GetTodayRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no route assigned for today"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": route, "shipments": shipments})
}
