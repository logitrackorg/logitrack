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

	// AutoEscalate controls whether the engine actually writes priority changes
	// to the shipments table. When false, anomaly detection and logging still
	// run (entries still appear in priority_logs.json) but no DB write occurs.
	// Use a pointer so that JSON omission (old config files) can be defaulted
	// to true without ambiguity with an explicit false.
	AutoEscalate *bool `json:"auto_escalate,omitempty"`

	// EscalationTime is the wall-clock time (Argentina time, "HH:MM" 24-hour)
	// at which the Executor fires the once-daily priority escalation. Default "23:00".
	EscalationTime string `json:"escalation_time,omitempty"`

	// CalculationMode controls when the Collector runs:
	//   "periodic" — runs asynchronously every CacheIntervalMinutes (default).
	//   "daily"    — runs once, immediately before the Executor at EscalationTime;
	//                CacheIntervalMinutes is ignored in this mode.
	CalculationMode string `json:"calculation_mode,omitempty"`

	// DataWindowMonths is how far back the Collector looks in the events table
	// when computing per-status average dwell times. Only events whose timestamp
	// falls within the last N months are included in the average, so recent
	// operational patterns dominate over stale historical data.
	//
	// Valid values: 2, 6, 12, 18. Default 12 (one year).
	// Smaller windows react faster to network changes; larger windows are more
	// stable but may reflect outdated performance baselines.
	DataWindowMonths int `json:"data_window_months,omitempty"`
}

// MonitoredStatusCodes returns the canonical list of active status codes the
// SLA engine evaluates, derived DIRECTLY from the Status constants so the list
// can never drift out of sync with the real status values used by the system.
//
// The list is intentionally restricted to states where LogiTrack itself is
// responsible for moving the shipment forward. States that depend on a third
// party (customer pickup) or that are terminal/pre-operative are EXCLUDED so
// the engine doesn't penalise delays outside the operator's control.
//
// Spanish label mapping (for reference — the stored values are the codes):
//
//	at_origin_hub        → "En sucursal de origen"
//	at_hub               → "En sucursal (intermedia/destino)"
//	                       (single code; StatusAtHub unifies intermediate AND destination hub)
//	loaded               → "Cargado en vehículo"
//	in_transit           → "En tránsito"
//	out_for_delivery     → "Última milla"
//	redelivery_scheduled → "Reentrega agendada"
//	ready_for_return     → "Listo para devolución"
//
// Explicitly EXCLUDED by default:
//
//	ready_for_pickup ("Listo para retiro en sucursal") — espera al cliente
//	delivery_failed  ("Entrega fallida")               — estado de excepción
//	plus all terminal / pre-operative states (delivered, returned, cancelled,
//	lost, destroyed, draft, pending_payment, rechazado, no_entregado).
func MonitoredStatusCodes() []string {
	return []string{
		string(StatusAtOriginHub),
		string(StatusAtHub),
		string(StatusLoaded),
		string(StatusInTransit),
		string(StatusOutForDelivery),
		string(StatusRedeliveryScheduled),
		string(StatusReadyForReturn),
	}
}

// AutoEscalateDefault is the production default for the kill-switch.
func boolPtr(b bool) *bool { return &b }

// DefaultSLASettings returns safe, production-ready defaults used when no
// configuration file exists yet.
func DefaultSLASettings() SLASettings {
	return SLASettings{
		ToleranceMultiplier:  1.5,
		PriorityCeiling:      "alta",
		EnabledStates:        MonitoredStatusCodes(),
		CacheIntervalMinutes: 60,
		AutoEscalate:         boolPtr(true),
		EscalationTime:       "23:00",
		CalculationMode:      "periodic",
		DataWindowMonths:     12,
	}
}

// IsAutoEscalateEnabled returns true when AutoEscalate is nil (old config
// without the field — treat as enabled) or explicitly set to true.
func (s SLASettings) IsAutoEscalateEnabled() bool {
	return s.AutoEscalate == nil || *s.AutoEscalate
}
