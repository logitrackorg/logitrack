package model

import "time"

// PlanStatus es el estado del plan global del día.
type PlanStatus string

const (
	PlanStatusPending  PlanStatus = "pending"  // generado, listo para aplicar
	PlanStatusApplying PlanStatus = "applying" // apply en curso (lock optimista)
	PlanStatusApplied  PlanStatus = "applied"  // todos los items procesados
	PlanStatusExpired  PlanStatus = "expired"  // del día anterior, no se aplicó
)

// GlobalRoutingPlan es el plan de ruteo de un día para toda la red.
// Se persiste en la tabla routing_plans (singleton por plan_date).
// Cada sucursal activa tiene su BranchPlan con las asignaciones de última
// milla e inter-sucursal. El apply es por sucursal — operator/supervisor
// solo aplican los items de su propia sucursal.
type GlobalRoutingPlan struct {
	ID          string       `json:"id"`
	PlanDate    string       `json:"plan_date"`             // YYYY-MM-DD
	Status      PlanStatus   `json:"status"`
	BranchPlans []BranchPlan `json:"branch_plans"`
	GeneratedAt time.Time    `json:"generated_at"`
	AppliedAt   *time.Time   `json:"applied_at,omitempty"`
	AppliedBy   string       `json:"applied_by,omitempty"`
	Log         GlobalPlanLog `json:"log"`
}

// BranchPlan agrupa el plan de una sucursal dentro del GlobalRoutingPlan.
type BranchPlan struct {
	BranchID string      `json:"branch_id"`
	Plan     RoutingPlan `json:"plan"`
}

// GlobalPlanLog resume las métricas de la generación global.
type GlobalPlanLog struct {
	TotalCandidates int `json:"total_candidates"`
	TotalAssigned   int `json:"total_assigned"`
	TotalUnassigned int `json:"total_unassigned"`
	TotalBranches   int `json:"total_branches"`
}
