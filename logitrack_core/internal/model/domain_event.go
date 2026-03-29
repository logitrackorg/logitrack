package model

import "time"

// DomainEvent is the internal event used for event sourcing.
// It is distinct from ShipmentEvent which is the external API response format.
type DomainEvent struct {
	ID         string      `json:"id"`
	TrackingID string      `json:"tracking_id"`
	EventType  string      `json:"event_type"`
	Payload    interface{} `json:"-"`
	ChangedBy  string      `json:"changed_by"`
	Timestamp  time.Time   `json:"timestamp"`
	Version    int         `json:"version"`
}

// DomainEvent type constants
const (
	EventShipmentCreated   = "shipment_created"
	EventDraftSaved        = "draft_saved"
	EventDraftUpdated      = "draft_updated"
	EventDraftConfirmed    = "draft_confirmed"
	EventStatusChanged     = "status_changed"
	EventShipmentCorrected = "shipment_corrected"
	EventShipmentCancelled = "shipment_cancelled"
)

// Payload types — each event type carries its own typed payload.

type ShipmentCreatedPayload struct {
	Shipment Shipment
	Notes    string
}

type DraftSavedPayload struct {
	Shipment Shipment
}

type DraftUpdatedPayload struct {
	Shipment Shipment
}

type DraftConfirmedPayload struct {
	OldTrackingID string
	NewTrackingID string
	Prediction    *PriorityPrediction
}

type StatusChangedPayload struct {
	FromStatus Status
	ToStatus   Status
	Location   string // already resolved to branch ID
	Notes      string
	DriverID   string
}

type ShipmentCorrectedPayload struct {
	Status      Status // current status (unchanged by correction)
	Corrections ShipmentCorrections
	Prediction  *PriorityPrediction
}

type ShipmentCancelledPayload struct {
	FromStatus Status
	Reason     string
}
