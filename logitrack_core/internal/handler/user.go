package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type UserHandler struct {
	authRepo   repository.AuthRepository
	userSvc    *service.UserService
}

func NewUserHandler(authRepo repository.AuthRepository, userSvc *service.UserService) *UserHandler {
	return &UserHandler{authRepo: authRepo, userSvc: userSvc}
}

// ListDrivers returns all users with the driver role.
//
// @Summary      List drivers
// @Description  Returns all driver users. Supervisor and admin only.
// @Tags         users
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  map[string][]model.User  "drivers"
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Router       /users/drivers [get]
func (h *UserHandler) ListDrivers(c *gin.Context) {
	drivers := h.authRepo.ListByRole(model.RoleDriver, c.Query("branch_id"))
	c.JSON(http.StatusOK, gin.H{"drivers": drivers})
}

// GetMe returns the authenticated user's profile.
//
// @Summary      Current user profile
// @Description  Returns the authenticated user's full profile information.
// @Tags         users
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  model.UserProfileResponse
// @Failure      401  {object}  map[string]string
// @Router       /users/me [get]
func (h *UserHandler) GetMe(c *gin.Context) {
	user, exists := c.Get(middleware.UserKey)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
		return
	}
	u := user.(model.User)
	profile, err := h.userSvc.GetProfile(c.Request.Context(), u.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al obtener el perfil"})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// ChangePassword changes the current user's password.
//
// @Summary      Change password
// @Description  Changes the authenticated user's password.
// @Tags         users
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        request body model.ChangePasswordRequest true "Password change request"
// @Success      200 {object} map[string]string
// @Failure      400 {object} map[string]string
// @Failure      401 {object} map[string]string
// @Router       /users/me/password [post]
func (h *UserHandler) ChangePassword(c *gin.Context) {
	user, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autorizado"})
		return
	}
	u := user.(model.User)

	var req model.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.userSvc.ChangePassword(c.Request.Context(), u.ID, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "contraseña cambiada exitosamente"})
}
