package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type AuthHandler struct {
	repo repository.AuthRepository
}

func NewAuthHandler(repo repository.AuthRepository) *AuthHandler {
	return &AuthHandler{repo: repo}
}

func (h *AuthHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/auth/login", h.Login)
	r.POST("/auth/logout", h.Logout)
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
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}
	token := uuid.NewString()
	h.repo.SaveToken(token, user)
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
		h.repo.DeleteToken(strings.TrimPrefix(header, "Bearer "))
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
