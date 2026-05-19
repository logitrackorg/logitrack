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
	EventShipmentCreated     = "shipment_created"
	EventDraftSaved          = "draft_saved"
	EventDraftUpdated        = "draft_updated"
	EventDraftConfirmed      = "draft_confirmed"
	EventStatusChanged       = "status_changed"
	EventShipmentCorrected   = "shipment_corrected"
	EventShipmentCancelled   = "shipment_cancelled"
	EventIncidentReported    = "incident_reported"
	EventShipmentETAExtended = "shipment_eta_extended"
	EventDraftExpired        = "draft_expired"
	EventDraftPIIPurged      = "draft_pii_purged"
	EventDraftPIISuppressed  = "draft_pii_suppressed"
	EventPaymentRequested    = "payment_requested"
	EventPaymentConfirmed    = "payment_confirmed"
	EventReturnedToDraft     = "returned_to_draft"
)

// ReturnETAExtraDays is added to the estimated_delivery_at when a shipment
// becomes a return (counter-shipment from cancellation, or rejection/no_entregado).
const ReturnETAExtraDays = 10

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
	OldTrackingID       string
	NewTrackingID       string
	Prediction          *PriorityPrediction
	EstimatedDeliveryAt *time.Time
	Price               *float64
	PriceBreakdown      *PriceBreakdown
}

type StatusChangedPayload struct {
	FromStatus Status
	ToStatus   Status
	Location   string // already resolved to branch ID
	Notes      string
	DriverID   string
}

type ShipmentCorrectedPayload struct {
	Status        Status // current status (unchanged by correction)
	Corrections   ShipmentCorrections
	Prediction    *PriorityPrediction
	FinalBranchID string // non-empty when recalculated due to destination address change
}

type ShipmentCancelledPayload struct {
	FromStatus Status
	Reason     string
}

type IncidentReportedPayload struct {
	IncidentType IncidentType
	Description  string
}

type PaymentRequestedPayload struct {
	PaymentID      string
	MPPreferenceID string
	InitPoint      string
	Amount         float64
	Currency       string
}

type PaymentConfirmedPayload struct {
	PaymentID           string
	MPPaymentID         string
	OldTrackingID       string
	NewTrackingID       string
	Amount              float64
	EstimatedDeliveryAt *time.Time
	Prediction          *PriorityPrediction
}

type ReturnedToDraftPayload struct {
	PaymentID string
	Reason    string
}

// ShipmentETAExtendedPayload registra una extensión de la fecha estimada de entrega.
// Se emite cuando un envío pasa a estar en retorno (cancelación que generó contra-envío,
// rechazo del destinatario, o no retiro del mostrador).
type ShipmentETAExtendedPayload struct {
	OldETA    *time.Time
	NewETA    time.Time
	AddedDays int
	Reason    string
}
