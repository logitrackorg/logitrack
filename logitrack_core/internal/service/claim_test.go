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
		CreatedBy:   "Cliente Test",
	})
	if err != nil {
		t.Fatalf("create claim 1: %v", err)
	}
	c2, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDamage,
		Description: "Paquete llegó con daños visibles",
		CreatedBy:   "Cliente Test",
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
		CreatedBy:   "Cliente Test",
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
		CreatedBy:   "Cliente Test",
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
		CreatedBy:   "Cliente Test",
	})
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	_, err = claimSvc.Resolve(claim.ID, model.ClaimResolutionImprocedente, "sup_caba", "")
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
}
