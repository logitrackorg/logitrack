package model

import "time"

type DataAccessRequestStatus string

const (
	DataAccessPending  DataAccessRequestStatus = "pending"
	DataAccessAccepted DataAccessRequestStatus = "accepted"
	DataAccessRejected DataAccessRequestStatus = "rejected"
)

type DataAccessRequest struct {
	ID          string                  `json:"id"`
	DriverID    string                  `json:"driver_id"`
	DriverName  string                  `json:"driver_name"`
	BranchID    string                  `json:"branch_id"`
	Status      DataAccessRequestStatus `json:"status"`
	RequestedAt time.Time               `json:"requested_at"`
	ReviewedAt  *time.Time              `json:"reviewed_at,omitempty"`
	ReviewedBy  string                  `json:"reviewed_by,omitempty"`
	// CheckinData holds the last check-in snapshot granted when a supervisor accepts.
	CheckinData *DriverCheckin `json:"checkin_data,omitempty"`
}
