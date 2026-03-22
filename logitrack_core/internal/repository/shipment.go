package repository

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/logitrack/core/internal/model"
)

type ShipmentRepository interface {
	Create(shipment model.Shipment) (model.Shipment, error)
	GetByTrackingID(trackingID string) (model.Shipment, error)
	UpdateStatus(trackingID string, status model.Status) (model.Shipment, error)
	UpdateLocation(trackingID string, location string) error
	SetDeliveredAt(trackingID string, t time.Time) error
	// ConfirmShipment promotes a draft: replaces the draft key with the real trackingID.
	ConfirmShipment(draftID string, trackingID string, status model.Status) (model.Shipment, error)
	UpdateDraft(shipment model.Shipment) (model.Shipment, error)
	ApplyCorrections(trackingID string, corrections map[string]string) (model.Shipment, error)
	List(filter model.ShipmentFilter) ([]model.Shipment, error)
	Search(query string) ([]model.Shipment, error)
	AddEvent(event model.ShipmentEvent) error
	GetEvents(trackingID string) ([]model.ShipmentEvent, error)
	Stats() (model.Stats, error)
}

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

func (r *inMemoryShipmentRepository) Create(shipment model.Shipment) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.shipments[shipment.TrackingID] = shipment
	r.events[shipment.TrackingID] = []model.ShipmentEvent{}
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

func (r *inMemoryShipmentRepository) UpdateStatus(trackingID string, status model.Status) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[trackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	shipment.Status = status
	r.shipments[trackingID] = shipment
	return shipment, nil
}

func (r *inMemoryShipmentRepository) UpdateLocation(trackingID string, location string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[trackingID]
	if !ok {
		return fmt.Errorf("shipment not found")
	}
	shipment.CurrentLocation = location
	r.shipments[trackingID] = shipment
	return nil
}

func (r *inMemoryShipmentRepository) SetDeliveredAt(trackingID string, t time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[trackingID]
	if !ok {
		return fmt.Errorf("shipment not found")
	}
	shipment.DeliveredAt = &t
	r.shipments[trackingID] = shipment
	return nil
}

func (r *inMemoryShipmentRepository) UpdateDraft(shipment model.Shipment) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.shipments[shipment.TrackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	if existing.Status != model.StatusPending {
		return model.Shipment{}, fmt.Errorf("only draft shipments can be updated")
	}
	r.shipments[shipment.TrackingID] = shipment
	return shipment, nil
}

func (r *inMemoryShipmentRepository) ConfirmShipment(draftID string, trackingID string, status model.Status) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[draftID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	shipment.TrackingID = trackingID
	shipment.Status = status
	delete(r.shipments, draftID)
	r.shipments[trackingID] = shipment
	// Move events to new key, updating each event's TrackingID
	events := r.events[draftID]
	for i := range events {
		events[i].TrackingID = trackingID
	}
	delete(r.events, draftID)
	r.events[trackingID] = events
	return shipment, nil
}

func (r *inMemoryShipmentRepository) ApplyCorrections(trackingID string, corrections map[string]string) (model.Shipment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	shipment, ok := r.shipments[trackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	if shipment.Corrections == nil {
		shipment.Corrections = make(map[string]string)
	}
	for k, v := range corrections {
		shipment.Corrections[k] = v
	}
	r.shipments[trackingID] = shipment
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
			strings.Contains(strings.ToLower(s.RecipientName), q) ||
			strings.Contains(strings.ToLower(s.SenderName), q) ||
			strings.Contains(strings.ToLower(s.Destination.City), q) ||
			strings.Contains(strings.ToLower(s.Origin.City), q) {
			result = append(result, s)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TrackingID < result[j].TrackingID
	})
	return result, nil
}

func (r *inMemoryShipmentRepository) AddEvent(event model.ShipmentEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events[event.TrackingID] = append(r.events[event.TrackingID], event)
	return nil
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

func (r *inMemoryShipmentRepository) Stats() (model.Stats, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	stats := model.Stats{
		Total:    len(r.shipments),
		ByStatus: map[model.Status]int{},
	}
	for _, s := range r.shipments {
		stats.ByStatus[s.Status]++
	}
	return stats, nil
}
