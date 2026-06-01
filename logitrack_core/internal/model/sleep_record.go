package model

import "time"

// SleepRecord persists the sleep hours a driver self-reported for one
// logistics day (boundary defined by FatigueConfig.DailyResetHour).
//
// Once stored, every subsequent check-in on the same logical day reuses
// this value so the driver is never asked twice about their sleep.
type SleepRecord struct {
	DriverID    string    `json:"driver_id"`
	LogicalDate string    `json:"logical_date"` // YYYY-MM-DD of the logistics day
	HorasSueno  int       `json:"horas_sueno"`  // 0–10
	RecordedAt  time.Time `json:"recorded_at"`
}
