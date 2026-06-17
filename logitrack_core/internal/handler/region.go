package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type RegionHandler struct {
	svc *service.RegionService
}

func NewRegionHandler(svc *service.RegionService) *RegionHandler {
	return &RegionHandler{svc: svc}
}

func (h *RegionHandler) List(c *gin.Context) {
	regions, err := h.svc.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener las zonas"})
		return
	}
	c.JSON(http.StatusOK, regions)
}

func (h *RegionHandler) Create(c *gin.Context) {
	var req model.CreateRegionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "datos inválidos"})
		return
	}
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "el nombre de la zona es requerido"})
		return
	}
	if len(req.Coordinates) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "se requieren al menos 3 coordenadas para definir una zona"})
		return
	}
	region, err := h.svc.Create(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar la zona"})
		return
	}
	c.JSON(http.StatusCreated, region)
}
