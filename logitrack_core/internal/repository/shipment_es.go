package repository

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
)

// eventSourcedShipmentRepository implements ShipmentRepository using event sourcing.
// Writes append a DomainEvent to the EventStore and apply it to the projection.
// Reads are served directly from the materialized projection.
type eventSourcedShipmentRepository struct {
	store      EventStore
	projection projection.Projector
}

func NewEventSourcedShipmentRepository(store EventStore, proj projection.Projector) ShipmentRepository {
	return &eventSourcedShipmentRepository{store: store, projection: proj}
}

func (r *eventSourcedShipmentRepository) Create(cmd CreateShipmentCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventShipmentCreated,
		Payload:    model.ShipmentCreatedPayload{Shipment: cmd.Shipment, Notes: cmd.Notes},
		ChangedBy:  cmd.ChangedBy,
		Timestamp:  cmd.Shipment.CreatedAt,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) SaveDraft(cmd SaveDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventDraftSaved,
		Payload:    model.DraftSavedPayload{Shipment: cmd.Shipment},
		Timestamp:  cmd.Shipment.CreatedAt,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) UpdateDraft(cmd UpdateDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventDraftUpdated,
		Payload:    model.DraftUpdatedPayload{Shipment: cmd.Shipment},
		Timestamp:  cmd.Shipment.UpdatedAt,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) ConfirmDraft(cmd ConfirmDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.DraftID,
		EventType:  model.EventDraftConfirmed,
		Payload: model.DraftConfirmedPayload{
			OldTrackingID: cmd.DraftID,
			NewTrackingID: cmd.NewTrackingID,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	// After confirming, the event's TrackingID in the store becomes the new ID.
	// The projection event needs the new tracking ID so Apply can find the correct entry.
	event.TrackingID = cmd.NewTrackingID
	r.projection.Apply(event)
	return r.projection.Get(cmd.NewTrackingID)
}

func (r *eventSourcedShipmentRepository) UpdateStatus(cmd StatusUpdateCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventStatusChanged,
		Payload: model.StatusChangedPayload{
			FromStatus: cmd.FromStatus,
			ToStatus:   cmd.ToStatus,
			Location:   cmd.Location,
			Notes:      cmd.Notes,
			DriverID:   cmd.DriverID,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) ApplyCorrections(cmd CorrectCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventShipmentCorrected,
		Payload: model.ShipmentCorrectedPayload{
			Status:      cmd.Status,
			Corrections: cmd.Corrections,
		},
		ChangedBy: cmd.Username,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) CancelShipment(cmd CancelCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventShipmentCancelled,
		Payload: model.ShipmentCancelledPayload{
			FromStatus: cmd.FromStatus,
			Reason:     cmd.Reason,
		},
		ChangedBy: cmd.Username,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) GetByTrackingID(trackingID string) (model.Shipment, error) {
	return r.projection.Get(trackingID)
}

func (r *eventSourcedShipmentRepository) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	return r.projection.List(filter)
}

func (r *eventSourcedShipmentRepository) Search(query string) ([]model.Shipment, error) {
	return r.projection.Search(query)
}

func (r *eventSourcedShipmentRepository) Stats() (model.Stats, error) {
	return r.projection.Stats()
}

// GetEvents transforms DomainEvents from the store into ShipmentEvent (API format).
// draft_saved and draft_updated events are excluded — they are not part of the
// public event history.
func (r *eventSourcedShipmentRepository) GetEvents(trackingID string) ([]model.ShipmentEvent, error) {
	domainEvents, err := r.store.LoadStream(trackingID)
	if err != nil {
		return nil, fmt.Errorf("shipment not found")
	}

	result := make([]model.ShipmentEvent, 0)
	for _, de := range domainEvents {
		se, ok := toShipmentEvent(de)
		if !ok {
			continue // skip draft_saved, draft_updated
		}
		result = append(result, se)
	}
	return result, nil
}

// toShipmentEvent converts a DomainEvent to the external ShipmentEvent format.
// Returns false for event types that should not be exposed via the events API.
func toShipmentEvent(de model.DomainEvent) (model.ShipmentEvent, bool) {
	switch de.EventType {
	case model.EventShipmentCreated:
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			ToStatus:   model.StatusInProgress,
			ChangedBy:  de.ChangedBy,
			Notes:      de.Payload.(model.ShipmentCreatedPayload).Notes,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventDraftConfirmed:
		from := model.StatusPending
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusInProgress,
			ChangedBy:  de.ChangedBy,
			Notes:      "Shipment confirmed",
			Timestamp:  de.Timestamp,
		}, true

	case model.EventStatusChanged:
		payload := de.Payload.(model.StatusChangedPayload)
		from := payload.FromStatus
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   payload.ToStatus,
			ChangedBy:  de.ChangedBy,
			Location:   payload.Location,
			Notes:      payload.Notes,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventShipmentCorrected:
		payload := de.Payload.(model.ShipmentCorrectedPayload)
		from := payload.Status
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			EventType:  "edited",
			FromStatus: &from,
			ToStatus:   payload.Status,
			ChangedBy:  de.ChangedBy,
			Notes:      fmt.Sprintf("Data correction: %d field(s) updated", len(payload.Corrections.Fields())),
			Timestamp:  de.Timestamp,
		}, true

	case model.EventShipmentCancelled:
		payload := de.Payload.(model.ShipmentCancelledPayload)
		from := payload.FromStatus
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusCancelled,
			ChangedBy:  de.ChangedBy,
			Notes:      payload.Reason,
			Timestamp:  de.Timestamp,
		}, true

	default:
		// draft_saved, draft_updated — not exposed
		return model.ShipmentEvent{}, false
	}
}
