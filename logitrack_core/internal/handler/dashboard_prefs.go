package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type DashboardPreferencesHandler struct {
	svc *service.DashboardPreferencesService
}

func NewDashboardPreferencesHandler(svc *service.DashboardPreferencesService) *DashboardPreferencesHandler {
	return &DashboardPreferencesHandler{svc: svc}
}

type dashboardPrefItem struct {
	MetricID    string `json:"metric_id"`
	MetricLabel string `json:"metric_label"`
	SortOrder   int    `json:"sort_order"`
	IsHidden    bool   `json:"is_hidden"`
}

// Get — GET /preferences/dashboard
// Returns the ordered list of admin-permitted metrics with the user's sort/hide preferences.
func (h *DashboardPreferencesHandler) Get(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	prefs, err := h.svc.GetEffective(u.ID, string(u.Role))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	labelMap := make(map[string]string, len(model.AllMetrics))
	for _, m := range model.AllMetrics {
		labelMap[m.ID] = m.Label
	}

	resp := make([]dashboardPrefItem, len(prefs))
	for i, p := range prefs {
		resp[i] = dashboardPrefItem{
			MetricID:    p.MetricID,
			MetricLabel: labelMap[p.MetricID],
			SortOrder:   p.SortOrder,
			IsHidden:    p.IsHidden,
		}
	}
	c.JSON(http.StatusOK, resp)
}

type saveDashboardPrefsRequest struct {
	Preferences []model.UserDashboardPreference `json:"preferences" binding:"required"`
}

// Save — PUT /preferences/dashboard
// Upserts the user's dashboard metric preferences in a single transaction.
func (h *DashboardPreferencesHandler) Save(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	var req saveDashboardPrefsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Save(u.ID, req.Preferences); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
