package model

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
