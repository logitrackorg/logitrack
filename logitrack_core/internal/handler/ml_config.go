package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type MLConfigHandler struct {
	svc *service.MLConfigService
}

func NewMLConfigHandler(svc *service.MLConfigService) *MLConfigHandler {
	return &MLConfigHandler{svc: svc}
}

// GetActive returns the currently active ML configuration.
//
//	@Summary		Get active ML config
//	@Description	Returns the active ML priority configuration (factor weights and thresholds). Returns default values if no config has been saved yet.
//	@Tags			ml-config
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{object}	model.MLConfig
//	@Failure		500	{object}	map[string]string
//	@Router			/ml/config [get]
func (h *MLConfigHandler) GetActive(c *gin.Context) {
	cfg, err := h.svc.GetActiveConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// ListHistory returns all ML configuration versions ordered by date descending.
//
//	@Summary		List ML config history
//	@Description	Returns the full history of ML configurations, newest first. Each entry includes factor weights, thresholds, and whether it is currently active.
//	@Tags			ml-config
//	@Produce		json
//	@Security		BearerAuth
//	@Success		200	{array}		model.MLConfig
//	@Failure		500	{object}	map[string]string
//	@Router			/ml/config/history [get]
func (h *MLConfigHandler) ListHistory(c *gin.Context) {
	configs, err := h.svc.ListConfigs()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if configs == nil {
		configs = []model.MLConfig{}
	}
	c.JSON(http.StatusOK, configs)
}

type regenerateRequest struct {
	Factors        map[string]float64 `json:"factors"`
	AltaThreshold  float64            `json:"alta_threshold"`
	MediaThreshold float64            `json:"media_threshold"`
	Notes          string             `json:"notes"`
}

type regenerateResponse struct {
	Config            *model.MLConfig `json:"config"`
	RecalculatedCount int             `json:"recalculated_count"`
}

// Regenerate saves a new ML config, retrains the model, and recalculates active shipment priorities.
//
//	@Summary		Regenerate ML model
//	@Description	Saves a new ML configuration with the provided factor weights and thresholds, retrains the RandomForest model, hot-swaps the in-memory model, and recalculates priority for all non-terminal shipments. Factor weights must be between 1.0 and 5.0. alta_threshold must be greater than media_threshold.
//	@Tags			ml-config
//	@Accept			json
//	@Produce		json
//	@Security		BearerAuth
//	@Param			body	body		regenerateRequest	true	"New configuration"
//	@Success		200		{object}	regenerateResponse
//	@Failure		400		{object}	map[string]string
//	@Router			/ml/config/regenerate [post]
func (h *MLConfigHandler) Regenerate(c *gin.Context) {
	var req regenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cuerpo de la solicitud inválido"})
		return
	}

	username := "admin"
	if u, exists := c.Get(middleware.UserKey); exists {
		if user, ok := u.(model.User); ok {
			username = user.Username
		}
	}

	cfg, count, err := h.svc.Regenerate(req.Factors, req.AltaThreshold, req.MediaThreshold, username, req.Notes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, regenerateResponse{
		Config:            cfg,
		RecalculatedCount: count,
	})
}

type activateResponse struct {
	Config            *model.MLConfig `json:"config"`
	RecalculatedCount int             `json:"recalculated_count"`
}

// Activate rolls back to a previous ML configuration version.
//
//	@Summary		Activate ML config version
//	@Description	Re-activates a previous configuration by ID. Loads its stored model blob, hot-swaps the in-memory model, and recalculates priority for all non-terminal shipments.
//	@Tags			ml-config
//	@Produce		json
//	@Security		BearerAuth
//	@Param			id	path		int	true	"Config ID"
//	@Success		200	{object}	activateResponse
//	@Failure		400	{object}	map[string]string
//	@Router			/ml/config/{id}/activate [post]
func (h *MLConfigHandler) Activate(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID de configuración inválido"})
		return
	}

	cfg, count, err := h.svc.ActivateConfig(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, activateResponse{
		Config:            cfg,
		RecalculatedCount: count,
	})
}
