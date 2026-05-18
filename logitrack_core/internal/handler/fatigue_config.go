package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type FatigueConfigHandler struct {
	svc       *service.FatigueConfigService
	auditRepo *repository.AuditLogRepository
}

func NewFatigueConfigHandler(svc *service.FatigueConfigService, auditRepo *repository.AuditLogRepository) *FatigueConfigHandler {
	return &FatigueConfigHandler{svc: svc, auditRepo: auditRepo}
}

// Get returns the current fatigue model configuration (defaults if never saved).
func (h *FatigueConfigHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.Get())
}

// Update validates and persists the fatigue model configuration.
// On success it appends an immutable audit record (AC1).
func (h *FatigueConfigHandler) Update(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

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

	// Audit — non-blocking: config already saved, do not degrade the response.
	if detailsJSON, merr := json.Marshal(updated); merr == nil {
		_ = h.auditRepo.Append(model.AuditLog{
			ID:        model.NewAuditID(),
			CreatedAt: time.Now(),
			CreatedBy: user.Username,
			Action:    "UPDATE_FATIGUE_CONFIG",
			Details:   json.RawMessage(detailsJSON),
		})
	}

	c.JSON(http.StatusOK, updated)
}

// ListAuditLogs returns all audit records newest-first.
// Read-only endpoint — no DELETE or PUT counterpart exists (AC2).
func (h *FatigueConfigHandler) ListAuditLogs(c *gin.Context) {
	logs := h.auditRepo.ListAll()
	c.JSON(http.StatusOK, gin.H{
		"logs":  logs,
		"total": len(logs),
	})
}

// ResetCheckins stamps the current time so that any check-in recorded before
// this moment triggers the fatigue gate again. Check-in data is preserved.
func (h *FatigueConfigHandler) ResetCheckins(c *gin.Context) {
	updated, err := h.svc.ResetCheckins()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar el reset"})
		return
	}
	c.JSON(http.StatusOK, updated)
}
