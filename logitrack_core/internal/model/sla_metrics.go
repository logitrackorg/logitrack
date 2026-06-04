package model

// FleetStatus represents the heuristic conclusion about fleet capacity.
type FleetStatus string

const (
	FleetStatusCritical FleetStatus = "CRÍTICO"
	FleetStatusIdle     FleetStatus = "OCIOSO"
	FleetStatusStable   FleetStatus = "ESTABLE"
)

// FleetSuggestion is the output of the fleet-capacity heuristic engine.
type FleetSuggestion struct {
	// Status is the heuristic outcome: CRÍTICO, OCIOSO, or ESTABLE.
	Status FleetStatus `json:"status"`
	// Message is the human-readable recommendation for the operator.
	Message string `json:"message"`
	// DelayRatePct is the percentage of active monitored shipments that are
	// currently delayed (the metric that triggered the rule).
	DelayRatePct float64 `json:"delay_rate_pct"`
	// VolumeChangePct is the % change in shipment volume this week vs last week.
	// Negative = drop. Only meaningful when Status == OCIOSO.
	VolumeChangePct float64 `json:"volume_change_pct"`
	// ThisWeekCount and LastWeekCount are the raw shipment counts used for the
	// volume comparison, exposed so the frontend can show supporting data.
	ThisWeekCount int `json:"this_week_count"`
	LastWeekCount int `json:"last_week_count"`
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
