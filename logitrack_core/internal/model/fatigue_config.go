package model

import "time"

// FatigueConfig holds the global parameters for the driver fatigue detection
// model. Persisted in data/fatigue_config.json; editable by admin via
// /admin/fatigue-config.
type FatigueConfig struct {
	// RiskThresholds defines the composite-score colour bands.
	// green  → score ≤ GreenMax
	// amber  → GreenMax < score < RedMin
	// red    → score ≥ RedMin
	RiskThresholds RiskThresholds `json:"risk_thresholds"`

	// ── Per-test weights (0.0–1.0 each) ─────────────────────────────────────
	// The sum of weights for all ENABLED tests must equal 1.0.
	// Weights for disabled tests are ignored in the composite calculation.
	KSSWeight     float64 `json:"kss_weight"`
	VoiceWeight   float64 `json:"voice_weight"`
	TactileWeight float64 `json:"tactile_weight"`
	PVTWeight     float64 `json:"pvt_weight"`

	// ── Per-test enable flags ─────────────────────────────────────────────────
	// Disabled tests are excluded from the composite score; their weights are
	// redistributed proportionally among tests that have data available.
	KSSEnabled     bool `json:"kss_enabled"`
	VoiceEnabled   bool `json:"voice_enabled"`
	TactileEnabled bool `json:"tactile_enabled"`
	PVTEnabled     bool `json:"pvt_enabled"`

	// DailyResetHour defines the hour (0–23, ART timezone) at which a new
	// "logical day" begins for the fatigue check-in gate. Defaults to 0 (midnight).
	// Example: if set to 6, drivers who check in at 05:00 must check in again
	// after 06:00 even though the calendar date has not changed.
	DailyResetHour int `json:"daily_reset_hour"`

	// LastCheckinReset is set by the admin "reset check-ins" action (testing only).
	// GetTodayCheckin returns 404 when the stored check-in RecordedAt is before
	// this timestamp, forcing the driver to redo the gate.
	LastCheckinReset *time.Time `json:"last_checkin_reset,omitempty"`

	// BlockRouteOnRed controls whether a RED fatigue score automatically locks the
	// driver's route screen until a supervisor authorises resumption.
	// nil is treated as true for backward compatibility with configs saved before
	// this field existed. Supervisor notifications are sent regardless of this flag.
	BlockRouteOnRed *bool `json:"block_route_on_red,omitempty"`
}

// IsBlockRouteOnRed returns true unless BlockRouteOnRed is explicitly set to false.
// nil (field absent from old JSON) defaults to true.
func (c FatigueConfig) IsBlockRouteOnRed() bool {
	return c.BlockRouteOnRed == nil || *c.BlockRouteOnRed
}

// RiskThresholds defines the composite-score colour bands shown in the
// supervisor dashboard.
type RiskThresholds struct {
	GreenMax int `json:"green_max"` // upper bound for green (no-risk) zone
	RedMin   int `json:"red_min"`   // lower bound for red (high-risk) zone
}

func ptrBool(v bool) *bool { return &v }

func DefaultFatigueConfig() FatigueConfig {
	return FatigueConfig{
		RiskThresholds: RiskThresholds{
			GreenMax: 29,
			RedMin:   60,
		},
		KSSWeight:       0.15,
		VoiceWeight:     0.25,
		TactileWeight:   0.25,
		PVTWeight:       0.35,
		KSSEnabled:      true,
		VoiceEnabled:    true,
		TactileEnabled:  true,
		PVTEnabled:      true,
		BlockRouteOnRed: ptrBool(true),
	}
}
