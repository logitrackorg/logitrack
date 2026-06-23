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
	EventShipmentCreated       = "shipment_created"
	EventDraftSaved            = "draft_saved"
	EventDraftUpdated          = "draft_updated"
	EventDraftConfirmed        = "draft_confirmed"
	EventStatusChanged         = "status_changed"
	EventShipmentCorrected     = "shipment_corrected"
	EventShipmentCancelled     = "shipment_cancelled"
	EventIncidentReported      = "incident_reported"
	EventShipmentETAExtended   = "shipment_eta_extended"
	EventDraftExpired          = "draft_expired"
	EventDraftPIIPurged        = "draft_pii_purged"
	EventDraftPIISuppressed    = "draft_pii_suppressed"
	EventPaymentRequested      = "payment_requested"
	EventPaymentConfirmed      = "payment_confirmed"
	EventReturnedToDraft       = "returned_to_draft"
	EventPickupRequested       = "pickup_requested"
	EventDeliveryRescheduled   = "delivery_rescheduled"
	EventCancelledByRecipient  = "cancelled_by_recipient"
	EventCancelledBySender     = "cancelled_by_sender"
	EventDeliveryKeywordFailed = "delivery_keyword_failed" // driver entered wrong keyword; increments keyword_attempts

	// Branch zone events
	EventShipmentZoned = "shipment_zoned" // automatic assignment to Entrada on arrival
	EventShipmentMoved = "shipment_moved" // manual zone-to-zone movement
)

// ReturnETAExtraDays is added to the estimated_delivery_at when a shipment
// becomes a return (counter-shipment from cancellation, or rejection/no_entregado).
const ReturnETAExtraDays = 10

// Payload types — each event type carries its own typed payload.

type ShipmentCreatedPayload struct {
	Shipment            Shipment
	Notes               string
	SecurityKeywordHash string // stored explicitly because Shipment.SecurityKeywordHash is json:"-"
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
	SecurityKeyword     string // set when delivery_method == ultima_milla
	SecurityKeywordHash string // bcrypt hash of SecurityKeyword for offline validation
}

type StatusChangedPayload struct {
	FromStatus          Status
	ToStatus            Status
	Location            string // already resolved to branch ID
	Notes               string
	DriverID            string
	RejectedByRecipient bool // delivery_failed: recipient explicitly refused
	ContingencyDelivery bool // delivered via DNI fallback after exhausting keyword attempts
	// Delivery photo evidence (última milla only)
	DeliveryPhotoPath string
	DeliveryPhotoName string
	DeliveryPhotoMime string
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

type ShipmentClaimCreatedPayload struct {
	ClaimID   string
	ClaimType ClaimType
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
	Method              PaymentMethod
	EstimatedDeliveryAt *time.Time
	Prediction          *PriorityPrediction
	SecurityKeyword     string
	SecurityKeywordHash string // bcrypt hash of SecurityKeyword for offline validation
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

// ShipmentZonedPayload se emite cuando el sistema asigna automáticamente un envío
// a la zona Entrada al llegar a una sucursal (fin de viaje).
type ShipmentZonedPayload struct {
	BranchID string         `json:"branch_id"`
	Zone     BranchZoneType `json:"zone"`
}

// ShipmentMovedPayload se emite cuando un operador/supervisor mueve manualmente
// un envío entre zonas dentro de una sucursal.
type ShipmentMovedPayload struct {
	FromZone BranchZoneType `json:"from_zone"`
	ToZone   BranchZoneType `json:"to_zone"`
	BranchID string         `json:"branch_id"`
	Notes    string         `json:"notes,omitempty"`
}

// ==========================================
// CHATBOT EVENT PAYLOADS
// ==========================================

// PickupRequestedPayload registra cuando el destinatario solicita retiro en sucursal vía chatbot
type PickupRequestedPayload struct {
	RecipientDNI   string         `json:"recipient_dni"`
	PreviousMethod DeliveryMethod `json:"previous_method"`
	FinalBranchID  string         `json:"final_branch_id"`
	RequestedVia   string         `json:"requested_via"` // "chatbot"
}

// DeliveryRescheduledPayload registra cuando el destinatario reprograma la entrega vía chatbot
type DeliveryRescheduledPayload struct {
	RecipientDNI     string         `json:"recipient_dni"`
	OldDeliveryDate  *time.Time     `json:"old_delivery_date"`
	NewDeliveryDate  time.Time      `json:"new_delivery_date"`
	OriginalDate     *time.Time     `json:"original_date"`
	RescheduleCount  int            `json:"reschedule_count"`
	DaysFromOriginal int            `json:"days_from_original"`
	RequestedVia     string         `json:"requested_via"` // "chatbot"
	CurrentLocation  *EventLocation `json:"current_location,omitempty"`
}

// CancelledByRecipientPayload registra cuando el destinatario rechaza el envío vía chatbot
type CancelledByRecipientPayload struct {
	RecipientDNI string `json:"recipient_dni"`
	FromStatus   Status `json:"from_status"`
	Reason       string `json:"reason"`
	RequestedVia string `json:"requested_via"` // "chatbot"
}

// CancelledBySenderPayload registra cuando el remitente cancela el envío vía chatbot
type CancelledBySenderPayload struct {
	SenderDNI    string `json:"sender_dni"`
	FromStatus   Status `json:"from_status"`
	Reason       string `json:"reason"`
	RequestedVia string `json:"requested_via"` // "chatbot"
}
