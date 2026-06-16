package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type DashboardResetHandler struct {
	svc *service.DashboardResetService
}

func NewDashboardResetHandler(svc *service.DashboardResetService) *DashboardResetHandler {
	return &DashboardResetHandler{svc: svc}
}

type resetDashboardRequest struct {
	UserID   string `json:"user_id"`
	ResetAll bool   `json:"reset_all"`
}

// ResetDashboard — POST /admin/reset-dashboard (admin only)
// Resets dashboard preferences for a specific user or for all supervisor/manager users.
func (h *DashboardResetHandler) ResetDashboard(c *gin.Context) {
	adminI, _ := c.Get(middleware.UserKey)
	admin, ok := adminI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	var req resetDashboardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var err error
	switch {
	case req.ResetAll:
		err = h.svc.ResetAll(admin.ID, admin.Username)
	case req.UserID != "":
		err = h.svc.ResetUser(admin.ID, admin.Username, req.UserID)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "se requiere user_id o reset_all: true"})
		return
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetResetStatus — GET /preferences/dashboard/reset-status (authenticated)
// Returns whether the current user has an unacknowledged admin reset notification.
func (h *DashboardResetHandler) GetResetStatus(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	wasReset, err := h.svc.GetResetFlag(u.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"was_reset_by_admin": wasReset})
}

// ClearResetFlag — PATCH /preferences/dashboard/clear-reset (authenticated)
// Called by the user after acknowledging the reset notification.
func (h *DashboardResetHandler) ClearResetFlag(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	if err := h.svc.ClearResetFlag(u.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
