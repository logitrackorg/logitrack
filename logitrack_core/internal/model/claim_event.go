package model

import "time"

// Claim domain event types (persisted in claim_events).
const (
	EventClaimCreated             = "claim_created"
	EventClaimCategoryUpdated     = "claim_category_updated"
	EventClaimResolved            = "claim_resolved"
	EventClaimPendingCustomer     = "claim_pending_customer"
	EventClaimInReview            = "claim_in_review"
	EventClaimCustomerResponded   = "claim_customer_responded"
	EventClaimTransferred         = "claim_transferred"
	EventClaimTransferAccepted    = "claim_accepted"
	EventClaimTransferRejected    = "claim_transfer_rejected"
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
	EvidenceFileName string              `json:"evidence_file_name,omitempty"`
	EvidenceFilePath string              `json:"evidence_file_path,omitempty"`
	OriginBranchID   string              `json:"origin_branch_id,omitempty"`
	TargetBranchID   string              `json:"target_branch_id,omitempty"`
}

type ClaimCreatedPayload struct {
	ClaimID   string    `json:"claim_id"`
	ClaimType ClaimType `json:"claim_type"`
}

type ClaimCategoryUpdatedPayload struct {
	AssignedCategory ClaimCategory `json:"assigned_category"`
	FromStatus       ClaimStatus   `json:"from_status"`
	ToStatus         ClaimStatus   `json:"to_status"`
	Notes            string        `json:"notes,omitempty"`
}

type ClaimResolvedPayload struct {
	ResolutionType ClaimResolutionType `json:"resolution_type"`
	FromStatus     ClaimStatus         `json:"from_status"`
	ToStatus       ClaimStatus         `json:"to_status"`
	Notes          string              `json:"notes,omitempty"`
}

type ClaimPendingCustomerPayload struct {
	Notes      string      `json:"notes,omitempty"`
	FromStatus ClaimStatus `json:"from_status"`
	ToStatus   ClaimStatus `json:"to_status"`
}

type ClaimInReviewPayload struct {
	FromStatus ClaimStatus `json:"from_status"`
	ToStatus   ClaimStatus `json:"to_status"`
}

type ClaimCustomerRespondedPayload struct {
	Response         string      `json:"response"`
	FromStatus       ClaimStatus `json:"from_status"`
	ToStatus         ClaimStatus `json:"to_status"`
	EvidenceFileName string      `json:"evidence_file_name,omitempty"`
	EvidenceFilePath string      `json:"evidence_file_path,omitempty"`
}

type ClaimTransferredPayload struct {
	OriginBranchID string      `json:"origin_branch_id"`
	TargetBranchID string      `json:"target_branch_id"`
	FromStatus     ClaimStatus `json:"from_status"`
	ToStatus       ClaimStatus `json:"to_status"`
	Notes          string      `json:"notes,omitempty"`
}

type ClaimTransferAcceptedPayload struct {
	AssignedBranchID string      `json:"assigned_branch_id"`
	FromStatus       ClaimStatus `json:"from_status"`
	ToStatus         ClaimStatus `json:"to_status"`
}

type ClaimTransferRejectedPayload struct {
	AssignedBranchID string      `json:"assigned_branch_id"`
	FromStatus       ClaimStatus `json:"from_status"`
	ToStatus         ClaimStatus `json:"to_status"`
	Notes            string      `json:"notes,omitempty"`
}
