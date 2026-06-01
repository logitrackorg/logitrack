package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/service"
)

type PasswordResetHandler struct {
	svc *service.PasswordResetService
}

func NewPasswordResetHandler(svc *service.PasswordResetService) *PasswordResetHandler {
	return &PasswordResetHandler{svc: svc}
}

func (h *PasswordResetHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/auth/password-reset/request", h.Request)
	r.POST("/auth/password-reset/confirm", h.Confirm)
}

func (h *PasswordResetHandler) Request(c *gin.Context) {
	var body struct {
		Username string `json:"username" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RequestReset(body.Username); err != nil {
		if errors.Is(err, service.ErrRateLimited) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
			return
		}
		// Internal errors are swallowed — same generic response to avoid enumeration
		c.JSON(http.StatusOK, gin.H{"message": "Si el usuario existe y tiene contacto registrado, recibirás un código."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Si el usuario existe y tiene contacto registrado, recibirás un código."})
}

func (h *PasswordResetHandler) Confirm(c *gin.Context) {
	var body struct {
		Username    string `json:"username" binding:"required"`
		OTP         string `json:"otp" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ConfirmReset(body.Username, body.OTP, body.NewPassword); err != nil {
		if errors.Is(err, service.ErrWeakPassword) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Contraseña actualizada correctamente."})
}
