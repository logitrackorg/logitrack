package model

type Stats struct {
	Total              int                   `json:"total"`
	ByStatus           map[Status]int        `json:"by_status"`
	ByBranch           map[string]int        `json:"by_branch"`            // branch ID → shipment count (excludes delivered/returned)
	ByDay              map[string]int        `json:"by_day"`               // YYYY-MM-DD → shipments created that day (within requested range)
	ByDayDelivered     map[string]int        `json:"by_day_delivered"`     // YYYY-MM-DD → shipments delivered that day (within requested range)
	AvgCycleTimeHours  *float64              `json:"avg_cycle_time_hours"` // tiempo promedio desde creación hasta entrega (en horas), null si no hay entregados
	SuccessRate        *float64              `json:"success_rate"`         // porcentaje de entregas exitosas sobre el total (0–100), null si total=0
	OpenIncidents      int                   `json:"open_incidents"`       // cantidad de envíos con has_incident=true
	RecentShipments    []Shipment            `json:"recent_shipments"`     // últimos 5 envíos creados (no borradores)
}

// StatsDetailItem is a row in the KPI drill-down detail by branch.
type StatsDetailItem struct {
	BranchID   string `json:"branch_id"`
	BranchName string `json:"branch_name"`
	Count      int    `json:"count"`
}

// PublicStats is a redacted, auth-free snapshot used by the login screen.
// Excludes drafts from totals so the number reflects real, confirmed activity.
type PublicStats struct {
	TotalShipments int `json:"total_shipments"` // confirmed shipments only (excludes drafts)
	InTransit      int `json:"in_transit"`      // loaded + in_transit + out_for_delivery
	ActiveBranches int `json:"active_branches"` // branches with status = activo
}
