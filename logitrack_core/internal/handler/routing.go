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

// Regenerate regenera el plan del día para la sucursal del operador/supervisor.
// Solo accesible por operator y supervisor (shipmentWrite middleware).
func (h *RoutingHandler) Regenerate(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "el usuario no tiene sucursal asignada"})
		return
	}

	plan, err := h.svc.RegenerateBranchPlan(c.Request.Context(), user.BranchID)
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

// RegenerateGlobal regenera el plan global de toda la red. Solo admin.
// Devuelve solo el log (métricas), no el plan completo — el admin no
// necesita ver el detalle operativo, solo confirmar que corrió.
func (h *RoutingHandler) RegenerateGlobal(c *gin.Context) {
	plan, err := h.svc.RegenerateTodayPlan(c.Request.Context())
	if err != nil {
		if strings.Contains(err.Error(), "ya fue aplicado") {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"plan_date":    plan.PlanDate,
		"status":       plan.Status,
		"log":          plan.Log,
		"generated_at": plan.GeneratedAt,
	})
}

// applyRequestBody es el body del POST /routing/apply.
// Soporta tres niveles de granularidad:
//   - vehicle_id != "" → aplica solo ese despacho inter-sucursal
//   - driver_id  != "" → aplica solo esa ruta de última milla
//   - ambos vacíos     → aplica todos los ítems pendientes de la sucursal
//
// Si plan != nil se ignoran vehicle_id/driver_id y se aplica ese plan editado
// en cliente (flujo legacy drag-and-drop para compatibilidad).
type applyRequestBody struct {
	BranchID  string             `json:"branch_id"`
	Plan      *model.RoutingPlan `json:"plan,omitempty"`
	VehicleID string             `json:"vehicle_id,omitempty"`
	DriverID  string             `json:"driver_id,omitempty"`
}

// Apply aplica el plan de ruteo con granularidad configurable.
func (h *RoutingHandler) Apply(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	var req applyRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
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

	// Flujo granular (con o sin plan editado en body).
	// Si vehicle_id o driver_id están presentes, se aplica solo ese ítem;
	// si plan también está presente, se mergea primero a DB preservando AppliedShipments.
	if req.VehicleID != "" || req.DriverID != "" {
		resp, err := h.svc.ApplyPlanItems(c.Request.Context(), branchID, req.Plan, req.VehicleID, req.DriverID, user.Username)
		if err != nil {
			status := http.StatusInternalServerError
			if strings.Contains(err.Error(), "no hay plan") {
				status = http.StatusNotFound
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
		return
	}

	// Flujo legacy: plan editado completo enviado en body sin target granular.
	if req.Plan != nil {
		applyReq := model.ApplyPlanRequest{BranchID: branchID, Plan: *req.Plan}
		resp, err := h.svc.ApplyPlan(c.Request.Context(), branchID, applyReq, user.Username)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		go func() {
			_ = h.svc.SyncAppliedItems(branchID, req.Plan, user.Username)
		}()
		c.JSON(http.StatusOK, resp)
		return
	}

	// Sin granular ni plan: aplica todos los items pendientes de la sucursal desde DB.
	resp, err := h.svc.ApplyPlanItems(c.Request.Context(), branchID, nil, "", "", user.Username)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "no hay plan") {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// GetHorizonPlans devuelve el horizonte de planes: hoy (con overrides runtime)
// + N-1 pronósticos read-only (IsForecast=true), filtrados por sucursal según rol.
func (h *RoutingHandler) GetHorizonPlans(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	plans, err := h.svc.GetHorizonPlans(user.Role, user.BranchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plans)
}

// RecomputeLastMile recalcula el orden de paradas y horario sugerido para
// una asignación de última milla según el modo solicitado (ventanas/segura/costo).
// No aplica ni muta el plan persistido.
func (h *RoutingHandler) RecomputeLastMile(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	if user.BranchID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "el usuario no tiene sucursal asignada"})
		return
	}

	var req model.RecomputeLastMileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !req.Mode.IsValid() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "modo inválido: debe ser ventanas, segura o costo"})
		return
	}

	result, err := h.svc.RecomputeLastMileAssignment(c.Request.Context(), user.BranchID, req)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "no encontrado") || strings.Contains(err.Error(), "no pertenece") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func canRouteForBranch(user model.User, branchID string) bool {
	if user.Role != model.RoleOperator && user.Role != model.RoleSupervisor {
		return false
	}
	return user.BranchID == branchID
}
