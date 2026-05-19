package repository

import (
	"time"

	"github.com/logitrack/core/internal/model"
)

// ShipmentRepository is the domain interface for shipment persistence.
// Each write method accepts a command struct that carries all the data needed
// to build the corresponding domain event internally.
type ShipmentRepository interface {
	// Writes — each method persists the corresponding domain event internally.
	Create(cmd CreateShipmentCmd) (model.Shipment, error)
	SaveDraft(cmd SaveDraftCmd) (model.Shipment, error)
	UpdateDraft(cmd UpdateDraftCmd) (model.Shipment, error)
	ConfirmDraft(cmd ConfirmDraftCmd) (model.Shipment, error)
	UpdateStatus(cmd StatusUpdateCmd) (model.Shipment, error)
	ApplyCorrections(cmd CorrectCmd) (model.Shipment, error)
	CancelShipment(cmd CancelCmd) (model.Shipment, error)
	ExtendETA(cmd ExtendETACmd) (model.Shipment, error)
	// Payment-related transitions — called by PaymentService only.
	RequestPayment(cmd RequestPaymentCmd) (model.Shipment, error)
	ConfirmPayment(cmd ConfirmPaymentCmd) (model.Shipment, error)
	RevertToDraft(cmd RevertToDraftCmd) (model.Shipment, error)

	// RecordPathPlanned persists a planned multi-hop path for stale-replan tracking (WIP).
	RecordPathPlanned(cmd PathPlannedCmd) error
	// SetPalletID associates a pallet identifier with a shipment (WIP).
	SetPalletID(trackingID, palletID string) error
	// ReserveForTrip marca el envío como reservado por un trip multi-hop (pickup cross-branch).
	ReserveForTrip(trackingID, tripID string) error
	// ReleaseFromTrip libera la reserva del envío.
	ReleaseFromTrip(trackingID string) error

	// Reads
	GetByTrackingID(trackingID string) (model.Shipment, error)
	List(filter model.ShipmentFilter) ([]model.Shipment, error)
	Search(query string) ([]model.Shipment, error)
	GetEvents(trackingID string) ([]model.ShipmentEvent, error)
	Stats(filter model.ShipmentFilter) (model.Stats, error)
}

// Command structs — carry all data the repo needs to persist an event.

type CreateShipmentCmd struct {
	Shipment  model.Shipment
	ChangedBy string
	Notes     string
}

type SaveDraftCmd struct {
	Shipment model.Shipment
}

type UpdateDraftCmd struct {
	Shipment model.Shipment
}

type ConfirmDraftCmd struct {
	DraftID             string
	NewTrackingID       string
	ChangedBy           string
	Notes               string
	Timestamp           time.Time
	Prediction          *model.PriorityPrediction
	EstimatedDeliveryAt *time.Time
	Price               *float64
	PriceBreakdown      *model.PriceBreakdown
}

type StatusUpdateCmd struct {
	TrackingID string
	FromStatus model.Status
	ToStatus   model.Status
	Location   string // already resolved to branch ID
	ChangedBy  string
	Notes      string
	DriverID   string
	Timestamp  time.Time
}

type CorrectCmd struct {
	TrackingID    string
	Username      string
	Status        model.Status // current status (unchanged)
	Corrections   model.ShipmentCorrections
	Timestamp     time.Time
	Prediction    *model.PriorityPrediction
	FinalBranchID string // recalculated when destination address changes; empty = no change
}

type CancelCmd struct {
	TrackingID string
	Username   string
	Reason     string
	FromStatus model.Status
	Timestamp  time.Time
}

type ExtendETACmd struct {
	TrackingID string
	OldETA     *time.Time
	NewETA     time.Time
	AddedDays  int
	Reason     string
	ChangedBy  string
	Timestamp  time.Time
}

type RequestPaymentCmd struct {
	Shipment  model.Shipment // with Price/Priority already stamped
	PaymentID string
	MPPreferenceID string
	InitPoint string
	Amount    float64
	Currency  string
	ChangedBy string
	Timestamp time.Time
}

type ConfirmPaymentCmd struct {
	OldTrackingID string // BORRADOR-XXX
	NewTrackingID string // LT-XXX
	PaymentID     string
	MPPaymentID   string
	Amount        float64
	ChangedBy     string
	Timestamp     time.Time
	// Fields needed to rebuild the confirmed shipment state:
	EstimatedDeliveryAt *time.Time
	Prediction          *model.PriorityPrediction
}

type RevertToDraftCmd struct {
	TrackingID string
	PaymentID  string
	Reason     string
	ChangedBy  string
	Timestamp  time.Time
}

// PathPlannedCmd records a planned routing path for a shipment (stale-replan feature, WIP).
type PathPlannedCmd struct {
	TrackingID      string
	PlannedPath     []string
	NextHopBranchID string
	HopIndex        int
	PathRevision    int
	Reason          string
}
