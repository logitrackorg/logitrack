package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// withEligibleClock avanza el reloj global lo suficiente como para que
// CanFileClaim devuelva true para envíos recién creados (ETA > now por días).
// Necesario en tests que crean reclamos no-bad_treatment sobre envíos en
// at_origin_hub, porque CreatePublicClaim ahora valida elegibilidad por tipo.
func withEligibleClock(t *testing.T) {
	t.Helper()
	clock.SetOverride(time.Now().Add(30 * 24 * time.Hour))
	t.Cleanup(clock.ClearOverride)
}

// deliverShipment lleva un envío hasta "entregado". A diferencia de
// withEligibleClock (que adelanta el reloj y por ende vence el SLA, disparando
// el auto-pase a in_review), un envío en estado terminal no tiene SLA activo:
// el reclamo recién creado queda en estado "open". Usar en tests que verifican
// el estado/eventos iniciales del reclamo, no solo la elegibilidad.
func deliverShipment(t *testing.T, ts testSetup, id string) {
	t.Helper()
	toInTransit(t, ts, id)
	toAtHub(t, ts, id)
	toOutForDelivery(t, ts, id)
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status:       model.StatusDelivered,
		ChangedBy:    "driver-01",
		RecipientDNI: defaultRecipient().DNI,
	})
}

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

type fakeClaimEmailSender struct {
	createdCalls       chan claimEmailCall
	infoRequestedCalls chan claimInfoRequestedCall
	resolvedCalls      chan claimResolvedEmailCall
}

type claimEmailCall struct {
	claim    model.Claim
	shipment model.Shipment
}

type claimInfoRequestedCall struct {
	claim    model.Claim
	shipment model.Shipment
	notes    string
}

type claimResolvedEmailCall struct {
	claim    model.Claim
	shipment model.Shipment
	notes    string
}

func (f *fakeClaimEmailSender) SendClaimCreatedNotification(claim model.Claim, shipment model.Shipment) {
	if f.createdCalls != nil {
		f.createdCalls <- claimEmailCall{claim: claim, shipment: shipment}
	}
}

func (f *fakeClaimEmailSender) SendClaimInfoRequestedNotification(claim model.Claim, shipment model.Shipment, notes string) {
	if f.infoRequestedCalls != nil {
		f.infoRequestedCalls <- claimInfoRequestedCall{claim: claim, shipment: shipment, notes: notes}
	}
}

func (f *fakeClaimEmailSender) SendClaimResolvedNotification(claim model.Claim, shipment model.Shipment, notes string) {
	if f.resolvedCalls != nil {
		f.resolvedCalls <- claimResolvedEmailCall{claim: claim, shipment: shipment, notes: notes}
	}
}

func TestCreatePublicClaim_UniqueSequentialIDs(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	// Dos reclamantes distintos (remitente + destinatario) sobre el mismo
	// envío — la dedup centralizada bloquea duplicados del MISMO DNI, no de
	// partes distintas. Esto cubre el invariante de IDs únicos + el flujo de
	// "remitente reclama" y "destinatario reclama" en paralelo.
	c1, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("create claim 1: %v", err)
	}
	c2, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDamage,
		Description: "Paquete llegó con daños visibles",
		CreatedBy:   "Bob Recipient",
		DNI:         "87654321",
	}, nil)
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
	withEligibleClock(t)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
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
	deliverShipment(t, ts, ship.TrackingID)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
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

func TestCreatePublicClaim_SendsCustomerEmail(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	deliverShipment(t, ts, ship.TrackingID)
	fakeEmail := &fakeClaimEmailSender{createdCalls: make(chan claimEmailCall, 1)}
	claimSvc.SetClaimEmailService(fakeEmail)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	select {
	case got := <-fakeEmail.createdCalls:
		if got.claim.ID != claim.ID {
			t.Fatalf("expected claim %s, got %s", claim.ID, got.claim.ID)
		}
		if got.claim.Status != model.ClaimStatusOpen {
			t.Fatalf("expected initial open status, got %s", got.claim.Status)
		}
		if got.shipment.TrackingID != ship.TrackingID {
			t.Fatalf("expected shipment %s, got %s", ship.TrackingID, got.shipment.TrackingID)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected claim-created email call")
	}
}

func TestCreatePublicClaim_WithEvidenceStoresMetadata(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("get wd: %v", err)
	}
	tmpDir := t.TempDir()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir temp: %v", err)
	}
	defer func() { _ = os.Chdir(oldWD) }()

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDamage,
		Description: "Producto dañado en el transporte",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, &ClaimEvidenceUpload{
		FileName: "evidencia.pdf",
		MimeType: "application/pdf",
		Data:     []byte("demo-pdf-bytes"),
	})
	if err != nil {
		t.Fatalf("create claim with evidence: %v", err)
	}
	if claim.EvidenceFileName == "" || claim.EvidenceFilePath == "" || claim.EvidenceMimeType == "" || claim.EvidenceUploadDate == nil {
		t.Fatalf("expected evidence metadata on claim, got %+v", claim)
	}
	if _, err := os.Stat(filepath.Clean(claim.EvidenceFilePath)); err != nil {
		t.Fatalf("expected evidence file on disk: %v", err)
	}
	stored, err := claimSvc.GetByID(claim.ID)
	if err != nil {
		t.Fatalf("get claim: %v", err)
	}
	if stored.EvidenceFileName != claim.EvidenceFileName || stored.EvidenceMimeType != claim.EvidenceMimeType {
		t.Fatalf("expected stored evidence metadata, got %+v", stored)
	}
}

