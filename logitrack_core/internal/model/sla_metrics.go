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

// FleetRawMetrics holds the raw operational numbers used by both engines.
// Attached to every FleetDiagnosis so the frontend can show an analytics panel.
type FleetRawMetrics struct {
	TotalShipments  int     `json:"total_shipments"`
	SlaDelayPct     float64 `json:"sla_delay_pct"`
	OrphanShipments int     `json:"orphan_shipments"`
	IdleDrivers     int     `json:"idle_drivers"`
	ActiveDrivers   int     `json:"active_drivers"`

	// SuggestedDriverDelta is the recommended change in driver count.
	// Positive → hire/activate that many drivers.
	// Negative → temporarily deactivate abs(delta) drivers.
	// Zero → no staffing action required.
	SuggestedDriverDelta int `json:"suggested_driver_delta"`
}

// FleetDiagnosis is the output of one fleet-classification engine
// (either the deterministic heuristic or the Random Forest).
type FleetDiagnosis struct {
	Status     FleetStatus      `json:"status"`
	Message    string           `json:"message"`
	Confidence float64          `json:"confidence,omitempty"`  // 0–1; set by ML only
	RawMetrics *FleetRawMetrics `json:"raw_metrics,omitempty"` // always set
	// VoteDistribution maps each FleetStatus label to its vote share (0–100).
	// Set by the ML engine only.
	VoteDistribution map[string]int `json:"vote_distribution,omitempty"`
}

// BranchFleetDiagnosis is the fleet diagnosis for a single branch — both
// engines (heuristic and ML) evaluate each branch's operation independently.
type BranchFleetDiagnosis struct {
	BranchID   string          `json:"branch_id"`
	BranchName string          `json:"branch_name"`
	Heuristic  FleetDiagnosis  `json:"heuristic_diagnosis"`
	ML         *FleetDiagnosis `json:"ml_prediction"`
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

	// FleetDiagnoses holds one heuristic+ML diagnosis per active branch — the
	// fleet engines evaluate each branch's operation independently.
	FleetDiagnoses []BranchFleetDiagnosis `json:"fleet_diagnoses"`
}

// SLAStateAverage holds the average dwell time for a single shipment status.
type SLAStateAverage struct {
	Status   string  `json:"status"`    // Spanish display name
	AvgHours float64 `json:"avg_hours"` // hours; meaningless when HasData is false
	HasData  bool    `json:"has_data"`  // false = not enough historical transitions yet to compute an average
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
