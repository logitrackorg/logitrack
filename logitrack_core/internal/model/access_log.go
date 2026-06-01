package model

import "time"

type AccessEventType string

const (
	AccessEventLoginSuccess            AccessEventType = "login_success"
	AccessEventLoginFailure            AccessEventType = "login_failure"
	AccessEventLogout                  AccessEventType = "logout"
	AccessEventPasswordResetRequested  AccessEventType = "password_reset_requested"
	AccessEventPasswordResetConfirmed  AccessEventType = "password_reset_confirmed"
)

type AccessLog struct {
	ID        string          `json:"id"`
	Username  string          `json:"username"`
	UserID    string          `json:"user_id,omitempty"`
	EventType AccessEventType `json:"event_type"`
	Timestamp time.Time       `json:"timestamp"`
}
