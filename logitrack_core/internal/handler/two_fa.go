package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"   
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type TwoFAHandler struct {
	service   service.TwoFAService
	accessLog repository.AccessLogRepository
}

func NewTwoFAHandler(service service.TwoFAService, accessLog repository.AccessLogRepository) *TwoFAHandler {
	return &TwoFAHandler{
		service:   service,
		accessLog: accessLog,
	}
}

func (h *TwoFAHandler) RegisterRoutes(r *gin.RouterGroup, authMiddleware gin.HandlerFunc) {
	// Rutas protegidas (requieren autenticación)
	protected := r.Group("")
	protected.Use(authMiddleware)
	{
		// CA 1: Iniciar configuración de 2FA
		protected.POST("/2fa/setup", middleware.RequireRoles(
			model.RoleAdmin,
			model.RoleManager,
			model.RoleSupervisor,
			model.RoleOperator,
		), h.Setup)

		// CA 2: Confirmar activación de 2FA
		protected.POST("/2fa/confirm", middleware.RequireRoles(
			model.RoleAdmin,
			model.RoleManager,
			model.RoleSupervisor,
			model.RoleOperator,
		), h.Confirm)

		// Desactivar 2FA
		protected.POST("/2fa/disable", middleware.RequireRoles(
			model.RoleAdmin,
			model.RoleManager,
			model.RoleSupervisor,
			model.RoleOperator,
		), h.Disable)
	}

	// Ruta pública: verificación de código durante login
	r.POST("/2fa/verify", h.Verify)
}

// Setup inicia el proceso de vinculación 2FA
//
// @Summary      Iniciar configuración 2FA
// @Description  Genera un QR code y secret para vincular con Google Authenticator
// @Tags         2fa
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  model.TwoFASetupResponse
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Router       /2fa/setup [post]
func (h *TwoFAHandler) Setup(c *gin.Context) {
	user, exists := c.Get(middleware.UserKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
		return
	}

	u := user.(model.User)

	// Prevenir re-enrolamiento si ya está activo
	if u.TwoFAEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "2FA ya está activado en esta cuenta"})
		return
	}

	response, err := h.service.GenerateSetup(c.Request.Context(), u)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.logAccess(u.Username, u.ID, "2fa_setup_initiated")
	c.JSON(http.StatusOK, response)
}

// Confirm valida el código de activación inicial
//
// @Summary      Confirmar activación 2FA
// @Description  Valida el código de 6 dígitos para activar 2FA definitivamente
// @Tags         2fa
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body  model.TwoFAConfirmRequest  true  "Código de verificación"
// @Success      200  {object}  map[string]string
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Router       /2fa/confirm [post]
func (h *TwoFAHandler) Confirm(c *gin.Context) {
	user, exists := c.Get(middleware.UserKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
		return
	}

	u := user.(model.User)

	var req model.TwoFAConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "código requerido (6 dígitos)"})
		return
	}

	// CA 2 y CA 3
	if err := h.service.ConfirmSetup(c.Request.Context(), u.ID, req.Code); err != nil {
		h.logAccess(u.Username, u.ID, "2fa_activation_failed")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.logAccess(u.Username, u.ID, "2fa_activated")
	c.JSON(http.StatusOK, gin.H{
		"message": "Autenticación de doble factor activada exitosamente",
	})
}

// Verify valida el código TOTP durante el login
//
// @Summary      Verificar código 2FA
// @Description  Valida el código de 6 dígitos después de ingresar usuario/contraseña
// @Tags         2fa
// @Accept       json
// @Produce      json
// @Param        body  body  model.TwoFAVerifyRequest  true  "Session token y código"
// @Success      200  {object}  model.TwoFAVerifyResponse
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Router       /2fa/verify [post]
func (h *TwoFAHandler) Verify(c *gin.Context) {
	var req model.TwoFAVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// CA 1, CA 2 y CA 3
	response, err := h.service.VerifyCode(c.Request.Context(), req.SessionToken, req.Code)
	if err != nil {
		if err == repository.ErrInvalidSessionToken {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "sesión expirada, intente iniciar sesión nuevamente"})
			return
		}
		if err == repository.ErrCodeAlreadyUsed {
			c.JSON(http.StatusBadRequest, gin.H{"error": "código ya utilizado, espere el siguiente"})
			return
		}
		h.logAccess("", "", "2fa_verification_failed")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.logAccess(response.User.Username, response.User.ID, "2fa_verification_success")
	c.JSON(http.StatusOK, response)
}

// Disable desactiva 2FA (requiere contraseña + código actual)
//
// @Summary      Desactivar 2FA
// @Description  Desactiva la autenticación de doble factor
// @Tags         2fa
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body  model.TwoFADisableRequest  true  "Contraseña y código actual"
// @Success      200  {object}  map[string]string
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Router       /2fa/disable [post]
func (h *TwoFAHandler) Disable(c *gin.Context) {
	user, exists := c.Get(middleware.UserKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
		return
	}

	u := user.(model.User)

	var req model.TwoFADisableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.service.Disable(c.Request.Context(), u.ID, req.Password, req.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.logAccess(u.Username, u.ID, "2fa_disabled")
	c.JSON(http.StatusOK, gin.H{"message": "Autenticación de doble factor desactivada"})
}

func (h *TwoFAHandler) logAccess(username, userID, event string) {
	_ = h.accessLog.Log(model.AccessLog{
		ID:        uuid.NewString(),
		Username:  username,
		UserID:    userID,
		EventType: model.AccessEventType(event),
		Timestamp: time.Now(),
	})
}