package model

import "time"

type HistoryRequestStatus string

const (
	HistoryRequestPending  HistoryRequestStatus = "pending"
	HistoryRequestApproved HistoryRequestStatus = "approved"
	HistoryRequestRejected HistoryRequestStatus = "rejected"
)

type HistoryAccessRequest struct {
	DriverID    string               `json:"driver_id"`
	Status      HistoryRequestStatus `json:"status"`
	RequestDate time.Time            `json:"request_date"`
	ReviewedBy  string               `json:"reviewed_by,omitempty"`
	ReviewedAt  *time.Time           `json:"reviewed_at,omitempty"`
	ReviewNote  string               `json:"review_note,omitempty"`
}
