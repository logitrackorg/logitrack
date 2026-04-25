package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type AuthHandler struct {
	repo      repository.AuthRepository
	accessLog repository.AccessLogRepository
}

func NewAuthHandler(repo repository.AuthRepository, accessLog repository.AccessLogRepository) *AuthHandler {
	return &AuthHandler{repo: repo, accessLog: accessLog}
}

func (h *AuthHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/auth/login", h.Login)
	r.POST("/auth/logout", h.Logout)
}

func (h *AuthHandler) log(username, userID string, event model.AccessEventType) {
	_ = h.accessLog.Log(model.AccessLog{
		ID:        uuid.NewString(),
		Username:  username,
		UserID:    userID,
		EventType: event,
		Timestamp: time.Now(),
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
		h.log(req.Username, "", model.AccessEventLoginFailure)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}
	token := uuid.NewString()
	h.repo.SaveToken(token, user)
	h.log(user.Username, user.ID, model.AccessEventLoginSuccess)
	c.JSON(http.StatusOK, model.LoginResponse{Token: token, User: user})
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
			h.log(user.Username, user.ID, model.AccessEventLogout)
		}
		h.repo.DeleteToken(token)
	}
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
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
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.JSON(http.StatusOK, user.(model.User))
}