func TestCreatePublicClaim_WithImageEvidenceInfersExtension(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("get wd: %v", err)
	}
	tmpDir := t.TempDir()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir temp: %v", err)
	}
	defer func() { _ = os.Chdir(oldWD) }()

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDamage,
		Description: "Imagen de evidencia para el reclamo",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, &ClaimEvidenceUpload{
		FileName: "captura",
		MimeType: "image/png",
		Data:     []byte("png-bytes"),
	})
	if err != nil {
		t.Fatalf("create claim with image evidence: %v", err)
	}
	if !strings.HasSuffix(strings.ToLower(claim.EvidenceFileName), ".png") {
		t.Fatalf("expected png extension, got %q", claim.EvidenceFileName)
	}
	if !strings.HasSuffix(strings.ToLower(claim.EvidenceFilePath), ".png") {
		t.Fatalf("expected png file path, got %q", claim.EvidenceFilePath)
	}
	if _, err := os.Stat(filepath.Clean(claim.EvidenceFilePath)); err != nil {
		t.Fatalf("expected image evidence file on disk: %v", err)
	}
}

func TestResolveClaim_AppendsResolvedEvent(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	deliverShipment(t, ts, ship.TrackingID)
	fakeEmail := &fakeClaimEmailSender{resolvedCalls: make(chan claimResolvedEmailCall, 1)}
	claimSvc.SetClaimEmailService(fakeEmail)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}

	resolutionNotes := "Reclamo revisado y rechazado por falta de evidencia"
	_, err = claimSvc.Resolve(claim.ID, model.ClaimResolutionImprocedente, "sup_caba", "", resolutionNotes)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	select {
	case got := <-fakeEmail.resolvedCalls:
		if got.claim.ID != claim.ID {
			t.Fatalf("expected claim %s, got %s", claim.ID, got.claim.ID)
		}
		if got.claim.Status != model.ClaimStatusResolvedImprocedente {
			t.Fatalf("expected resolved_improcedente, got %s", got.claim.Status)
		}
		if got.notes != resolutionNotes {
			t.Fatalf("expected notes %q, got %q", resolutionNotes, got.notes)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected resolved email to be sent")
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

func TestRequestCustomerInfo_SendsInfoRequestedEmail(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)
	fakeEmail := &fakeClaimEmailSender{infoRequestedCalls: make(chan claimInfoRequestedCall, 1)}
	claimSvc.SetClaimEmailService(fakeEmail)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}
	if claim.ClaimantDNI != "12345678" {
		t.Fatalf("expected claimant DNI persisted, got %q", claim.ClaimantDNI)
	}

	notes := "Necesitamos fotos del paquete y del embalaje para continuar"
	updated, err := claimSvc.RequestCustomerInfo(claim.ID, "sup_caba", "", notes)
	if err != nil {
		t.Fatalf("request customer info: %v", err)
	}
	if updated.Status != model.ClaimStatusPendingCustomer {
		t.Fatalf("expected pending_customer, got %s", updated.Status)
	}

	select {
	case got := <-fakeEmail.infoRequestedCalls:
		if got.claim.ID != claim.ID {
			t.Fatalf("expected claim %s, got %s", claim.ID, got.claim.ID)
		}
		if got.notes != notes {
			t.Fatalf("expected notes %q, got %q", notes, got.notes)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected info-requested email to be sent")
	}
}

func TestMarkInReview_TransitionsFromPendingCustomer(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	deliverShipment(t, ts, ship.TrackingID)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
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
