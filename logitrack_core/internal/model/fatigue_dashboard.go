package model

import "time"

// DriverRiskLevel is the three-color classification for a driver's fatigue risk.
type DriverRiskLevel string

const (
	RiskGreen   DriverRiskLevel = "verde"
	RiskAmber   DriverRiskLevel = "amarillo"
	RiskRed     DriverRiskLevel = "rojo"
	RiskPending DriverRiskLevel = "pendiente" // no check-in submitted yet today
	RiskSkipped DriverRiskLevel = "salteado"  // driver bypassed the gate (grace period active)
)

// DriverFatigueStatus consolidates a single driver's current fatigue state for
// the supervisor dashboard. It includes today's check-in summary and recent history.
type DriverFatigueStatus struct {
	DriverID     string          `json:"driver_id"`
	FullName     string          `json:"full_name"`
	Username     string          `json:"username"`
	CheckinToday bool            `json:"checkin_today"`
	RiskScore    *int            `json:"risk_score"`    // nil when no check-in today
	RiskLevel    DriverRiskLevel `json:"risk_level"`    // "pendiente" when no check-in today
	KSSLevel     *int            `json:"kss_level"`     // nil when no check-in today
	HorasSueno   *int            `json:"horas_sueno"`   // nil when no check-in today
	DriftScore   *int            `json:"drift_score"`   // nil when no baseline yet
	HasVoice     bool            `json:"has_voice"`     // whether voice analysis was completed today
	CheckinTime  *time.Time      `json:"checkin_time"`  // nil when no check-in today
	History      []DriverCheckin `json:"history"`       // last 30 days, newest first
}

// FatigueDashboardResponse is returned by GET /supervisor/fatigue-dashboard.
type FatigueDashboardResponse struct {
	BranchID string                `json:"branch_id"`
	Date     string                `json:"date"`      // YYYY-MM-DD in ART
	Drivers  []DriverFatigueStatus `json:"drivers"`
	GreenMax int                   `json:"green_max"` // threshold copied from config
	RedMin   int                   `json:"red_min"`   // threshold copied from config
}
