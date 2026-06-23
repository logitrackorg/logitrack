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
	DriverType   DriverType      `json:"driver_type"`
	CheckinToday bool            `json:"checkin_today"`
	RiskScore    *int            `json:"risk_score"`   // nil when no check-in today
	RiskLevel    DriverRiskLevel `json:"risk_level"`   // "pendiente" when no check-in today
	KSSLevel     *int            `json:"kss_level"`    // nil when no check-in today
	HorasSueno   *int            `json:"horas_sueno"`  // nil when no check-in today
	DriftScore   *int            `json:"drift_score"`  // nil when no baseline yet
	HasVoice     bool            `json:"has_voice"`    // whether voice analysis was completed today
	PVTMetrics   *PVTResult      `json:"pvt_metrics"`  // nil when PVT was not completed today
	CheckinTime  *time.Time      `json:"checkin_time"` // nil when no check-in today
	History      []DriverCheckin `json:"history"`      // last 30 days, newest first
}

// FatigueDashboardResponse is returned by GET /supervisor/fatigue-dashboard.
type FatigueDashboardResponse struct {
	BranchID string                `json:"branch_id"`
	Date     string                `json:"date"` // YYYY-MM-DD in ART
	Drivers  []DriverFatigueStatus `json:"drivers"`
	GreenMax int                   `json:"green_max"` // threshold copied from config
	RedMin   int                   `json:"red_min"`   // threshold copied from config
}

// FatigueDailyMetric aggregates all drivers' risk levels for a single calendar day.
type FatigueDailyMetric struct {
	Date          string  `json:"date"` // YYYY-MM-DD
	Verde         int     `json:"verde"`
	Amarillo      int     `json:"amarillo"`
	Rojo          int     `json:"rojo"`
	Salteado      int     `json:"salteado"`
	AvgHorasSueno float64 `json:"avg_horas_sueno"`
	AvgRiskScore  float64 `json:"avg_risk_score"`
}

// DriverRankingItem is one entry in the driver risk ranking.
type DriverRankingItem struct {
	DriverID      string  `json:"driver_id"`
	FullName      string  `json:"full_name"`
	Username      string  `json:"username"`
	AvgRiskScore  float64 `json:"avg_risk_score"`
	AvgHorasSueno float64 `json:"avg_horas_sueno"`
	TotalCheckins int     `json:"total_checkins"`
	RiskLevel     string  `json:"risk_level"`
}

// FatigueHistoryResponse is returned by GET /supervisor/fatigue-history.
type FatigueHistoryResponse struct {
	BranchID      string               `json:"branch_id"`
	DailyMetrics  []FatigueDailyMetric `json:"daily_metrics"`  // sorted ascending by date
	DriverRanking []DriverRankingItem  `json:"driver_ranking"` // sorted by avg risk descending
	GreenMax      int                  `json:"green_max"`
	RedMin        int                  `json:"red_min"`
}
