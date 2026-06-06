package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

type fakeSLAExpiredEmailSender struct {
	calls chan model.Shipment
}

func (f *fakeSLAExpiredEmailSender) SendSLAExpiredNotification(shipment model.Shipment) {
	if f.calls != nil {
		f.calls <- shipment
	}
}

func TestCheckSLARisk_SendsCustomerEmailOnceWhenExpired(t *testing.T) {
	shipment := model.Shipment{
		TrackingID:          "LT-EXPIRED",
		Recipient:           model.Customer{Email: "cliente@example.com"},
		Status:              model.StatusAtHub,
		ReceivingBranchID:   "caba",
		CurrentLocation:     "caba",
		EstimatedDeliveryAt: ptrTimeRouting(time.Now().UTC().Add(-2 * time.Hour)),
	}
	fakeRepo := &fakeShipmentRepo{shipments: []model.Shipment{shipment}}
	fakeEmail := &fakeSLAExpiredEmailSender{calls: make(chan model.Shipment, 2)}
	svc := &RoutingService{shipmentRepo: fakeRepo, slaExpiredEmailSvc: fakeEmail}

	svc.checkSLARisk(fakeRepo.shipments, model.DefaultRoutingConfig(), time.Now().UTC())

	select {
	case got := <-fakeEmail.calls:
		if got.TrackingID != shipment.TrackingID {
			t.Fatalf("expected shipment %s, got %s", shipment.TrackingID, got.TrackingID)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected SLA expired email call")
	}
	if fakeRepo.shipments[0].SLAExpiredNotifiedAt == nil {
		t.Fatalf("expected SLAExpiredNotifiedAt to be set")
	}

	// Second pass must not resend.
	svc.checkSLARisk(fakeRepo.shipments, model.DefaultRoutingConfig(), time.Now().UTC())
	select {
	case <-fakeEmail.calls:
		t.Fatalf("expected no duplicate email")
	case <-time.After(150 * time.Millisecond):
	}
}

func ptrTimeRouting(t time.Time) *time.Time { return &t }
