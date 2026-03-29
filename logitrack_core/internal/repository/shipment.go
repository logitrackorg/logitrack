package repository

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
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
	TrackingID  string
	Username    string
	Status      model.Status // current status (unchanged)
	Corrections model.ShipmentCorrections
	Timestamp   time.Time
	Prediction  *model.PriorityPrediction
}

type CancelCmd struct {
	TrackingID string
	Username   string
	Reason     string
	FromStatus model.Status
	Timestamp  time.Time
}

// inMemoryShipmentRepository is a simple in-memory adapter that mutates state directly.
// It stores ShipmentEvent objects for GetEvents compatibility.
type inMemoryShipmentRepository struct {
	mu        sync.RWMutex
	shipments map[string]model.Shipment
	events    map[string][]model.ShipmentEvent
}

func NewInMemoryShipmentRepository() ShipmentRepository {
	return &inMemoryShipmentRepository{
		shipments: make(map[string]model.Shipment),
		events:    make(map[string][]model.ShipmentEvent),
	}
}

func (r *inMemoryShipmentRepository) Create(cmd CreateShipmentCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.shipments[cmd.Shipment.TrackingID] = cmd.Shipment
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		ToStatus:   model.StatusInProgress,
		ChangedBy:  cmd.ChangedBy,
		Notes:      cmd.Notes,
		Timestamp:  cmd.Shipment.CreatedAt,
	}
	r.events[cmd.Shipment.TrackingID] = []model.ShipmentEvent{event}
	return cmd.Shipment, nil
}

func (r *inMemoryShipmentRepository) SaveDraft(cmd SaveDraftCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.shipments[cmd.Shipment.TrackingID] = cmd.Shipment
	r.events[cmd.Shipment.TrackingID] = []model.ShipmentEvent{}
	return cmd.Shipment, nil
}

func (r *inMemoryShipmentRepository) UpdateDraft(cmd UpdateDraftCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.shipments[cmd.Shipment.TrackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	if existing.Status != model.StatusPending {
		return model.Shipment{}, fmt.Errorf("only draft shipments can be updated")
	}
	r.shipments[cmd.Shipment.TrackingID] = cmd.Shipment
	return cmd.Shipment, nil
}

func (r *inMemoryShipmentRepository) ConfirmDraft(cmd ConfirmDraftCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[cmd.DraftID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	shipment.TrackingID = cmd.NewTrackingID
	shipment.Status = model.StatusInProgress
	shipment.UpdatedAt = cmd.Timestamp
	delete(r.shipments, cmd.DraftID)
	r.shipments[cmd.NewTrackingID] = shipment

	// Migrate events to new key
	draftEvents := r.events[cmd.DraftID]
	for i := range draftEvents {
		draftEvents[i].TrackingID = cmd.NewTrackingID
	}
	delete(r.events, cmd.DraftID)

	from := model.StatusPending
	confirmEvent := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.NewTrackingID,
		FromStatus: &from,
		ToStatus:   model.StatusInProgress,
		ChangedBy:  cmd.ChangedBy,
		Notes:      cmd.Notes,
		Timestamp:  cmd.Timestamp,
	}
	r.events[cmd.NewTrackingID] = append(draftEvents, confirmEvent)
	return shipment, nil
}

func (r *inMemoryShipmentRepository) UpdateStatus(cmd StatusUpdateCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[cmd.TrackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	shipment.Status = cmd.ToStatus
	shipment.UpdatedAt = cmd.Timestamp
	if cmd.Location != "" && cmd.ToStatus != model.StatusDelivered {
		shipment.CurrentLocation = cmd.Location
	}
	if cmd.ToStatus == model.StatusDelivered {
		t := cmd.Timestamp
		shipment.DeliveredAt = &t
	}
	r.shipments[cmd.TrackingID] = shipment

	from := cmd.FromStatus
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		FromStatus: &from,
		ToStatus:   cmd.ToStatus,
		ChangedBy:  cmd.ChangedBy,
		Location:   cmd.Location,
		Notes:      cmd.Notes,
		Timestamp:  cmd.Timestamp,
	}
	r.events[cmd.TrackingID] = append(r.events[cmd.TrackingID], event)
	return shipment, nil
}

func (r *inMemoryShipmentRepository) ApplyCorrections(cmd CorrectCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[cmd.TrackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	if shipment.Corrections == nil {
		shipment.Corrections = &model.ShipmentCorrections{}
	}
	shipment.Corrections.Merge(cmd.Corrections)
	shipment.UpdatedAt = cmd.Timestamp
	r.shipments[cmd.TrackingID] = shipment

	from := cmd.Status
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  "edited",
		FromStatus: &from,
		ToStatus:   cmd.Status,
		ChangedBy:  cmd.Username,
		Notes:      fmt.Sprintf("Data correction: %d field(s) updated", len(cmd.Corrections.Fields())),
		Timestamp:  cmd.Timestamp,
	}
	r.events[cmd.TrackingID] = append(r.events[cmd.TrackingID], event)
	return shipment, nil
}

func (r *inMemoryShipmentRepository) CancelShipment(cmd CancelCmd) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[cmd.TrackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	shipment.Status = model.StatusCancelled
	shipment.UpdatedAt = cmd.Timestamp
	r.shipments[cmd.TrackingID] = shipment

	from := cmd.FromStatus
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		FromStatus: &from,
		ToStatus:   model.StatusCancelled,
		ChangedBy:  cmd.Username,
		Notes:      cmd.Reason,
		Timestamp:  cmd.Timestamp,
	}
	r.events[cmd.TrackingID] = append(r.events[cmd.TrackingID], event)
	return shipment, nil
}

