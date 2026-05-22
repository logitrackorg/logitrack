package model

import "time"

// Claim domain event types (persisted in claim_events).
const (
	EventClaimCreated         = "claim_created"
	EventClaimCategoryUpdated = "claim_category_updated"
	EventClaimResolved        = "claim_resolved"
)

// ClaimEvent is the API representation of a claim timeline entry.
type ClaimEvent struct {
	ID               string              `json:"id"`
	ClaimID          string              `json:"claim_id"`
	EventType        string              `json:"event_type"`
	ChangedBy        string              `json:"changed_by"`
	Timestamp        time.Time           `json:"timestamp"`
	Notes            string              `json:"notes,omitempty"`
	ClaimType        ClaimType           `json:"claim_type,omitempty"`
	AssignedCategory ClaimCategory       `json:"assigned_category,omitempty"`
	ResolutionType   ClaimResolutionType `json:"resolution_type,omitempty"`
	FromStatus       ClaimStatus         `json:"from_status,omitempty"`
	ToStatus         ClaimStatus         `json:"to_status,omitempty"`
}

type ClaimCreatedPayload struct {
	ClaimID   string    `json:"claim_id"`
	ClaimType ClaimType `json:"claim_type"`
}

type ClaimCategoryUpdatedPayload struct {
	AssignedCategory ClaimCategory `json:"assigned_category"`
	FromStatus       ClaimStatus   `json:"from_status"`
	ToStatus         ClaimStatus   `json:"to_status"`
}

type ClaimResolvedPayload struct {
	ResolutionType ClaimResolutionType `json:"resolution_type"`
	FromStatus     ClaimStatus         `json:"from_status"`
	ToStatus       ClaimStatus         `json:"to_status"`
}
