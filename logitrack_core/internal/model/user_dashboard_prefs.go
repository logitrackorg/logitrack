package model

// UserDashboardPreference stores a user's sort and visibility preference for one dashboard metric.
type UserDashboardPreference struct {
	UserID    string `json:"user_id"`
	MetricID  string `json:"metric_id"`
	SortOrder int    `json:"sort_order"`
	IsHidden  bool   `json:"is_hidden"`
}