func (r *inMemoryShipmentRepository) GetByTrackingID(trackingID string) (model.Shipment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	shipment, ok := r.shipments[trackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	return shipment, nil
}

func (r *inMemoryShipmentRepository) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.Shipment, 0, len(r.shipments))
	for _, s := range r.shipments {
		if filter.DateFrom != nil && s.CreatedAt.Before(*filter.DateFrom) {
			continue
		}
		if filter.DateTo != nil && s.CreatedAt.After(*filter.DateTo) {
			continue
		}
		result = append(result, s)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TrackingID < result[j].TrackingID
	})
	return result, nil
}

func (r *inMemoryShipmentRepository) Search(query string) ([]model.Shipment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	q := strings.ToLower(query)
	var result []model.Shipment
	for _, s := range r.shipments {
		if strings.Contains(strings.ToLower(s.TrackingID), q) ||
			strings.Contains(strings.ToLower(s.Recipient.Name), q) ||
			strings.Contains(strings.ToLower(s.Sender.Name), q) ||
			strings.Contains(strings.ToLower(s.Recipient.Address.City), q) ||
			strings.Contains(strings.ToLower(s.Sender.Address.City), q) {
			result = append(result, s)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TrackingID < result[j].TrackingID
	})
	return result, nil
}

func (r *inMemoryShipmentRepository) GetEvents(trackingID string) ([]model.ShipmentEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	events, ok := r.events[trackingID]
	if !ok {
		return nil, fmt.Errorf("shipment not found")
	}
	return events, nil
}

func (r *inMemoryShipmentRepository) Stats(filter model.ShipmentFilter) (model.Stats, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	stats := model.Stats{
		Total:          len(r.shipments),
		ByStatus:       map[model.Status]int{},
		ByBranch:       map[string]int{},
		ByDay:          map[string]int{},
		ByDayDelivered: map[string]int{},
	}
	if filter.DateFrom != nil && filter.DateTo != nil {
		for d := filter.DateFrom.Truncate(24 * time.Hour); !d.After(*filter.DateTo); d = d.AddDate(0, 0, 1) {
			key := d.Format("2006-01-02")
			stats.ByDay[key] = 0
			stats.ByDayDelivered[key] = 0
		}
	}
	for _, s := range r.shipments {
		stats.ByStatus[s.Status]++
		if s.Status != model.StatusDelivered && s.Status != model.StatusReturned && s.CurrentLocation != "" {
			stats.ByBranch[s.CurrentLocation]++
		}
		inRange := (filter.DateFrom == nil || !s.CreatedAt.Before(*filter.DateFrom)) &&
			(filter.DateTo == nil || !s.CreatedAt.After(*filter.DateTo))
		if inRange {
			stats.ByDay[s.CreatedAt.Format("2006-01-02")]++
		}
		if s.DeliveredAt != nil {
			deliveredInRange := (filter.DateFrom == nil || !s.DeliveredAt.Before(*filter.DateFrom)) &&
				(filter.DateTo == nil || !s.DeliveredAt.After(*filter.DateTo))
			if deliveredInRange {
				stats.ByDayDelivered[s.DeliveredAt.Format("2006-01-02")]++
			}
		}
	}
	return stats, nil
}
