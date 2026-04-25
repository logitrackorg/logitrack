package model

import "time"

type AccessEventType string

const (
	AccessEventLoginSuccess AccessEventType = "login_success"
	AccessEventLoginFailure AccessEventType = "login_failure"
	AccessEventLogout       AccessEventType = "logout"
)

type AccessLog struct {
	ID        string          `json:"id"`
	Username  string          `json:"username"`
	UserID    string          `json:"user_id,omitempty"`
	EventType AccessEventType `json:"event_type"`
	Timestamp time.Time       `json:"timestamp"`
}
