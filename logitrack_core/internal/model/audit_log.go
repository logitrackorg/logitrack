package model

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"time"
)

// AuditLog is an immutable record of an action that modifies fatigue-related
// data (config update or driver check-in). Naming follows the MLConfig pattern
// (created_at / created_by) for consistency across the admin UI.
type AuditLog struct {
	ID        string          `json:"id"`
	CreatedAt time.Time       `json:"created_at"`
	CreatedBy string          `json:"created_by"` // username of the actor
	Action    string          `json:"action"`     // "UPDATE_FATIGUE_CONFIG" | "SUBMIT_CHECKIN" | "SKIP_CHECKIN"
	Details   json.RawMessage `json:"details"`    // JSON snapshot of what changed
}

// NewAuditID generates a random 16-hex-character ID for audit records.
func NewAuditID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}
