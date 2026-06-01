package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// validCeilings is the set of priority levels the admin may choose as ceiling.
var validCeilings = map[string]bool{"media": true, "alta": true}

// SLASettingsHandler exposes GET/PUT for the SLA anomaly-engine configuration.
// Access is restricted to admin by the router middleware.
type SLASettingsHandler struct {
	repo *repository.SLASettingsRepository
}

func NewSLASettingsHandler(repo *repository.SLASettingsRepository) *SLASettingsHandler {
	return &SLASettingsHandler{repo: repo}
}

// Get returns the current SLA settings (defaults if the file does not exist yet).
func (h *SLASettingsHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.repo.Get())
}

// Update validates and persists new SLA settings.
func (h *SLASettingsHandler) Update(c *gin.Context) {
	var cfg model.SLASettings
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido: " + err.Error()})
		return
	}

	if cfg.ToleranceMultiplier < 1.0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tolerance_multiplier debe ser >= 1.0"})
		return
	}
	if !validCeilings[cfg.PriorityCeiling] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "priority_ceiling debe ser 'media' o 'alta'"})
		return
	}
	if cfg.CacheIntervalMinutes < 1 || cfg.CacheIntervalMinutes > 1440 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cache_interval_minutes debe estar entre 1 y 1440"})
		return
	}
	if len(cfg.EnabledStates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enabled_states no puede estar vacío"})
		return
	}

	if err := h.repo.Update(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar la configuración"})
		return
	}
	c.JSON(http.StatusOK, cfg)
}
