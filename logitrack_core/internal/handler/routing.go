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

// GetTodayPlan devuelve el plan global del día. Operator/supervisor ven solo
// los items de su sucursal. Manager/admin ven el plan completo.
func (h *RoutingHandler) GetTodayPlan(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	plan, err := h.svc.GetTodayPlan(user.Role, user.BranchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if plan == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no hay plan generado para hoy"})
		return
	}
	c.JSON(http.StatusOK, plan)
}

// Regenerate regenera el plan del día. Solo manager/admin. No sobreescribe si ya fue aplicado.
func (h *RoutingHandler) Regenerate(c *gin.Context) {
	plan, err := h.svc.RegenerateTodayPlan(c.Request.Context())
	if err != nil {
		if strings.Contains(err.Error(), "ya fue aplicado") {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}

// applyRequestBody es el body del POST /routing/apply.
// Si Plan está presente, se aplica ese plan (editado en el cliente).
// Si BranchID está vacío y Plan está presente, se toma la sucursal del usuario.
type applyRequestBody struct {
	BranchID string            `json:"branch_id"`
	Plan     *model.RoutingPlan `json:"plan,omitempty"`
}

// Apply aplica el plan de ruteo para la sucursal del operador/supervisor.
// Si el body incluye `plan`, aplica ese plan (editado en cliente — drag-and-drop).
// Si no hay `plan` en el body, lee el plan del repositorio (generado por cron o regenerate).
func (h *RoutingHandler) Apply(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	var req applyRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		// Body vacío o inválido → intentar leer de DB con sucursal del usuario.
		req = applyRequestBody{}
	}

	branchID := strings.TrimSpace(req.BranchID)
	if branchID == "" {
		branchID = user.BranchID
	}
	if branchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branch_id requerido"})
		return
	}
	if !canRouteForBranch(user, branchID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "solo podés aplicar planes de tu sucursal"})
		return
	}

	if req.Plan != nil {
		// Plan editado en cliente.
		applyReq := model.ApplyPlanRequest{BranchID: branchID, Plan: *req.Plan}
		resp, err := h.svc.ApplyPlan(c.Request.Context(), branchID, applyReq, user.Username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
		return
	}

	// Sin plan en body → leer de DB.
	resp, err := h.svc.ApplyBranchPlan(c.Request.Context(), branchID, user.Username)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "no hay plan") || strings.Contains(err.Error(), "ya fue aplicado") {
			status = http.StatusConflict
		}
		c.JSON(status, gin.H{"error": err.Error()})
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
