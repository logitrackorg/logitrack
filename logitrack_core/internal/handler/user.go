package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type UserHandler struct {
	authRepo repository.AuthRepository
}

func NewUserHandler(authRepo repository.AuthRepository) *UserHandler {
	return &UserHandler{authRepo: authRepo}
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
	drivers := h.authRepo.ListByRole(model.RoleDriver)
	c.JSON(http.StatusOK, gin.H{"drivers": drivers})
}
