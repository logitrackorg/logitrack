package projection

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

func newTestShipment(trackingID string) model.Shipment {
	return model.Shipment{
		TrackingID:      trackingID,
		Status:          model.StatusAtOriginHub,
		DeliveryMethod:  model.DeliveryMethodLastMile,
		CurrentLocation: "caba",
		OriginBranchID:  "caba",
		FinalBranchID:   "cordoba",
		UpdatedAt:       time.Now(),
	}
}

func applyToMemProj(events ...model.DomainEvent) (*ShipmentProjection, error) {
	p := NewShipmentProjection()
	p.Rebuild(events)
	return p, nil
}

// TestPickupRequest_NotAtFinalBranch: solicitar pickup cuando el envío todavía no llegó
// a la sucursal destino → solo cambia DeliveryMethod, status queda at_origin_hub.
func TestPickupRequest_NotAtFinalBranch(t *testing.T) {
	tid := "LT-TEST0001"
	now := time.Now()

	created := model.DomainEvent{
		ID:         "e1",
		TrackingID: tid,
		EventType:  model.EventShipmentCreated,
		Payload: model.ShipmentCreatedPayload{
			Shipment: newTestShipment(tid),
		},
		Timestamp: now,
	}
	pickupRequested := model.DomainEvent{
		ID:         "e2",
		TrackingID: tid,
		EventType:  model.EventPickupRequested,
		Payload: model.PickupRequestedPayload{
			RecipientDNI:   "12345678",
			PreviousMethod: model.DeliveryMethodLastMile,
			FinalBranchID:  "cordoba",
			RequestedVia:   "chatbot",
		},
		Timestamp: now.Add(time.Minute),
	}

	p, _ := applyToMemProj(created, pickupRequested)
	s, err := p.Get(tid)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}

	if s.DeliveryMethod != model.DeliveryMethodBranchPickup {
		t.Errorf("DeliveryMethod = %q, want %q", s.DeliveryMethod, model.DeliveryMethodBranchPickup)
	}
	if s.Status != model.StatusAtOriginHub {
		t.Errorf("Status = %q, want %q (debe mantenerse hasta llegar a sucursal destino)", s.Status, model.StatusAtOriginHub)
	}
}

// TestPickupRequest_AutoPromoteOnArrival: envío con branch_pickup llega a la sucursal
// final (at_hub en cordoba) → debe promoverse automáticamente a ready_for_pickup.
func TestPickupRequest_AutoPromoteOnArrival(t *testing.T) {
	tid := "LT-TEST0002"
	now := time.Now()

	created := model.DomainEvent{
		ID:         "e1",
		TrackingID: tid,
		EventType:  model.EventShipmentCreated,
		Payload: model.ShipmentCreatedPayload{
			Shipment: newTestShipment(tid),
		},
		Timestamp: now,
	}
	pickupRequested := model.DomainEvent{
		ID:         "e2",
		TrackingID: tid,
		EventType:  model.EventPickupRequested,
		Payload: model.PickupRequestedPayload{
			RecipientDNI:   "12345678",
			PreviousMethod: model.DeliveryMethodLastMile,
			FinalBranchID:  "cordoba",
			RequestedVia:   "chatbot",
		},
		Timestamp: now.Add(time.Minute),
	}
	// Evento de llegada a la sucursal final
	arrivedAtFinal := model.DomainEvent{
		ID:         "e3",
		TrackingID: tid,
		EventType:  model.EventStatusChanged,
		Payload: model.StatusChangedPayload{
			FromStatus: model.StatusInTransit,
			ToStatus:   model.StatusAtHub,
			Location:   "cordoba",
		},
		Timestamp: now.Add(2 * time.Hour),
	}

	p, _ := applyToMemProj(created, pickupRequested, arrivedAtFinal)
	s, err := p.Get(tid)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}

	if s.Status != model.StatusReadyForPickup {
		t.Errorf("Status = %q, want %q (debe promoverse al llegar a sucursal final)", s.Status, model.StatusReadyForPickup)
	}
	if s.CurrentLocation != "cordoba" {
		t.Errorf("CurrentLocation = %q, want %q", s.CurrentLocation, "cordoba")
	}
}

// TestPickupRequest_AlreadyAtFinalBranch: envío ya en at_hub en sucursal final
// solicita pickup → transición directa a ready_for_pickup.
func TestPickupRequest_AlreadyAtFinalBranch(t *testing.T) {
	tid := "LT-TEST0003"
	now := time.Now()

	s := newTestShipment(tid)
	s.Status = model.StatusAtHub
	s.CurrentLocation = "cordoba"

	created := model.DomainEvent{
		ID:         "e1",
		TrackingID: tid,
		EventType:  model.EventShipmentCreated,
		Payload:    model.ShipmentCreatedPayload{Shipment: s},
		Timestamp:  now,
	}
	pickupRequested := model.DomainEvent{
		ID:         "e2",
		TrackingID: tid,
		EventType:  model.EventPickupRequested,
		Payload: model.PickupRequestedPayload{
			RecipientDNI:   "12345678",
			PreviousMethod: model.DeliveryMethodLastMile,
			FinalBranchID:  "cordoba",
			RequestedVia:   "chatbot",
		},
		Timestamp: now.Add(time.Minute),
	}

	p, _ := applyToMemProj(created, pickupRequested)
	result, err := p.Get(tid)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}

	if result.Status != model.StatusReadyForPickup {
		t.Errorf("Status = %q, want %q", result.Status, model.StatusReadyForPickup)
	}
}
