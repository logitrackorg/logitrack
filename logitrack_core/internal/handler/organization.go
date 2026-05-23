package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type OrganizationHandler struct {
	svc *service.OrganizationService
}

func NewOrganizationHandler(svc *service.OrganizationService) *OrganizationHandler {
	return &OrganizationHandler{svc: svc}
}

func (h *OrganizationHandler) Get(c *gin.Context) {
	cfg, err := h.svc.Get()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener la configuración de la organización"})
		return
	}
	if cfg == nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

type updateOrgRequest struct {
	Name    string `json:"name"`
	CUIT    string `json:"cuit"`
	Address string `json:"address"`
	Phone   string `json:"phone"`
	Email   string `json:"email"`
}

func (h *OrganizationHandler) Update(c *gin.Context) {
	var req updateOrgRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido"})
		return
	}

	userVal, _ := c.Get(middleware.UserKey)
	user, _ := userVal.(*model.User)
	updatedBy := ""
	if user != nil {
		updatedBy = user.Username
	}

	cfg := model.OrganizationConfig{
		Name:    req.Name,
		CUIT:    req.CUIT,
		Address: req.Address,
		Phone:   req.Phone,
		Email:   req.Email,
	}

	result, err := h.svc.Update(cfg, updatedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
