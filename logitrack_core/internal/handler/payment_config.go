package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type PaymentConfigHandler struct {
	svc *service.PaymentConfigService
}

func NewPaymentConfigHandler(svc *service.PaymentConfigService) *PaymentConfigHandler {
	return &PaymentConfigHandler{svc: svc}
}

// Get returns the current config. Sensitive credential fields are masked.
func (h *PaymentConfigHandler) Get(c *gin.Context) {
	cfg := h.svc.Get()
	c.JSON(http.StatusOK, maskCredentials(cfg))
}

// Update saves non-sensitive fields (flags, alias, CVU).
func (h *PaymentConfigHandler) Update(c *gin.Context) {
	var cfg model.PaymentConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	updated, err := h.svc.Update(cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, maskCredentials(updated))
}

type updateCredentialsRequest struct {
	CurrentAccessToken   string `json:"current_access_token"`
	NewAccessToken       string `json:"new_access_token"`
	CurrentWebhookSecret string `json:"current_webhook_secret"`
	NewWebhookSecret     string `json:"new_webhook_secret"`
}

// UpdateCredentials validates current credentials before replacing them.
func (h *PaymentConfigHandler) UpdateCredentials(c *gin.Context) {
	var req updateCredentialsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	if req.NewAccessToken == "" && req.NewWebhookSecret == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Debés proporcionar al menos un nuevo valor"})
		return
	}
	updated, err := h.svc.UpdateCredentials(
		req.CurrentAccessToken, req.NewAccessToken,
		req.CurrentWebhookSecret, req.NewWebhookSecret,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, maskCredentials(updated))
}

// maskCredentials returns a copy of cfg with sensitive fields replaced by a masked value,
// or an empty string when no credential is stored.
func maskCredentials(cfg model.PaymentConfig) model.PaymentConfig {
	cfg.MPAccessToken = maskSecret(cfg.MPAccessToken)
	cfg.MPWebhookSecret = maskSecret(cfg.MPWebhookSecret)
	return cfg
}

// maskSecret returns "••••••••[last4]" for non-empty secrets, or "" when empty.
func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= 4 {
		return strings.Repeat("•", len(runes))
	}
	return "••••••••" + string(runes[len(runes)-4:])
}
