package model

import "time"

// DraftAuditAction describes what happened to a draft's lifecycle.
type DraftAuditAction string

const (
	DraftAuditCreated    DraftAuditAction = "created"
	DraftAuditUpdated    DraftAuditAction = "updated"
	DraftAuditExpired    DraftAuditAction = "expired"
	DraftAuditPIIPurged  DraftAuditAction = "pii_purged"
	DraftAuditSuppressed DraftAuditAction = "pii_suppressed"
)

// DraftAuditEntry is a single record in the audit trail for draft lifecycle events.
// It satisfies CA-03 (trazabilidad) and is exportable for ARCO requests.
type DraftAuditEntry struct {
	ID          string            `json:"id"`
	TrackingID  string            `json:"tracking_id"`
	Action      DraftAuditAction  `json:"action"`
	PerformedBy string            `json:"performed_by"` // "system" for automated jobs, username otherwise
	Timestamp   time.Time         `json:"timestamp"`
	Details     map[string]string `json:"details,omitempty"`
}
