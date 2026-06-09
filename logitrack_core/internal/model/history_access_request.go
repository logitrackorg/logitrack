package model

import "time"

type HistoryRequestStatus string

const (
	HistoryRequestPending  HistoryRequestStatus = "pending"
	HistoryRequestApproved HistoryRequestStatus = "approved"
	HistoryRequestRejected HistoryRequestStatus = "rejected"
)

// HistoryRequestType distinguishes the two governance flows a driver can
// trigger over their own check-in history: granting access to supervisors
// (sharing) or revoking it (deletion). They are tracked as independent
// records so a driver can hold one of each (e.g. an approved access grant
// alongside a pending deletion request).
type HistoryRequestType string

const (
	HistoryRequestTypeAccess   HistoryRequestType = "access"
	HistoryRequestTypeDeletion HistoryRequestType = "deletion"
)

type HistoryAccessRequest struct {
	DriverID    string               `json:"driver_id"`
	Type        HistoryRequestType   `json:"type"`
	Status      HistoryRequestStatus `json:"status"`
	RequestDate time.Time            `json:"request_date"`
	ReviewedBy  string               `json:"reviewed_by,omitempty"`
	ReviewedAt  *time.Time           `json:"reviewed_at,omitempty"`
	ReviewNote  string               `json:"review_note,omitempty"`
}
