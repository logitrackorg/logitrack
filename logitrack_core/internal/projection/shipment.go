package projection

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

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
		draft.Status = model.StatusAtOriginHub
		draft.UpdatedAt = event.Timestamp
		draft.EstimatedDeliveryAt = payload.EstimatedDeliveryAt // *time.Time, nil for drafts
		if payload.Price != nil {
			draft.Price = payload.Price
		}
		if payload.PriceBreakdown != nil {
			draft.PriceBreakdown = payload.PriceBreakdown
		}
		if draft.PriceCurrency == "" {
			draft.PriceCurrency = model.CurrencyARS
		}
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
		if (payload.ToStatus == model.StatusAtHub || payload.ToStatus == model.StatusAtOriginHub) && payload.Location != "" {
			shipment.ReceivingBranchID = payload.Location
		}
		if payload.ToStatus == model.StatusDelivered {
			t := event.Timestamp
			shipment.DeliveredAt = &t
		}
		if payload.ToStatus == model.StatusDeliveryFailed {
			shipment.DeliveryAttempts++
		}
		if payload.ToStatus == model.StatusNoEntregado || payload.ToStatus == model.StatusRechazado {
			shipment.IsReturning = true
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

	case model.EventIncidentReported:
		payload := event.Payload.(model.IncidentReportedPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		shipment.HasIncident = true
		shipment.IncidentType = payload.IncidentType
		shipment.UpdatedAt = event.Timestamp
		p.shipments[event.TrackingID] = shipment

	case model.EventShipmentETAExtended:
		payload := event.Payload.(model.ShipmentETAExtendedPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		newETA := payload.NewETA
		shipment.EstimatedDeliveryAt = &newETA
		shipment.UpdatedAt = event.Timestamp
		p.shipments[event.TrackingID] = shipment

	
		case model.EventPickupRequested:
		_ = event.Payload.(model.PickupRequestedPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		// Cambiar método de entrega a retiro en sucursal
		shipment.DeliveryMethod = model.DeliveryMethodBranchPickup
		// Cambiar estado a ready_for_pickup
		shipment.Status = model.StatusReadyForPickup
		// Actualizar timestamp y metadata
		shipment.UpdatedAt = event.Timestamp
		if shipment.ChatbotMetadata == nil {
			shipment.ChatbotMetadata = &model.ChatbotMetadata{
				MaxReschedules: 2,
			}
		}
		now := event.Timestamp
		shipment.ChatbotMetadata.LastChatbotInteraction = &now
		p.shipments[event.TrackingID] = shipment

	case model.EventDeliveryRescheduled:
		payload := event.Payload.(model.DeliveryRescheduledPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		// Actualizar fecha de entrega estimada
		newDate := payload.NewDeliveryDate
		shipment.EstimatedDeliveryAt = &newDate
		shipment.UpdatedAt = event.Timestamp
		
		// Actualizar metadata del chatbot
		if shipment.ChatbotMetadata == nil {
			shipment.ChatbotMetadata = &model.ChatbotMetadata{
				MaxReschedules: 2,
			}
		}
		shipment.ChatbotMetadata.RescheduleCount = payload.RescheduleCount
		shipment.ChatbotMetadata.ScheduledDeliveryDate = &newDate
		if shipment.ChatbotMetadata.OriginalDeliveryDate == nil && payload.OriginalDate != nil {
			shipment.ChatbotMetadata.OriginalDeliveryDate = payload.OriginalDate
		}
		now := event.Timestamp
		shipment.ChatbotMetadata.LastChatbotInteraction = &now
		
		// Si el estado es "redelivery_scheduled", mantenerlo; sino cambiarlo
		if shipment.Status != model.StatusRedeliveryScheduled {
			shipment.Status = model.StatusRedeliveryScheduled
		}
		p.shipments[event.TrackingID] = shipment

	case model.EventCancelledByRecipient:
		payload := event.Payload.(model.CancelledByRecipientPayload)
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		// Cambiar estado a cancelado
		shipment.Status = model.StatusCancelled
		shipment.UpdatedAt = event.Timestamp
		
		// Actualizar metadata del chatbot
		if shipment.ChatbotMetadata == nil {
			shipment.ChatbotMetadata = &model.ChatbotMetadata{
				MaxReschedules: 2,
			}
		}
		now := event.Timestamp
		shipment.ChatbotMetadata.CancelledAt = &now
		shipment.ChatbotMetadata.CancelledBy = "RECIPIENT"
		shipment.ChatbotMetadata.CancellationReason = payload.Reason
		shipment.ChatbotMetadata.LastChatbotInteraction = &now
		p.shipments[event.TrackingID] = shipment

	case model.EventShipmentZoned:
		payload, ok := event.Payload.(model.ShipmentZonedPayload)
		if !ok {
			return
		}
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		zone := string(payload.Zone)
		shipment.CurrentZone = &zone
		shipment.UpdatedAt = event.Timestamp
		p.shipments[event.TrackingID] = shipment

	case model.EventShipmentMoved:
		payload, ok := event.Payload.(model.ShipmentMovedPayload)
		if !ok {
			return
		}
		shipment, ok := p.shipments[event.TrackingID]
		if !ok {
			return
		}
		if payload.ToZone == "" {
			shipment.CurrentZone = nil
		} else {
			zone := string(payload.ToZone)
			shipment.CurrentZone = &zone
		}
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
		if filter.ReceivingBranchID != "" && s.ReceivingBranchID != filter.ReceivingBranchID {
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

func (p *ShipmentProjection) Stats(filter model.ShipmentFilter) (model.Stats, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	stats := model.Stats{
		Total:          len(p.shipments),
		ByStatus:       map[model.Status]int{},
		ByBranch:       map[string]int{},
		ByDay:          map[string]int{},
		ByDayDelivered: map[string]int{},
	}
	// Pre-fill zeros for every day in the requested range.
	if filter.DateFrom != nil && filter.DateTo != nil {
		for d := filter.DateFrom.Truncate(24 * time.Hour); !d.After(*filter.DateTo); d = d.AddDate(0, 0, 1) {
			key := d.Format("2006-01-02")
			stats.ByDay[key] = 0
			stats.ByDayDelivered[key] = 0
		}
	}
	for _, s := range p.shipments {
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

func (p *ShipmentProjection) CancellationStats(dateFrom, dateTo *time.Time, branchID string) (model.CancellationStats, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return model.CancellationStats{
		ByDay:            map[string]int{},
		ReasonsBreakdown: map[string]int{},
	}, nil
}

func (p *ShipmentProjection) AvgTimePerStatus(dateFrom, dateTo *time.Time) (model.AvgTimePerStatus, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return model.AvgTimePerStatus{}, nil
}

func (p *ShipmentProjection) StatsDetail(statusFilter string, dateFrom, dateTo *time.Time) (map[string]int, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := map[string]int{}
	for _, s := range p.shipments {
		if statusFilter != "" && string(s.Status) != statusFilter {
			continue
		}
		if dateFrom != nil && s.CreatedAt.Before(*dateFrom) {
			continue
		}
		if dateTo != nil && s.CreatedAt.After(*dateTo) {
			continue
		}
		if s.ReceivingBranchID != "" {
			result[s.ReceivingBranchID]++
		}
	}
	return result, nil
}

func (p *ShipmentProjection) ReserveForTrip(trackingID, tripID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.shipments[trackingID]
	if !ok {
		return fmt.Errorf("shipment not found")
	}
	if s.ReservedForTripID != nil {
		return fmt.Errorf("shipment already reserved")
	}
	tid := tripID
	s.ReservedForTripID = &tid
	p.shipments[trackingID] = s
	return nil
}

func (p *ShipmentProjection) ReleaseFromTrip(trackingID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.shipments[trackingID]
	if !ok {
		return fmt.Errorf("shipment not found")
	}
	s.ReservedForTripID = nil
	p.shipments[trackingID] = s
	return nil
}

func (p *ShipmentProjection) SetSLANotified(trackingID string, notifiedAt *time.Time) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.shipments[trackingID]
	if !ok {
		return fmt.Errorf("shipment not found")
	}
	s.SLANotifiedAt = notifiedAt
	p.shipments[trackingID] = s
	return nil
}

func (p *ShipmentProjection) SetSLAExpiredNotified(trackingID string, notifiedAt *time.Time) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.shipments[trackingID]
	if !ok {
		return fmt.Errorf("shipment not found")
	}
	s.SLAExpiredNotifiedAt = notifiedAt
	p.shipments[trackingID] = s
	return nil
}

// SetConfirmationEmailSent marca el envío como notificado por email (CA-05 dedup, in-memory).
// Devuelve true si fue el primer llamado (no estaba marcado).
func (p *ShipmentProjection) SetConfirmationEmailSent(trackingID string) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.shipments[trackingID]
	if !ok {
		return false, fmt.Errorf("shipment not found")
	}
	if s.ConfirmationEmailSentAt != nil {
		return false, nil // ya enviado
	}
	now := time.Now().UTC()
	s.ConfirmationEmailSentAt = &now
	p.shipments[trackingID] = s
	return true, nil
}
