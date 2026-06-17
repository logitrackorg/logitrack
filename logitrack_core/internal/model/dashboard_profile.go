package model

import "time"

// DashboardProfile is a named snapshot of a user's dashboard tab order and visibility.
type DashboardProfile struct {
	ID          string                    `json:"id"`
	UserID      string                    `json:"user_id"`
	Name        string                    `json:"name"`
	Preferences []UserDashboardPreference `json:"preferences"`
	CreatedAt   time.Time                 `json:"created_at"`
}
