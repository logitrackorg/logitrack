package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type DashboardProfilesHandler struct {
	svc *service.DashboardProfilesService
}

func NewDashboardProfilesHandler(svc *service.DashboardProfilesService) *DashboardProfilesHandler {
	return &DashboardProfilesHandler{svc: svc}
}

type dashboardProfileResponse struct {
	ID          string             `json:"id"`
	UserID      string             `json:"user_id"`
	Name        string             `json:"name"`
	Preferences []dashboardPrefItem `json:"preferences"`
	CreatedAt   string             `json:"created_at"`
}

func toProfileResponse(p model.DashboardProfile) dashboardProfileResponse {
	labelMap := make(map[string]string, len(model.AllMetrics))
	for _, m := range model.AllMetrics {
		labelMap[m.ID] = m.Label
	}
	items := make([]dashboardPrefItem, len(p.Preferences))
	for i, pref := range p.Preferences {
		items[i] = dashboardPrefItem{
			MetricID:    pref.MetricID,
			MetricLabel: labelMap[pref.MetricID],
			SortOrder:   pref.SortOrder,
			IsHidden:    pref.IsHidden,
		}
	}
	return dashboardProfileResponse{
		ID:          p.ID,
		UserID:      p.UserID,
		Name:        p.Name,
		Preferences: items,
		CreatedAt:   p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// List — GET /profiles
// Returns all dashboard profiles belonging to the authenticated user.
func (h *DashboardProfilesHandler) List(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	profiles, err := h.svc.ListForUser(u.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp := make([]dashboardProfileResponse, len(profiles))
	for i, p := range profiles {
		resp[i] = toProfileResponse(p)
	}
	c.JSON(http.StatusOK, resp)
}

type createProfileRequest struct {
	Name        string                        `json:"name" binding:"required"`
	Preferences []model.UserDashboardPreference `json:"preferences" binding:"required"`
}

// Create — POST /profiles
// Creates a new named dashboard profile. Returns 400 if the user already has 5 profiles.
func (h *DashboardProfilesHandler) Create(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	var req createProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	profile, err := h.svc.Create(u.ID, req.Name, req.Preferences)
	if err != nil {
		if err == service.ErrMaxProfilesReached {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toProfileResponse(*profile))
}

// Delete — DELETE /profiles/:id
// Deletes a profile owned by the authenticated user.
func (h *DashboardProfilesHandler) Delete(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	id := c.Param("id")
	if err := h.svc.Delete(id, u.ID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
