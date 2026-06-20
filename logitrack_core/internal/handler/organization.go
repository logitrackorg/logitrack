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

// GetPublic expone únicamente los campos de marca (nombre, colores, logo) sin
// requerir autenticación, para aplicar el tema en la pantalla de login y en el
// primer render. No incluye datos sensibles (CUIT, dirección, email, teléfono).
func (h *OrganizationHandler) GetPublic(c *gin.Context) {
	cfg, err := h.svc.Get()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener la configuración de la organización"})
		return
	}
	if cfg == nil {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"name":          cfg.Name,
		"font_family":   cfg.FontFamily,
		"primary_color": cfg.PrimaryColor,
		"accent_color":  cfg.AccentColor,
		"sidebar_color": cfg.SidebarColor,
		"logo_url":      cfg.LogoURL,
	})
}

type updateOrgRequest struct {
	Name         string `json:"name"`
	CUIT         string `json:"cuit"`
	Address      string `json:"address"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	FontFamily   string `json:"font_family"`
	TrackURL     string `json:"track_url"`
	PrimaryColor string `json:"primary_color"`
	AccentColor  string `json:"accent_color"`
	SidebarColor string `json:"sidebar_color"`
	LogoURL      string `json:"logo_url"`
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
		Name:         req.Name,
		CUIT:         req.CUIT,
		Address:      req.Address,
		Phone:        req.Phone,
		Email:        req.Email,
		FontFamily:   req.FontFamily,
		TrackURL:     req.TrackURL,
		PrimaryColor: req.PrimaryColor,
		AccentColor:  req.AccentColor,
		SidebarColor: req.SidebarColor,
		LogoURL:      req.LogoURL,
	}

	result, err := h.svc.Update(cfg, updatedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
