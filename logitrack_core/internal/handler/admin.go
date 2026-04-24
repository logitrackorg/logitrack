package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var rolesRequiringBranch = map[model.Role]bool{
	model.RoleOperator:   true,
	model.RoleSupervisor: true,
	model.RoleDriver:     true,
}

type AdminHandler struct {
	authRepo repository.AuthRepository
}

func NewAdminHandler(authRepo repository.AuthRepository) *AdminHandler {
	return &AdminHandler{authRepo: authRepo}
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	users := h.authRepo.ListAll()
	c.JSON(http.StatusOK, gin.H{"users": users})
}

type createUserRequest struct {
	Username string     `json:"username"  binding:"required"`
	Password string     `json:"password"  binding:"required"`
	Role     model.Role `json:"role"      binding:"required"`
	BranchID string     `json:"branch_id"`
}

type updateUserRequest struct {
	Username *string     `json:"username"`
	Role     *model.Role `json:"role"`
	BranchID *string     `json:"branch_id"`
}

func (h *AdminHandler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rolesRequiringBranch[req.Role] && req.BranchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branch is required for this role"})
		return
	}
	user, err := h.authRepo.CreateUser(req.Username, req.Password, req.Role, req.BranchID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, user)
}

func (h *AdminHandler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Role != nil && rolesRequiringBranch[*req.Role] {
		if req.BranchID != nil && *req.BranchID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "branch is required for this role"})
			return
		}
	}
	update := repository.UserUpdate{
		Username: req.Username,
		Role:     req.Role,
		BranchID: req.BranchID,
	}
	user, err := h.authRepo.UpdateUser(id, update)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, user)
}
