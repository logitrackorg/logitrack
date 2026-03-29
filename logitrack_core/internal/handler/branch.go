package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/repository"
)

type BranchHandler struct {
	repo repository.BranchRepository
}

func NewBranchHandler(repo repository.BranchRepository) *BranchHandler {
	return &BranchHandler{repo: repo}
}

func (h *BranchHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/branches", h.List)
}

// List returns all logistics branches.
//
// @Summary      List branches
// @Description  Returns all branches. Accessible to operator, supervisor, manager, and admin roles.
// @Tags         branches
// @Produce      json
// @Security     BearerAuth
// @Success      200  {array}   model.Branch
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Router       /branches [get]
func (h *BranchHandler) List(c *gin.Context) {
	c.JSON(http.StatusOK, h.repo.List())
}
