package model

import "time"

// FatigueConfig holds the global parameters for the driver fatigue detection model.
// Persisted in data/fatigue_config.json; editable by admin via /admin/fatigue-config.
type FatigueConfig struct {
	RiskThresholds  RiskThresholds `json:"risk_thresholds"`
	VoiceWeights    VoiceWeights   `json:"voice_weights"`
	MinBaselineDays int            `json:"min_baseline_days"`
	KSSScores       KSSScores      `json:"kss_scores"`

	// LastCheckinReset is set by the admin "reset check-ins" action (testing only).
	// GetTodayCheckin returns 404 when the stored check-in RecordedAt is before this
	// timestamp, forcing the driver to redo the gate — without deleting the data.
	LastCheckinReset *time.Time `json:"last_checkin_reset,omitempty"`
}

// RiskThresholds defines the drift-score color bands shown in the driver UI.
// green  → score ≤ GreenMax
// amber  → GreenMax < score < RedMin
// red    → score ≥ RedMin
type RiskThresholds struct {
	GreenMax int `json:"green_max"` // upper bound for green (no-risk) zone
	RedMin   int `json:"red_min"`   // lower bound for red (high-risk) zone
}

// VoiceWeights are the per-feature multipliers used in computeDriftScore.
// All five fields must sum to 1.0.
type VoiceWeights struct {
	PitchMean  float64 `json:"pitch_mean"`
	PitchRange float64 `json:"pitch_range"`
	EnergyRMS  float64 `json:"energy_rms"`
	SpeechRate float64 `json:"speech_rate"`
	PauseRatio float64 `json:"pause_ratio"`
}

// KSSScores defines the fatigue penalty points assigned per KSS range.
// These are summed with the voice drift score to obtain the final fatigue index.
type KSSScores struct {
	KSS14 int `json:"kss_1_4"` // KSS 1–4: low drowsiness, no penalty
	KSS57 int `json:"kss_5_7"` // KSS 5–7: moderate drowsiness
	KSS89 int `json:"kss_8_9"` // KSS 8–9: high drowsiness
}

func DefaultFatigueConfig() FatigueConfig {
	return FatigueConfig{
		RiskThresholds: RiskThresholds{
			GreenMax: 29,
			RedMin:   60,
		},
		VoiceWeights: VoiceWeights{
			PitchMean:  0.30,
			PitchRange: 0.20,
			EnergyRMS:  0.20,
			SpeechRate: 0.15,
			PauseRatio: 0.15,
		},
		MinBaselineDays: 10,
		KSSScores: KSSScores{
			KSS14: 0,
			KSS57: 15,
			KSS89: 30,
		},
	}
}
