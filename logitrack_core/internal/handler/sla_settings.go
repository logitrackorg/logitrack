package handler

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

var reHHMM = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// validCeilings is the set of priority levels the admin may choose as ceiling.
var validCeilings = map[string]bool{"media": true, "alta": true}

// SLASettingsHandler exposes GET/PUT for the SLA anomaly-engine configuration.
// Access is restricted to admin by the router middleware.
type SLASettingsHandler struct {
	repo *repository.SLASettingsRepository
	svc  *service.SLAAnomalyService
}

func NewSLASettingsHandler(repo *repository.SLASettingsRepository, svc *service.SLAAnomalyService) *SLASettingsHandler {
	return &SLASettingsHandler{repo: repo, svc: svc}
}

// Get returns the current SLA settings plus the runtime LastCalculatedAt timestamp.
func (h *SLASettingsHandler) Get(c *gin.Context) {
	cfg := h.repo.Get()
	// Merge runtime state so the frontend can show "Último cálculo: HH:MM".
	type response struct {
		model.SLASettings
		LastCalculatedAt interface{} `json:"last_calculated_at"` // *time.Time or nil
	}
	c.JSON(http.StatusOK, response{
		SLASettings:      cfg,
		LastCalculatedAt: h.svc.GetLastCalculatedAt(),
	})
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
	if cfg.EscalationTime != "" && !reHHMM.MatchString(cfg.EscalationTime) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "escalation_time debe tener el formato HH:MM (ej. 23:00)"})
		return
	}
	if cfg.EscalationTime == "" {
		cfg.EscalationTime = model.DefaultSLASettings().EscalationTime
	}

	if err := h.repo.Update(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar la configuración"})
		return
	}
	c.JSON(http.StatusOK, cfg)
}
