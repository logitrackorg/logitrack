package service

import (
	"strings"
	"testing"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func newClaimSetup() (*ClaimService, testSetup) {
	shipmentRepo, eventStore, proj := repository.NewInMemoryShipmentRepositoryWithDeps()
	branchRepo := testBranchRepo()
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	incidentRepo := repository.NewInMemoryIncidentRepository()
	commentSvc := NewCommentService(commentRepo, shipmentRepo)
	incidentSvc := NewIncidentService(incidentRepo, shipmentRepo, eventStore, proj)
	svc := NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, nil)
	svc.SetPricingService(NewPricingService(repository.NewInMemoryPricingConfigRepository()))
	ts := testSetup{svc, commentSvc, incidentSvc, shipmentRepo, commentRepo, incidentRepo}
	claimSvc := NewClaimService(
		repository.NewInMemoryClaimRepository(),
		repository.NewInMemoryClaimEventRepository(),
		shipmentRepo,
		eventStore,
	)
	return claimSvc, ts
}

func TestCreatePublicClaim_UniqueSequentialIDs(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	c1, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	})
	if err != nil {
		t.Fatalf("create claim 1: %v", err)
	}
	c2, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDamage,
		Description: "Paquete llegó con daños visibles",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	})
	if err != nil {
		t.Fatalf("create claim 2: %v", err)
	}
	if c1.ID == c2.ID {
		t.Errorf("expected distinct claim IDs, both %s", c1.ID)
	}
	if !strings.HasPrefix(c1.ID, "REC-") || !strings.HasPrefix(c2.ID, "REC-") {
		t.Errorf("expected REC- prefix, got %q and %q", c1.ID, c2.ID)
	}
}

func TestCreatePublicClaim_AppendsShipmentEvent(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	})
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	events, err := ts.shipmentRepo.GetEvents(ship.TrackingID)
	if err != nil {
		t.Fatalf("get events: %v", err)
	}
	found := false
	for _, ev := range events {
		if ev.EventType == model.EventClaimCreated && strings.Contains(ev.Notes, claim.ID) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected claim_created in shipment events, got %+v", events)
	}
}

func TestCreatePublicClaim_PersistsClaimEvents(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	})
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	events, err := claimSvc.GetEvents(claim.ID, "")
	if err != nil {
		t.Fatalf("get claim events: %v", err)
	}
	if len(events) != 1 || events[0].EventType != model.EventClaimCreated {
		t.Fatalf("expected one claim_created event, got %+v", events)
	}
}

func TestResolveClaim_AppendsResolvedEvent(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	})
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	_, err = claimSvc.Resolve(claim.ID, model.ClaimResolutionImprocedente, "sup_caba", "", "Reclamo revisado y rechazado por falta de evidencia")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	events, err := claimSvc.GetEvents(claim.ID, "")
	if err != nil {
		t.Fatalf("get claim events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[1].EventType != model.EventClaimResolved {
		t.Errorf("expected claim_resolved, got %s", events[1].EventType)
	}
	if events[1].Notes != "Reclamo revisado y rechazado por falta de evidencia" {
		t.Errorf("expected notes to be stored, got %q", events[1].Notes)
	}
}

func TestMarkInReview_TransitionsFromPendingCustomer(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	})
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	claim, err = claimSvc.RequestCustomerInfo(claim.ID, "sup_caba", "", "Necesitamos fotos del paquete y del embalaje para continuar")
	if err != nil {
		t.Fatalf("request customer info: %v", err)
	}
	if claim.Status != model.ClaimStatusPendingCustomer {
		t.Fatalf("expected pending_customer after request info, got %s", claim.Status)
	}

	updated, err := claimSvc.MarkInReview(claim.ID, "sup_caba", "")
	if err != nil {
		t.Fatalf("mark in review: %v", err)
	}
	if updated.Status != model.ClaimStatusInReview {
		t.Fatalf("expected in_review, got %s", updated.Status)
	}

	events, err := claimSvc.GetEvents(claim.ID, "")
	if err != nil {
		t.Fatalf("get claim events: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	if events[2].EventType != model.EventClaimInReview {
		t.Fatalf("expected claim_in_review, got %s", events[2].EventType)
	}
	if events[2].FromStatus != model.ClaimStatusPendingCustomer || events[2].ToStatus != model.ClaimStatusInReview {
		t.Fatalf("unexpected transition payload: %+v", events[2])
	}
}
