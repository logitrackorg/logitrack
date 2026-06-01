package model

// SLASettings holds the tunable parameters for the automatic SLA anomaly
// detector (SLAAnomalyService). Persisted to data/sla_settings.json; if the
// file does not exist the zero value is never used — DefaultSLASettings() is
// always called as fallback so the service is never misconfigured.
type SLASettings struct {
	// ToleranceMultiplier is the factor applied to the historical average dwell
	// time. A shipment is flagged "Demorado" when its time in the current state
	// exceeds (avg × ToleranceMultiplier). Default 1.5 (150 %).
	ToleranceMultiplier float64 `json:"tolerance_multiplier"`

	// PriorityCeiling is the highest priority level the engine may assign
	// automatically. Escalation stops when the shipment reaches this level.
	// Valid values: "media", "alta". Default "alta".
	PriorityCeiling string `json:"priority_ceiling"`

	// EnabledStates is the allow-list of raw status codes the engine evaluates.
	// Shipments whose current status is NOT in this list are skipped entirely.
	// Default: all active (non-terminal) states.
	EnabledStates []string `json:"enabled_states"`

	// CacheIntervalMinutes controls how long the computed per-status averages
	// are reused before a fresh DB query is issued. Default 60 minutes.
	CacheIntervalMinutes int `json:"cache_interval_minutes"`
}

// DefaultSLASettings returns safe, production-ready defaults used when no
// configuration file exists yet.
func DefaultSLASettings() SLASettings {
	return SLASettings{
		ToleranceMultiplier: 1.5,
		PriorityCeiling:     "alta",
		EnabledStates: []string{
			"at_origin_hub",
			"at_hub",
			"in_transit",
			"out_for_delivery",
			"delivery_failed",
			"redelivery_scheduled",
			"ready_for_pickup",
			"ready_for_return",
		},
		CacheIntervalMinutes: 60,
	}
}
