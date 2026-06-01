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
//
// HorizonOffset=0 → plan aplicable (hoy). HorizonOffset>0 → pronóstico
// read-only (no se puede aplicar). Los pronósticos se regeneran cada día.
type GlobalRoutingPlan struct {
	ID              string       `json:"id"`
	PlanDate        string       `json:"plan_date"`             // YYYY-MM-DD
	Status          PlanStatus   `json:"status"`
	BranchPlans     []BranchPlan `json:"branch_plans"`
	GeneratedAt     time.Time    `json:"generated_at"`
	AppliedAt       *time.Time   `json:"applied_at,omitempty"`
	AppliedBy       string       `json:"applied_by,omitempty"`
	Log             GlobalPlanLog `json:"log"`
	Insights        NetworkInsights `json:"insights"`
	// AppliedBranches lista las sucursales que ya completaron su apply.
	// Cuando todas las sucursales del plan están en esta lista, el plan pasa a "applied".
	AppliedBranches []string `json:"applied_branches"`

	// HorizonOffset es la cantidad de días desde hoy. 0=hoy (aplicable), 1/2=pronóstico.
	HorizonOffset int  `json:"horizon_offset"`
	// IsForecast=true cuando HorizonOffset>0. Los pronósticos no se pueden aplicar.
	IsForecast    bool `json:"is_forecast"`
}

// NetworkInsights agrupa el análisis cross-branch del plan global.
type NetworkInsights struct {
	EmptyMoves                 []EmptyMoveSuggestion      `json:"empty_moves"`
	ConsolidationOpportunities []ConsolidationOpportunity `json:"consolidation_opportunities"`
	Metrics                    NetworkMetrics             `json:"metrics"`
}

// EmptyMoveSuggestion sugiere reubicar un vehículo ocioso hacia una sucursal
// con demanda no atendida.
type EmptyMoveSuggestion struct {
	VehicleID         string  `json:"vehicle_id"`
	LicensePlate      string  `json:"license_plate"`
	CapacityKg        float64 `json:"capacity_kg"`
	FromBranchID      string  `json:"from_branch_id"`
	ToBranchID        string  `json:"to_branch_id"`
	DistanceKm        float64 `json:"distance_km"`
	UnservedShipments int     `json:"unserved_shipments"`
	Reason            string  `json:"reason"`
}

// ConsolidationOpportunity indica que múltiples sucursales despachan hoy al mismo destino.
type ConsolidationOpportunity struct {
	DestinationBranchID string                 `json:"destination_branch_id"`
	Dispatches          []ConsolidationDispatch `json:"dispatches"`
	TotalWeightKg       float64                `json:"total_weight_kg"`
	AvgFillRatePct      float64                `json:"avg_fill_rate_pct"`
}

// ConsolidationDispatch describe un despacho dentro de una ConsolidationOpportunity.
type ConsolidationDispatch struct {
	FromBranchID  string  `json:"from_branch_id"`
	VehicleID     string  `json:"vehicle_id"`
	LicensePlate  string  `json:"license_plate"`
	TotalWeightKg float64 `json:"total_weight_kg"`
	CapacityKg    float64 `json:"capacity_kg"`
}

// NetworkMetrics agrega métricas globales de la red al momento de generación.
type NetworkMetrics struct {
	TotalShipmentsAssigned     int     `json:"total_shipments_assigned"`
	TotalShipmentsUnassigned   int     `json:"total_shipments_unassigned"`
	TotalVehiclesDispatched    int     `json:"total_vehicles_dispatched"`
	IdleVehiclesCount          int     `json:"idle_vehicles_count"`
	AvgVehicleUtilizationPct   float64 `json:"avg_vehicle_utilization_pct"`
	BranchesWithUnservedDemand int     `json:"branches_with_unserved_demand"`
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
