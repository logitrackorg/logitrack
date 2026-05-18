package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

// BranchGraphHandler expone el grafo de sucursales.
// Los endpoints de lectura son admin-only; el toggle de enabled también.
type BranchGraphHandler struct {
	svc *service.BranchGraphService
}

func NewBranchGraphHandler(svc *service.BranchGraphService) *BranchGraphHandler {
	return &BranchGraphHandler{svc: svc}
}

// GET /admin/branches/graph
func (h *BranchGraphHandler) GetGraph(c *gin.Context) {
	graph, err := h.svc.GetGraph()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, graph)
}

// POST /admin/branches/graph/derive — dispara el auto-derive manual
func (h *BranchGraphHandler) Derive(c *gin.Context) {
	count, err := h.svc.RunAutoderive()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"edges_processed": count})
}

// POST /admin/branches/graph — crea una arista manual
func (h *BranchGraphHandler) CreateEdge(c *gin.Context) {
	var body struct {
		FromBranchID    string  `json:"from_branch_id" binding:"required"`
		ToBranchID      string  `json:"to_branch_id"   binding:"required"`
		DistanceKm      float64 `json:"distance_km"`
		AvgTransitHours float64 `json:"avg_transit_hours"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.FromBranchID == body.ToBranchID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from y to no pueden ser la misma sucursal"})
		return
	}
	edge := model.BranchEdge{
		FromBranchID:    body.FromBranchID,
		ToBranchID:      body.ToBranchID,
		DistanceKm:      body.DistanceKm,
		AvgTransitHours: body.AvgTransitHours,
	}
	if err := h.svc.CreateEdge(edge); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true})
}

// PATCH /admin/branches/graph/:from/:to — toggle enabled
func (h *BranchGraphHandler) SetEnabled(c *gin.Context) {
	from := strings.TrimSpace(c.Param("from"))
	to := strings.TrimSpace(c.Param("to"))
	if from == "" || to == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from y to son requeridos"})
		return
	}

	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body inválido"})
		return
	}

	if err := h.svc.SetEnabled(from, to, body.Enabled); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
