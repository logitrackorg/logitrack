package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type RoutingHandler struct {
	svc *service.RoutingService
}

func NewRoutingHandler(svc *service.RoutingService) *RoutingHandler {
	return &RoutingHandler{svc: svc}
}

type generatePlanRequest struct {
	BranchID string `json:"branch_id" binding:"required"`
}

// Generate crea un plan sugerido en memoria. No persiste cambios.
// Operadores y supervisores solo pueden generar para su propia sucursal.
func (h *RoutingHandler) Generate(c *gin.Context) {
	var req generatePlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	branchID := strings.TrimSpace(req.BranchID)
	if branchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branch_id es obligatorio"})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)
	if !canRouteForBranch(user, branchID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "solo podés generar planes para tu sucursal"})
		return
	}

	plan, err := h.svc.GeneratePlan(c.Request.Context(), branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

// Apply aplica el plan editado por el usuario. Hace validación per-item; no es transaccional.
func (h *RoutingHandler) Apply(c *gin.Context) {
	var req model.ApplyPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	branchID := strings.TrimSpace(req.BranchID)
	if branchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branch_id es obligatorio"})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)
	if !canRouteForBranch(user, branchID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "solo podés aplicar planes de tu sucursal"})
		return
	}

	resp, err := h.svc.ApplyPlan(c.Request.Context(), branchID, req, user.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

func canRouteForBranch(user model.User, branchID string) bool {
	if user.Role != model.RoleOperator && user.Role != model.RoleSupervisor {
		return false
	}
	return user.BranchID == branchID
}
