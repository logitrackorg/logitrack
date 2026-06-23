package model

import "time"

type AccessEventType string

const (
	AccessEventLoginSuccess           AccessEventType = "login_success"
	AccessEventLoginFailure           AccessEventType = "login_failure"
	AccessEventLogout                 AccessEventType = "logout"
	AccessEventPasswordResetRequested AccessEventType = "password_reset_requested"
	AccessEventPasswordResetConfirmed AccessEventType = "password_reset_confirmed"
)

type AccessLog struct {
	ID            string          `json:"id"`
	Username      string          `json:"username"`
	UserID        string          `json:"user_id,omitempty"`
	Role          string          `json:"role,omitempty"`
	EventType     AccessEventType `json:"event_type"`
	IPAddress     string          `json:"ip_address,omitempty"`
	Country       string          `json:"country,omitempty"`
	City          string          `json:"city,omitempty"`
	Result        string          `json:"result,omitempty"`
	FailureReason string          `json:"failure_reason,omitempty"`
	Timestamp     time.Time       `json:"timestamp"`
}

type AccessLogFilter struct {
	Username string
	DateFrom string
	DateTo   string
	Limit    int
}
