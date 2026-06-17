package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
	"github.com/logitrack/core/internal/sse"
)

type MetricPermissionsHandler struct {
	svc *service.MetricPermissionsService
	hub *sse.PermissionsHub
}

func NewMetricPermissionsHandler(svc *service.MetricPermissionsService, hub *sse.PermissionsHub) *MetricPermissionsHandler {
	return &MetricPermissionsHandler{svc: svc, hub: hub}
}

// GetMatrix godoc — GET /admin/metric-permissions (adminOnly)
func (h *MetricPermissionsHandler) GetMatrix(c *gin.Context) {
	matrix, err := h.svc.GetMatrix()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, matrix)
}

type setPermissionRequest struct {
	RoleName  string `json:"role_name" binding:"required"`
	MetricID  string `json:"metric_id" binding:"required"`
	IsVisible bool   `json:"is_visible"`
}

// SetPermission godoc — PATCH /admin/metric-permissions (adminOnly)
func (h *MetricPermissionsHandler) SetPermission(c *gin.Context) {
	var req setPermissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	validRoles := map[string]bool{
		"operator": true, "supervisor": true, "manager": true, "admin": true, "driver": true,
	}
	if !validRoles[req.RoleName] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rol inválido"})
		return
	}
	validMetric := false
	for _, m := range model.AllMetrics {
		if m.ID == req.MetricID {
			validMetric = true
			break
		}
	}
	if !validMetric {
		c.JSON(http.StatusBadRequest, gin.H{"error": "métrica inválida"})
		return
	}
	if err := h.svc.Set(req.RoleName, req.MetricID, req.IsVisible); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast()
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type setPermissionBatchRequest struct {
	Changes []model.PermissionChange `json:"changes" binding:"required"`
}

// SetBatchPermissions godoc — POST /admin/metric-permissions/batch (adminOnly)
func (h *MetricPermissionsHandler) SetBatchPermissions(c *gin.Context) {
	var req setPermissionBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Changes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sin cambios"})
		return
	}
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	validRoles := map[string]bool{"supervisor": true, "manager": true}
	validMetrics := map[string]bool{}
	for _, m := range model.AllMetrics {
		validMetrics[m.ID] = true
	}
	for _, ch := range req.Changes {
		if !validRoles[ch.RoleName] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "rol inválido: " + ch.RoleName})
			return
		}
		if !validMetrics[ch.MetricID] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "métrica inválida: " + ch.MetricID})
			return
		}
	}
	batchID := uuid.New().String()
	if err := h.svc.SetBatch(u.ID, u.Username, batchID, req.Changes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast()
	c.JSON(http.StatusOK, gin.H{"ok": true, "batch_id": batchID})
}

// GetAuditLogs godoc — GET /admin/metric-permissions/audit-logs (adminOnly)
func (h *MetricPermissionsHandler) GetAuditLogs(c *gin.Context) {
	logs, err := h.svc.GetAuditLogs(c.Query("role"), c.Query("start_date"), c.Query("end_date"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if logs == nil {
		logs = []model.PermissionAuditLog{}
	}
	c.JSON(http.StatusOK, logs)
}

// GetForMe godoc — GET /metric-permissions/me (authenticated)
// Returns the effective metric visibility for the authenticated user:
// user-level overrides take precedence over role-level defaults.
func (h *MetricPermissionsHandler) GetForMe(c *gin.Context) {
	userI, _ := c.Get(middleware.UserKey)
	u, ok := userI.(model.User)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}
	perms, err := h.svc.GetEffectivePermissions(u.ID, string(u.Role))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, perms)
}

// ── User-level overrides — admin endpoints ────────────────────────────────────

// GetUserOverrides godoc — GET /admin/user-metric-permissions (adminOnly)
// Returns all user-level overrides as { overrides: { user_id: { metric_id: bool } } }.
func (h *MetricPermissionsHandler) GetUserOverrides(c *gin.Context) {
	overrides, err := h.svc.GetAllUserOverrides()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if overrides == nil {
		overrides = map[string]map[string]bool{}
	}
	c.JSON(http.StatusOK, gin.H{"overrides": overrides})
}

type setUserOverrideRequest struct {
	UserID    string `json:"user_id"    binding:"required"`
	MetricID  string `json:"metric_id"  binding:"required"`
	IsVisible bool   `json:"is_visible"`
}

// SetUserOverride godoc — PATCH /admin/user-metric-permissions (adminOnly)
// Creates or updates a single user-level permission override.
func (h *MetricPermissionsHandler) SetUserOverride(c *gin.Context) {
	var req setUserOverrideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	validMetrics := map[string]bool{}
	for _, m := range model.AllMetrics {
		validMetrics[m.ID] = true
	}
	if !validMetrics[req.MetricID] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "métrica inválida: " + req.MetricID})
		return
	}
	if err := h.svc.SetUserOverride(req.UserID, req.MetricID, req.IsVisible); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast()
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteUserOverride godoc — DELETE /admin/user-metric-permissions (adminOnly)
// Query params: user_id, metric_id. Removes the override; user reverts to role default.
func (h *MetricPermissionsHandler) DeleteUserOverride(c *gin.Context) {
	userID := c.Query("user_id")
	metricID := c.Query("metric_id")
	if userID == "" || metricID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id y metric_id son requeridos"})
		return
	}
	if err := h.svc.DeleteUserOverride(userID, metricID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.hub.Broadcast()
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Stream godoc — GET /events/permissions (AuthWithQueryParam)
func (h *MetricPermissionsHandler) Stream(c *gin.Context) {
	ch := h.hub.Subscribe()
	defer h.hub.Unsubscribe(ch)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	c.SSEvent("connected", `{"type":"permissions_stream"}`)
	c.Writer.Flush()

	ctx := c.Request.Context()
	for {
		select {
		case <-ch:
			c.SSEvent("permissions_updated", `{"type":"permissions_updated"}`)
			c.Writer.Flush()
		case <-ctx.Done():
			return
		}
	}
}
