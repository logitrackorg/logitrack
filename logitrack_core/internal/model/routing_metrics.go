package model

import "time"

// PlanMetric registra la calidad y performance de una llamada a GeneratePlan.
type PlanMetric struct {
	ID               string    `json:"id"`
	BranchID         string    `json:"branch_id"`
	GeneratedAt      time.Time `json:"generated_at"`
	GenerationTimeMs int64     `json:"generation_time_ms"`
	LastMileCount    int       `json:"last_mile_count"`
	InterBranchCount int       `json:"inter_branch_count"`
	UnassignedCount  int       `json:"unassigned_count"`
	// VRPUsed indica si se usó el solver VRP en lugar del greedy clásico.
	VRPUsed bool `json:"vrp_used"`
	// WindowCoveragePct es el promedio de cobertura de ventanas horarias entre todos
	// los choferes (0–100). Nil cuando el plan fue greedy o no hubo última milla.
	WindowCoveragePct *float64  `json:"window_coverage_pct,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

// ApplyMetric registra el resultado de una llamada a ApplyPlan.
type ApplyMetric struct {
	ID          string    `json:"id"`
	BranchID    string    `json:"branch_id"`
	AppliedAt   time.Time `json:"applied_at"`
	AppliedBy   string    `json:"applied_by"`
	AppliedCount int      `json:"applied_count"`
	FailedCount  int      `json:"failed_count"`
	// DriftCount es el subconjunto de fallos donde el estado del envío o vehículo
	// cambió entre la generación del plan y su aplicación.
	DriftCount int `json:"drift_count"`
	// ManualOverrideCount es la cantidad de envíos reubicados manualmente por el
	// operador antes de aplicar. El frontend lo envía; 0 si no se tocó el plan.
	ManualOverrideCount int       `json:"manual_override_count"`
	CreatedAt           time.Time `json:"created_at"`
}

// ShipmentHopMetric registra un tramo de tránsito: tiempo entre que un envío se
// carga en un vehículo (DepartedAt) y llega al siguiente hub (ArrivedAt).
// ArrivedAt es nil mientras el viaje está en curso.
type ShipmentHopMetric struct {
	ID           string     `json:"id"`
	TrackingID   string     `json:"tracking_id"`
	FromBranchID string     `json:"from_branch_id"`
	ToBranchID   string     `json:"to_branch_id"`
	DepartedAt   time.Time  `json:"departed_at"`
	ArrivedAt    *time.Time `json:"arrived_at,omitempty"`
	// TransitHours es nil hasta que ArrivedAt se registre.
	TransitHours *float64  `json:"transit_hours,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// ODPairVolume acumula el volumen de envíos confirmados por par origen-destino
// y fecha calendario. Es el insumo principal del forecasting de Phase 4.
type ODPairVolume struct {
	ID                  string    `json:"id"`
	OriginBranchID      string    `json:"origin_branch_id"`
	DestinationBranchID string    `json:"destination_branch_id"`
	Date                string    `json:"date"` // YYYY-MM-DD
	ShipmentCount       int       `json:"shipment_count"`
	TotalWeightKg       float64   `json:"total_weight_kg"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// RoutingMetricsSummary es un agregado diario para dashboard.
type RoutingMetricsSummary struct {
	Date             string  `json:"date"`
	BranchID         string  `json:"branch_id"`
	AvgGenTimeMs     float64 `json:"avg_gen_time_ms"`
	AvgUnassignedPct float64 `json:"avg_unassigned_pct"`
	AvgWindowCovPct  float64 `json:"avg_window_coverage_pct"`
	TotalApplied     int     `json:"total_applied"`
	TotalFailed      int     `json:"total_failed"`
	TotalDrift       int     `json:"total_drift"`
	AvgOverrideCount float64 `json:"avg_override_count"`
	PlanCount        int     `json:"plan_count"`
}
