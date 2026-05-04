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
	DraftID       string
	NewTrackingID string
	ChangedBy     string
	Notes         string
	Timestamp     time.Time
	Prediction    *model.PriorityPrediction
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
