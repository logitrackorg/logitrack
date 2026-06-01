package model

import "time"

// PriorityLog records a single automatic priority-escalation event triggered by
// the SLA anomaly detector. Entries are appended to data/priority_logs.json.
type PriorityLog struct {
	TrackingID   string    `json:"tracking_id"`
	Timestamp    time.Time `json:"timestamp"`
	PriorityFrom string    `json:"priority_from"`
	PriorityTo   string    `json:"priority_to"`
	// Reason always contains the mandatory literal required by AC3.
	Reason string `json:"reason"`
}
