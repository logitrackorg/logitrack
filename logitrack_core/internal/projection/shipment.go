package projection

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/logitrack/core/internal/model"
)

// ShipmentProjection is a write-through materialized view built from DomainEvents.
// It is always in sync with the event store: every Append is followed by an Apply.
type ShipmentProjection struct {
	mu        sync.RWMutex
	shipments map[string]model.Shipment
}

func NewShipmentProjection() *ShipmentProjection {
	return &ShipmentProjection{
		shipments: make(map[string]model.Shipment),
	}
}

// Apply updates the projection for a single event. Called after every Append.
func (p *ShipmentProjection) Apply(event model.DomainEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()

	switch event.EventType {
	case model.EventShipmentCreated:
		payload := event.Payload.(model.ShipmentCreatedPayload)
		p.shipments[event.TrackingID] = payload.Shipment

	case model.EventDraftSaved:
		payload := event.Payload.(model.DraftSavedPayload)
		p.shipments[event.TrackingID] = payload.Shipment

	case model.EventDraftUpdated:
		payload := event.Payload.(model.DraftUpdatedPayload)
		p.shipments[event.TrackingID] = payload.Shipment

	case model.EventDraftConfirmed:
		payload := event.Payload.(model.DraftConfirmedPayload)
		draft, ok := p.shipments[payload.OldTrackingID]
		if !ok {
			return
		}
		draft.TrackingID = payload.NewTrackingID
		draft.Status = model.StatusInProgress
		draft.UpdatedAt = event.Timestamp
		delete(p.shipments, payload.OldTrackingID)
		p.shipments[payload.NewTrackingID] = draft

	case model.EventStatusChanged:
		payload := event.Payload.(model.StatusChangedPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		shipment.Status = payload.ToStatus
		shipment.UpdatedAt = event.Timestamp
		if payload.Location != "" && payload.ToStatus != model.StatusDelivered {
			shipment.CurrentLocation = payload.Location
		}
		if payload.ToStatus == model.StatusDelivered {
			t := event.Timestamp
			shipment.DeliveredAt = &t
		}
		p.shipments[event.TrackingID] = shipment

	case model.EventShipmentCorrected:
		payload := event.Payload.(model.ShipmentCorrectedPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		if shipment.Corrections == nil {
			shipment.Corrections = &model.ShipmentCorrections{}
		}
		shipment.Corrections.Merge(payload.Corrections)
		shipment.UpdatedAt = event.Timestamp
		p.shipments[event.TrackingID] = shipment

	case model.EventShipmentCancelled:
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		shipment.Status = model.StatusCancelled
		shipment.UpdatedAt = event.Timestamp
		p.shipments[event.TrackingID] = shipment
	}
}

// Rebuild replays all events from scratch. Used at startup and for seed data.
func (p *ShipmentProjection) Rebuild(events []model.DomainEvent) {
	p.mu.Lock()
	p.shipments = make(map[string]model.Shipment)
	p.mu.Unlock()
	for _, event := range events {
		p.Apply(event)
	}
}

func (p *ShipmentProjection) Get(trackingID string) (model.Shipment, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	s, ok := p.shipments[trackingID]
	if !ok {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	return s, nil
}

func (p *ShipmentProjection) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]model.Shipment, 0, len(p.shipments))
	for _, s := range p.shipments {
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

func (p *ShipmentProjection) Search(query string) ([]model.Shipment, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	q := strings.ToLower(query)
	var result []model.Shipment
	for _, s := range p.shipments {
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

func (p *ShipmentProjection) Stats() (model.Stats, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	stats := model.Stats{
		Total:    len(p.shipments),
		ByStatus: map[model.Status]int{},
		ByBranch: map[string]int{},
	}
	for _, s := range p.shipments {
		stats.ByStatus[s.Status]++
		if s.Status != model.StatusDelivered && s.Status != model.StatusReturned && s.CurrentLocation != "" {
			stats.ByBranch[s.CurrentLocation]++
		}
	}
	return stats, nil
}
