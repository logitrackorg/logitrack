package model

import "time"

// VoiceMetrics holds the 5 acoustic features extracted from a driver's audio sample.
type VoiceMetrics struct {
	PitchMean  float64 `json:"pitch_mean"`  // Average fundamental frequency (Hz)
	PitchRange float64 `json:"pitch_range"` // Max - min pitch within the sample (Hz)
	EnergyRMS  float64 `json:"energy_rms"`  // Root-mean-square energy (amplitude proxy)
	SpeechRate float64 `json:"speech_rate"` // Estimated syllables per second
	PauseRatio float64 `json:"pause_ratio"` // Fraction of total duration spent in silence
}

// DriverCheckin represents a single daily fatigue check-in for a driver.
// It accumulates both the KSS questionnaire result and the voice analysis result.
type DriverCheckin struct {
	DriverID   string    `json:"driver_id"`
	Date       string    `json:"date"`        // YYYY-MM-DD — one record per driver per day
	HorasSueno int       `json:"horas_sueno"` // 0–10
	KSSLevel   int       `json:"kss_level"`   // 1–9
	RecordedAt time.Time `json:"recorded_at"`

	// Skipped is true when the driver chose to bypass the fatigue gate.
	// The gate is hidden for 3 hours after a skip (grace period).
	Skipped bool `json:"skipped,omitempty"`

	// Voice analysis — populated after POST /driver/voice-upload.
	// Nil when the driver skipped the voice step.
	VoiceMetrics *VoiceMetrics `json:"voice_metrics,omitempty"`
	DriftScore   *int          `json:"drift_score,omitempty"` // 0–100; nil if no baseline yet

	// BaselineVoice is the running average of all previous VoiceMetrics for this driver.
	// It is updated every time a new voice sample is successfully processed.
	BaselineVoice *VoiceMetrics `json:"baseline_voice,omitempty"`

	// PVTMetrics holds the optional psychomotor vigilance task result (US6).
	// Nil when the driver skipped or did not complete the PVT mini-game.
	PVTMetrics *PVTResult `json:"pvt_metrics,omitempty"`
}

// PVTResult contains the objective psychomotor metrics captured by the
// reaction-time mini-game (Psychomotor Vigilance Task).
type PVTResult struct {
	LatenciaPromedioMs float64   `json:"latencia_promedio_ms"` // mean response latency
	Aciertos           int       `json:"aciertos"`             // correct circle taps
	Errores            int       `json:"errores"`              // false positives (taps with no stimulus)
	RecordedAt         time.Time `json:"recorded_at"`
}
