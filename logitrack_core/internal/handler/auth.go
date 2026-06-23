package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type AuthHandler struct {
	repo      repository.AuthRepository
	accessLog repository.AccessLogRepository
	twoFARepo repository.TwoFARepository
}

func NewAuthHandler(repo repository.AuthRepository, accessLog repository.AccessLogRepository, twoFARepo repository.TwoFARepository) *AuthHandler {
	return &AuthHandler{repo: repo, accessLog: accessLog, twoFARepo: twoFARepo}
}

func (h *AuthHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/auth/login", h.Login)
	r.POST("/auth/logout", h.Logout)
}

func (h *AuthHandler) logWithContext(c *gin.Context, username, userID, role string, event model.AccessEventType, failureReason string) {
	ip := c.ClientIP()
	loc := geo.LookupIP(ip)

	result := "success"
	if event == model.AccessEventLoginFailure {
		result = "failure"
	}

	_ = h.accessLog.Log(model.AccessLog{
		ID:            uuid.NewString(),
		Username:      username,
		UserID:        userID,
		Role:          role,
		EventType:     event,
		IPAddress:     ip,
		Country:       loc.Country,
		City:          loc.City,
		Result:        result,
		FailureReason: failureReason,
		Timestamp:     clock.Now(),
	})
}

// Login authenticates a user and returns a Bearer token.
//
// @Summary      Login
// @Description  Authenticate with username and password. Returns a Bearer token valid until server restart.
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      model.LoginRequest   true  "Credentials"
// @Success      200   {object}  model.LoginResponse
// @Failure      400   {object}  map[string]string
// @Failure      401   {object}  map[string]string
// @Router       /auth/login [post]
func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.repo.FindUser(req.Username, req.Password)
	if err != nil {
		if err == repository.ErrAccountInactive {
			h.logWithContext(c, req.Username, "", "", model.AccessEventLoginFailure, "account_inactive")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "account_inactive"})
			return
		}
		h.logWithContext(c, req.Username, "", "", model.AccessEventLoginFailure, "invalid_credentials")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials"})
		return
	}

	if user.TwoFAEnabled {

		sessionToken, err := h.twoFARepo.CreatePendingSession(
			c.Request.Context(),
			user.ID,
			5*time.Minute,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "error creando sesión temporal"})
			return
		}

		h.logWithContext(c, user.Username, user.ID, string(user.Role), "2fa_required", "")

		c.JSON(http.StatusOK, model.LoginResponse{
			Requires2FA:  true,
			SessionToken: sessionToken,
		})
		return
	}

	token := uuid.NewString()
	h.repo.SaveToken(token, user)
	h.logWithContext(c, user.Username, user.ID, string(user.Role), model.AccessEventLoginSuccess, "")

	c.JSON(http.StatusOK, model.LoginResponse{
		Token:       token,
		User:        user,
		Requires2FA: false,
	})
}

// Logout invalidates the current Bearer token.
//
// @Summary      Logout
// @Description  Invalidates the token sent in the Authorization header.
// @Tags         auth
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  map[string]string
// @Router       /auth/logout [post]
func (h *AuthHandler) Logout(c *gin.Context) {
	header := c.GetHeader("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		token := strings.TrimPrefix(header, "Bearer ")
		if user, err := h.repo.GetUserByToken(token); err == nil {
			h.logWithContext(c, user.Username, user.ID, string(user.Role), model.AccessEventLogout, "")
		}
		h.repo.DeleteToken(token)
	}
	c.JSON(http.StatusOK, gin.H{"message": "sesión cerrada"})
}

// Me returns the currently authenticated user.
//
// @Summary      Current user
// @Description  Returns the user associated with the current Bearer token.
// @Tags         auth
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  model.User
// @Failure      401  {object}  map[string]string
// @Router       /auth/me [get]
func (h *AuthHandler) Me(c *gin.Context) {
	user, exists := c.Get(middleware.UserKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
		return
	}
	c.JSON(http.StatusOK, user.(model.User))
}
