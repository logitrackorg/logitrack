package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type RoutingConfigHandler struct {
	svc *service.RoutingConfigService
}

func NewRoutingConfigHandler(svc *service.RoutingConfigService) *RoutingConfigHandler {
	return &RoutingConfigHandler{svc: svc}
}

func (h *RoutingConfigHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.Get())
}

func (h *RoutingConfigHandler) Update(c *gin.Context) {
	var cfg model.RoutingConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updated, err := h.svc.Update(cfg)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, updated)
}
