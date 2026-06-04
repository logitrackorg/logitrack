package model

// FleetStatus represents the heuristic conclusion about fleet capacity.
type FleetStatus string

const (
	FleetStatusCritical    FleetStatus = "CRÍTICO"
	FleetStatusWarning     FleetStatus = "ADVERTENCIA"
	FleetStatusPreventive  FleetStatus = "PREVENTIVO"
	FleetStatusIdle        FleetStatus = "OCIOSO"
	FleetStatusStable      FleetStatus = "ESTABLE"
)

// FleetSuggestion is the output of the heuristic fleet-capacity engine.
type FleetSuggestion struct {
	// Status is the heuristic outcome: one of the FleetStatus constants.
	Status FleetStatus `json:"status"`
	// Message is the human-readable recommendation for the operator.
	Message string `json:"message"`

	// ── SLA metrics ────────────────────────────────────────────────────────
	// DelayRatePct is the % of active monitored shipments currently delayed.
	DelayRatePct float64 `json:"delay_rate_pct"`

	// ── Operational metrics (new) ──────────────────────────────────────────
	// ActiveDrivers is the total number of drivers with status='activo'.
	ActiveDrivers int `json:"active_drivers"`
	// IdleDrivers is the number of active drivers with 0 shipments assigned today.
	IdleDrivers int `json:"idle_drivers"`
	// OrphanShipments is the count of out_for_delivery shipments not assigned
	// to any driver route today.
	OrphanShipments int `json:"orphan_shipments"`
	// ActiveDriversLoad is the average number of shipments per driver that has
	// at least one shipment assigned today.
	ActiveDriversLoad float64 `json:"active_drivers_load"`
	// DriversNeeded is the calculated number of extra drivers required to cover
	// orphan shipments (only set when Status == CRÍTICO).
	DriversNeeded int `json:"drivers_needed,omitempty"`
	// CapacityUsedPct is the load vs MaxPackagesPerDriver (only set for PREVENTIVO).
	CapacityUsedPct float64 `json:"capacity_used_pct,omitempty"`
}

// SLAMetrics is the response payload for GET /stats/sla-metrics.
type SLAMetrics struct {
	// SlaHealthRate is the percentage of active shipments that are NOT delayed
	// (time in current state ≤ 36 h). Range: 0.0–100.0.
	SlaHealthRate float64 `json:"sla_health_rate"`

	// ActiveTotal is the total number of shipments in active (non-terminal) states.
	ActiveTotal int `json:"active_total"`

	// DelayedTotal is the number of active shipments currently flagged as delayed.
	DelayedTotal int `json:"delayed_total"`

	// Bottlenecks lists, per status, how many shipments are currently delayed.
	// Sorted by Count descending.
	Bottlenecks []SLABottleneck `json:"bottlenecks"`

	// DelayTrend contains one entry per calendar day over the last 7 days.
	// Each entry counts how many escalation events were logged by the SLA engine
	// on that day (sourced from priority_logs.json).
	DelayTrend []SLADayCount `json:"delay_trend"`

	// CurrentAverages is the most recently computed per-status average dwell
	// time in hours. Empty when the Collector has not run yet in this process
	// lifecycle. Sorted by AvgHours descending for chart readability.
	CurrentAverages []SLAStateAverage `json:"current_averages"`

	// FleetSuggestion is the output of the heuristic fleet-capacity engine.
	// Always present (never nil) so the frontend can render the card.
	FleetSuggestion FleetSuggestion `json:"fleet_suggestion"`
}

// SLAStateAverage holds the average dwell time for a single shipment status.
type SLAStateAverage struct {
	Status   string  `json:"status"`    // Spanish display name
	AvgHours float64 `json:"avg_hours"` // hours; 0 = no data
}

// SLABottleneck aggregates delayed shipments by their current status.
type SLABottleneck struct {
	Status string `json:"status"` // Spanish display name
	Count  int    `json:"count"`
}

// SLADayCount holds the number of SLA escalation events for one calendar day.
type SLADayCount struct {
	Date  string `json:"date"`  // YYYY-MM-DD
	Count int    `json:"count"`
}
