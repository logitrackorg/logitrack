package handler

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var (
	reEmail    = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	reName     = regexp.MustCompile(`^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s'\-]+$`)
	reUsername = regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)
	rePostal   = regexp.MustCompile(`^[A-Z0-9]{4,10}$`)
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
	Username  string        `json:"username"   binding:"required"`
	Password  string        `json:"password"   binding:"required"`
	Role      model.Role    `json:"role"       binding:"required"`
	BranchID  string        `json:"branch_id"`
	FirstName string        `json:"first_name" binding:"required"`
	LastName  string        `json:"last_name"  binding:"required"`
	Email     string        `json:"email"      binding:"required"`
	Address   model.Address `json:"address"    binding:"required"`
}

type updateUserRequest struct {
	FirstName *string           `json:"first_name"`
	LastName  *string           `json:"last_name"`
	Email     *string           `json:"email"`
	Role      *model.Role       `json:"role"`
	BranchID  *string           `json:"branch_id"`
	Status    *model.UserStatus `json:"status"`
	Address   *model.Address    `json:"address"`
}

func validatePersonalFields(firstName, lastName, email string, addr model.Address) error {
	if !reName.MatchString(firstName) {
		return gin.Error{Err: errMsg("El nombre solo puede contener letras y espacios.")}
	}
	if !reName.MatchString(lastName) {
		return gin.Error{Err: errMsg("El apellido solo puede contener letras y espacios.")}
	}
	if !reEmail.MatchString(email) {
		return gin.Error{Err: errMsg("El email no tiene un formato válido (ej. usuario@dominio.com).")}
	}
	if addr.Street == "" || addr.City == "" || addr.Province == "" || addr.PostalCode == "" {
		return gin.Error{Err: errMsg("Todos los campos del domicilio son obligatorios.")}
	}
	if !rePostal.MatchString(addr.PostalCode) {
		return gin.Error{Err: errMsg("El código postal debe tener entre 4 y 10 caracteres alfanuméricos (ej. C1043, 5000).")}
	}
	return nil
}

type errMsg string

func (e errMsg) Error() string { return string(e) }

func (h *AdminHandler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !reUsername.MatchString(req.Username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El nombre de usuario solo puede contener letras, números, guiones y guiones bajos."})
		return
	}
	if rolesRequiringBranch[req.Role] && req.BranchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La sucursal es obligatoria para este rol."})
		return
	}
	if err := validatePersonalFields(req.FirstName, req.LastName, req.Email, req.Address); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := h.authRepo.CreateUser(repository.UserCreate{
		Username:  req.Username,
		Password:  req.Password,
		Role:      req.Role,
		BranchID:  req.BranchID,
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Email:     req.Email,
		Address:   req.Address,
	})
	if err != nil {
		switch err.Error() {
		case "email already in use":
			c.JSON(http.StatusConflict, gin.H{"error": "El email ya está en uso por otra cuenta."})
		case "username already exists":
			c.JSON(http.StatusConflict, gin.H{"error": "El nombre de usuario ya está en uso."})
		default:
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		}
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "La sucursal es obligatoria para este rol."})
			return
		}
	}
	if req.Status != nil && *req.Status != model.UserStatusActive && *req.Status != model.UserStatusInactive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido."})
		return
	}
	if req.FirstName != nil && !reName.MatchString(*req.FirstName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El nombre solo puede contener letras y espacios."})
		return
	}
	if req.LastName != nil && !reName.MatchString(*req.LastName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El apellido solo puede contener letras y espacios."})
		return
	}
	if req.Email != nil {
		if *req.Email == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "El email es obligatorio."})
			return
		}
		if !reEmail.MatchString(*req.Email) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "El email no tiene un formato válido (ej. usuario@dominio.com)."})
			return
		}
	}
	if req.Address != nil {
		if req.Address.Street == "" || req.Address.City == "" || req.Address.Province == "" || req.Address.PostalCode == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Todos los campos del domicilio son obligatorios."})
			return
		}
		if !rePostal.MatchString(req.Address.PostalCode) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "El código postal debe tener entre 4 y 10 caracteres alfanuméricos (ej. C1043, 5000)."})
			return
		}
	}

	currentUser, _ := c.Get("user")
	cu := currentUser.(model.User)
	updatedBy := cu.Username

	if req.Role != nil && id == cu.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "No podés modificar tu propio rol."})
		return
	}

	update := repository.UserUpdate{
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Email:     req.Email,
		Role:      req.Role,
		BranchID:  req.BranchID,
		Status:    req.Status,
		Address:   req.Address,
		UpdatedBy: updatedBy,
	}
	user, err := h.authRepo.UpdateUser(id, update)
	if err != nil {
		if err.Error() == "email already in use" {
			c.JSON(http.StatusConflict, gin.H{"error": "El email ya está en uso por otra cuenta."})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, user)
}
