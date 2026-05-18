package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type FatigueConfigHandler struct {
	svc *service.FatigueConfigService
}

func NewFatigueConfigHandler(svc *service.FatigueConfigService) *FatigueConfigHandler {
	return &FatigueConfigHandler{svc: svc}
}

// Get returns the current fatigue model configuration (defaults if never saved).
func (h *FatigueConfigHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.Get())
}

// Update validates and persists the fatigue model configuration.
func (h *FatigueConfigHandler) Update(c *gin.Context) {
	var cfg model.FatigueConfig
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

// ResetCheckins stamps the current time so that any check-in recorded before this
// moment triggers the fatigue gate again for every driver. Check-in data is preserved.
func (h *FatigueConfigHandler) ResetCheckins(c *gin.Context) {
	updated, err := h.svc.ResetCheckins()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar el reset"})
		return
	}
	c.JSON(http.StatusOK, updated)
}
