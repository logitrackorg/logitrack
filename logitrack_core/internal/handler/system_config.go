package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type SystemConfigHandler struct {
	svc *service.SystemConfigService
}

func NewSystemConfigHandler(svc *service.SystemConfigService) *SystemConfigHandler {
	return &SystemConfigHandler{svc: svc}
}

func (h *SystemConfigHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.Get())
}

func (h *SystemConfigHandler) Update(c *gin.Context) {
	var cfg model.SystemConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if cfg.TwoFACooldownMinutes < 1 || cfg.TwoFACooldownMinutes > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "two_fa_cooldown_minutes debe estar entre 1 y 10"})
		return
	}

	updated, err := h.svc.Update(cfg)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *SystemConfigHandler) GetPublicConfig(c *gin.Context) {
	cfg := h.svc.Get()
	c.JSON(http.StatusOK, gin.H{
		"two_fa_cooldown_minutes": cfg.TwoFACooldownMinutes,
	})
}