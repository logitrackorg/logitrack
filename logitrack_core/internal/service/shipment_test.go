package service

import (
	"strings"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// ─── test helpers ────────────────────────────────────────────────────────────

func strPtr(s string) *string  { return &s }
func floatPtr(f float64) *float64 { return &f }

func testBranchRepo() repository.BranchRepository {
	r := repository.NewInMemoryBranchRepository()
	r.Add(model.Branch{ID: "br-caba", Name: "CDBA-01", Address: model.Address{City: "Buenos Aires", Province: "CABA"}, Province: "CABA", Status: model.BranchStatusActive})
	r.Add(model.Branch{ID: "br-cordoba", Name: "CORD-01", Address: model.Address{City: "Córdoba", Province: "Córdoba"}, Province: "Córdoba", Status: model.BranchStatusActive})
	r.Add(model.Branch{ID: "br-mendoza", Name: "MEND-01", Address: model.Address{City: "Mendoza", Province: "Mendoza"}, Province: "Mendoza", Status: model.BranchStatusActive})
	return r
}

type testSetup struct {
	svc          *ShipmentService
	commentSvc   *CommentService
	incidentSvc  *IncidentService
	shipmentRepo repository.ShipmentRepository
	commentRepo  repository.CommentRepository
	incidentRepo repository.IncidentRepository
}

func newSetup() testSetup {
	shipmentRepo, eventStore, proj := repository.NewInMemoryShipmentRepositoryWithDeps()
	branchRepo := testBranchRepo()
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	incidentRepo := repository.NewInMemoryIncidentRepository()
	commentSvc := NewCommentService(commentRepo, shipmentRepo)
	incidentSvc := NewIncidentService(incidentRepo, shipmentRepo, eventStore, proj)
	svc := NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, nil)
	return testSetup{svc, commentSvc, incidentSvc, shipmentRepo, commentRepo, incidentRepo}
}

func defaultSender() model.Customer {
	return model.Customer{
		DNI: "12345678", Name: "Alice Sender", Phone: "1100000000",
		Address: model.Address{City: "Buenos Aires", Province: "CABA"},
	}
}

func defaultRecipient() model.Customer {
	return model.Customer{
		DNI: "87654321", Name: "Bob Recipient", Phone: "2200000000",
		Address: model.Address{City: "Córdoba", Province: "Córdoba"},
	}
}

func defaultCreateReq() model.CreateShipmentRequest {
	return model.CreateShipmentRequest{
		Sender:            defaultSender(),
		Recipient:         defaultRecipient(),
		WeightKg:          3.0,
		PackageType:       model.PackageBox,
		ReceivingBranchID: "br-caba",
		CreatedBy:         "operator",
	}
}

func mustCreate(t *testing.T, ts testSetup) model.Shipment {
	t.Helper()
	ship, err := ts.svc.Create(defaultCreateReq())
	if err != nil {
		t.Fatalf("mustCreate: %v", err)
	}
	return ship
}

func mustStatus(t *testing.T, ts testSetup, id string, req model.UpdateStatusRequest) model.Shipment {
	t.Helper()
	ship, err := ts.svc.UpdateStatus(id, req)
	if err != nil {
		t.Fatalf("mustStatus → %s: %v", req.Status, err)
	}
	return ship
}

// advance at_origin_hub → loaded → in_transit (to Córdoba / br-cordoba)
func toInTransit(t *testing.T, ts testSetup, id string) model.Shipment {
	t.Helper()
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusLoaded, ChangedBy: "supervisor",
	})
	return mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusInTransit, Location: "Córdoba", ChangedBy: "supervisor",
	})
}

// advance in_transit → at_hub (location auto-derived from prior in_transit event)
func toAtHub(t *testing.T, ts testSetup, id string) model.Shipment {
	t.Helper()
	return mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusAtHub, ChangedBy: "supervisor",
	})
}

// advance at_hub → out_for_delivery
func toOutForDelivery(t *testing.T, ts testSetup, id string) model.Shipment {
	t.Helper()
	return mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusOutForDelivery, DriverID: "driver-01", ChangedBy: "supervisor",
	})
}

// ─── state machine ───────────────────────────────────────────────────────────

func TestIsValidTransition(t *testing.T) {
	tests := []struct {
		from model.Status
		to   model.Status
		want bool
	}{
		// valid transitions — at_origin_hub
		{model.StatusAtOriginHub, model.StatusLoaded, true},
		{model.StatusAtOriginHub, model.StatusReadyForReturn, true},
		{model.StatusAtOriginHub, model.StatusLost, true},
		{model.StatusAtOriginHub, model.StatusDestroyed, true},

		// valid transitions — loaded
		{model.StatusLoaded, model.StatusInTransit, true},
		{model.StatusLoaded, model.StatusAtOriginHub, true},
		{model.StatusLoaded, model.StatusAtHub, true},

		// valid transitions — in_transit
		{model.StatusInTransit, model.StatusAtHub, true},
		{model.StatusInTransit, model.StatusAtOriginHub, true},
		{model.StatusInTransit, model.StatusLost, true},
		{model.StatusInTransit, model.StatusDestroyed, true},

		// valid transitions — at_hub
		{model.StatusAtHub, model.StatusLoaded, true},
		{model.StatusAtHub, model.StatusOutForDelivery, true},
		{model.StatusAtHub, model.StatusReadyForPickup, true},
		{model.StatusAtHub, model.StatusLost, true},
		{model.StatusAtHub, model.StatusDestroyed, true},
		{model.StatusAtHub, model.StatusReadyForReturn, false},

		// valid transitions — out_for_delivery
		{model.StatusOutForDelivery, model.StatusDelivered, true},
		{model.StatusOutForDelivery, model.StatusDeliveryFailed, true},
		{model.StatusOutForDelivery, model.StatusLost, true},
		{model.StatusOutForDelivery, model.StatusDestroyed, true},

		// valid transitions — delivery_failed
		{model.StatusDeliveryFailed, model.StatusRedeliveryScheduled, true},
		{model.StatusDeliveryFailed, model.StatusReadyForPickup, true},
		{model.StatusDeliveryFailed, model.StatusRechazado, true},

		// valid transitions — redelivery_scheduled
		{model.StatusRedeliveryScheduled, model.StatusOutForDelivery, true},

		// valid transitions — ready_for_pickup
		{model.StatusReadyForPickup, model.StatusDelivered, true},
		{model.StatusReadyForPickup, model.StatusNoEntregado, true},

		// valid transitions — no_entregado / rechazado
		{model.StatusNoEntregado, model.StatusAtHub, true},
		{model.StatusNoEntregado, model.StatusAtOriginHub, false},
		{model.StatusRechazado, model.StatusAtHub, true},
		{model.StatusRechazado, model.StatusAtOriginHub, false},

		// valid transitions — ready_for_return
		{model.StatusReadyForReturn, model.StatusReturned, true},

		// invalid: draft can only be confirmed, not updated via UpdateStatus
		{model.StatusDraft, model.StatusAtOriginHub, false},
		{model.StatusDraft, model.StatusInTransit, false},

		// invalid: cannot skip steps
		{model.StatusAtOriginHub, model.StatusInTransit, false},
		{model.StatusAtOriginHub, model.StatusDelivered, false},
		{model.StatusAtOriginHub, model.StatusAtHub, false},
		{model.StatusAtHub, model.StatusInTransit, false},
		{model.StatusReadyForPickup, model.StatusInTransit, false},
		{model.StatusInTransit, model.StatusDelivered, false},
		{model.StatusInTransit, model.StatusOutForDelivery, false},
		{model.StatusAtHub, model.StatusDelivered, false},
		{model.StatusAtHub, model.StatusReturned, false},
		{model.StatusOutForDelivery, model.StatusAtHub, false},
		{model.StatusOutForDelivery, model.StatusInTransit, false},

		// invalid: terminal states have no outgoing transitions
		{model.StatusDelivered, model.StatusAtOriginHub, false},
		{model.StatusDelivered, model.StatusInTransit, false},
		{model.StatusReturned, model.StatusAtOriginHub, false},
		{model.StatusCancelled, model.StatusAtOriginHub, false},
		{model.StatusCancelled, model.StatusInTransit, false},
		{model.StatusLost, model.StatusAtOriginHub, false},
		{model.StatusDestroyed, model.StatusAtOriginHub, false},
	}
	for _, tc := range tests {
		got := isValidTransition(tc.from, tc.to)
		if got != tc.want {
			t.Errorf("isValidTransition(%s → %s) = %v, want %v", tc.from, tc.to, got, tc.want)
		}
	}
}

// ─── Create ──────────────────────────────────────────────────────────────────

func TestCreate_Validation(t *testing.T) {
	ts := newSetup()

	tests := []struct {
		name    string
		mutate  func(*model.CreateShipmentRequest)
		wantErr string
	}{
		{
			name:    "missing origin city",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.Address.City = "" },
			wantErr: "la ciudad y provincia de origen son obligatorias",
		},
		{
			name:    "missing origin province",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.Address.Province = "" },
			wantErr: "la ciudad y provincia de origen son obligatorias",
		},
		{
			name:    "missing destination city",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.Address.City = "" },
			wantErr: "la ciudad y provincia de destino son obligatorias",
		},
		{
			name:    "missing destination province",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.Address.Province = "" },
			wantErr: "la ciudad y provincia de destino son obligatorias",
		},
		{
			name:    "sender DNI too short",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.DNI = "123" },
			wantErr: "sender_dni debe tener al menos 7 dígitos",
		},
		{
			name:    "sender DNI with letters",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.DNI = "1234abc" },
			wantErr: "sender_dni debe contener solo dígitos",
		},
		{
			name:    "recipient DNI too short",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.DNI = "99" },
			wantErr: "recipient_dni debe tener al menos 7 dígitos",
		},
		{
			name:    "recipient DNI with letters",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.DNI = "abc1234" },
			wantErr: "recipient_dni debe contener solo dígitos",
		},
		{
			name:    "invalid sender email",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.Email = "notanemail" },
			wantErr: "sender_email no es una dirección de email válida",
		},
		{
			name:    "invalid recipient email",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.Email = "bad@" },
			wantErr: "recipient_email no es una dirección de email válida",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := defaultCreateReq()
			tc.mutate(&req)
			_, err := ts.svc.Create(req)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error = %q, want to contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestCreate_Success(t *testing.T) {
	ts := newSetup()
	ship, err := ts.svc.Create(defaultCreateReq())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ship.Status != model.StatusAtOriginHub {
		t.Errorf("status = %s, want at_origin_hub", ship.Status)
	}
	if !strings.HasPrefix(ship.TrackingID, "LT-") {
		t.Errorf("tracking_id = %q, want LT- prefix", ship.TrackingID)
	}
}

func TestCreate_EmptyEmailsAreOptional(t *testing.T) {
	ts := newSetup()
	req := defaultCreateReq()
	req.Sender.Email = ""
	req.Recipient.Email = ""
	_, err := ts.svc.Create(req)
	if err != nil {
		t.Fatalf("empty emails should be optional, got: %v", err)
	}
}

// ─── SaveDraft ────────────────────────────────────────────────────────────────

func TestSaveDraft_PartialDataIsAllowed(t *testing.T) {
	ts := newSetup()
	req := model.SaveDraftRequest{WeightKg: floatPtr(1.5)}
	ship, err := ts.svc.SaveDraft(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ship.Status != model.StatusDraft {
		t.Errorf("status = %s, want draft", ship.Status)
	}
	if !strings.HasPrefix(ship.TrackingID, "DRAFT-") {
		t.Errorf("tracking_id = %q, want DRAFT- prefix", ship.TrackingID)
	}
}

func TestSaveDraft_ValidatesDNIWhenProvided(t *testing.T) {
	ts := newSetup()
	req := model.SaveDraftRequest{
		Sender: model.Customer{DNI: "abc"},
	}
	_, err := ts.svc.SaveDraft(req)
	if err == nil || !strings.Contains(err.Error(), "sender_dni debe contener solo dígitos") {
		t.Errorf("expected DNI validation error, got: %v", err)
	}
}

func TestSaveDraft_ValidatesEmailWhenProvided(t *testing.T) {
	ts := newSetup()
	req := model.SaveDraftRequest{
		Recipient: model.Customer{Email: "notvalid"},
	}
	_, err := ts.svc.SaveDraft(req)
	if err == nil || !strings.Contains(err.Error(), "recipient_email no es una dirección de email válida") {
		t.Errorf("expected email validation error, got: %v", err)
	}
}

// ─── UpdateDraft ──────────────────────────────────────────────────────────────

func TestUpdateDraft_RejectsNonDraft(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // status: at_origin_hub, not draft
	_, err := ts.svc.UpdateDraft(ship.TrackingID, model.SaveDraftRequest{})
	if err == nil || !strings.Contains(err.Error(), "solo se pueden actualizar envíos en borrador") {
		t.Errorf("expected non-draft error, got: %v", err)
	}
}

func TestUpdateDraft_ValidatesDNIWhenProvided(t *testing.T) {
	ts := newSetup()
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
	// "short" contains only digits but is < 7 chars
	req := model.SaveDraftRequest{Sender: model.Customer{DNI: "123"}}
	_, err := ts.svc.UpdateDraft(draft.TrackingID, req)
	if err == nil || !strings.Contains(err.Error(), "sender_dni debe tener al menos 7 dígitos") {
		t.Errorf("expected DNI error, got: %v", err)
	}
}

// ─── ConfirmDraft ─────────────────────────────────────────────────────────────

func TestConfirmDraft_RejectsNonConfirmable(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.ConfirmDraft(ship.TrackingID, "operator")
	if err == nil || !strings.Contains(err.Error(), "solo se pueden confirmar envíos en borrador") {
		t.Errorf("expected non-draft error, got: %v", err)
	}
}

func TestConfirmDraft_RejectsMissingFields(t *testing.T) {
	ts := newSetup()
	// draft with no data at all
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
	_, err := ts.svc.ConfirmDraft(draft.TrackingID, "operator")
	if err == nil || !strings.Contains(err.Error(), "faltan campos obligatorios") {
		t.Errorf("expected missing fields error, got: %v", err)
	}
}

func TestConfirmDraft_RejectsShortDNI(t *testing.T) {
	ts := newSetup()
	// SaveDraft accepts short DNIs silently (no required fields in draft mode).
	// ConfirmDraft re-validates after all required fields are confirmed present.
	draft, err := ts.svc.SaveDraft(model.SaveDraftRequest{
		Sender: model.Customer{
			DNI: "123", Name: "Alice", Phone: "11111111",
			Address: model.Address{City: "Buenos Aires", Province: "CABA"},
		},
		Recipient: model.Customer{
			DNI: "87654321", Name: "Bob", Phone: "22222222",
			Address: model.Address{City: "Córdoba", Province: "Córdoba"},
		},
		WeightKg: floatPtr(2.0), PackageType: model.PackageBox,
	})
	// SaveDraft catches the short DNI first
	if err == nil {
		// If somehow it slipped through, ConfirmDraft must catch it
		_, err = ts.svc.ConfirmDraft(draft.TrackingID, "operator")
	}
	if err == nil || !strings.Contains(err.Error(), "sender_dni debe tener al menos 7 dígitos") {
		t.Errorf("expected short-DNI error at save or confirm, got: %v", err)
	}
}

func TestConfirmDraft_Success(t *testing.T) {
	ts := newSetup()
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{
		Sender:    defaultSender(),
		Recipient: defaultRecipient(),
		WeightKg:  floatPtr(2.0), PackageType: model.PackageBox,
	})
	confirmed, err := ts.svc.ConfirmDraft(draft.TrackingID, "operator")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if confirmed.Status != model.StatusAtOriginHub {
		t.Errorf("status = %s, want at_origin_hub", confirmed.Status)
	}
	if !strings.HasPrefix(confirmed.TrackingID, "LT-") {
		t.Errorf("tracking_id = %q, want LT- prefix", confirmed.TrackingID)
	}
	if confirmed.TrackingID == draft.TrackingID {
		t.Error("confirmed tracking ID must differ from draft ID")
	}
}

// ─── UpdateStatus – pre-condition guards ─────────────────────────────────────

func TestUpdateStatus_DeliveryFailed_RequiresNotes(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID)
	toOutForDelivery(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDeliveryFailed, ChangedBy: "driver",
		// Notes intentionally empty
	})
	if err == nil || !strings.Contains(err.Error(), "las notas son obligatorias para fallo de entrega") {
		t.Errorf("expected notes-required error, got: %v", err)
	}
}

func TestUpdateStatus_OutForDelivery_RequiresDriverID(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusOutForDelivery, ChangedBy: "supervisor",
		// DriverID intentionally empty
	})
	if err == nil || !strings.Contains(err.Error(), "el driver_id es obligatorio al pasar a estado de reparto") {
		t.Errorf("expected driver_id-required error, got: %v", err)
	}
}

func TestUpdateStatus_InvalidTransition(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // at_origin_hub
	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "transición inválida") {
		t.Errorf("expected invalid transition error, got: %v", err)
	}
}

func TestUpdateStatus_InTransit_SameDestinationRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // CurrentLocation = br-caba
	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusLoaded, ChangedBy: "supervisor",
	})
	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status:    model.StatusInTransit,
		Location:  "Buenos Aires", // resolves to br-caba — same as current
		ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "la sucursal de destino debe ser diferente a la sucursal actual") {
		t.Errorf("expected same-destination error, got: %v", err)
	}
}

func TestUpdateStatus_InTransit_DifferentDestinationAllowed(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusLoaded, ChangedBy: "supervisor",
	})
	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status:    model.StatusInTransit,
		Location:  "Córdoba", // resolves to br-cordoba ≠ br-caba
		ChangedBy: "supervisor",
	})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

// ─── UpdateStatus – delivered DNI validation ─────────────────────────────────

func TestUpdateStatus_Delivered_RequiresRecipientDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID)
	toOutForDelivery(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
	})
	if err == nil || !strings.Contains(err.Error(), "el DNI del destinatario es obligatorio para la entrega") {
		t.Errorf("expected recipient_dni required error, got: %v", err)
	}
}

func TestUpdateStatus_Delivered_WrongDNIRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID)
	toOutForDelivery(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver", RecipientDNI: "00000000",
	})
	if err == nil || !strings.Contains(err.Error(), "el DNI no coincide") {
		t.Errorf("expected DNI mismatch error, got: %v", err)
	}
}

func TestUpdateStatus_Delivered_CorrectDNISucceeds(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID)
	toOutForDelivery(t, ts, ship.TrackingID)

	result, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
		RecipientDNI: defaultRecipient().DNI,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != model.StatusDelivered {
		t.Errorf("status = %s, want delivered", result.Status)
	}
	if result.DeliveredAt == nil {
		t.Error("DeliveredAt should be set after delivery")
	}
}

func TestUpdateStatus_Delivered_UsesCorrectedRecipientDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID)

	// Apply a correction to recipient DNI before delivering
	correctedDNI := "11111111"
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{RecipientDNI: strPtr(correctedDNI)},
	})
	if err != nil {
		t.Fatalf("correction failed: %v", err)
	}

	toOutForDelivery(t, ts, ship.TrackingID)

	// Original DNI should be rejected
	_, err = ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
		RecipientDNI: defaultRecipient().DNI,
	})
	if err == nil {
		t.Error("expected original DNI to be rejected after correction")
	}

	// Corrected DNI should be accepted
	_, err = ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
		RecipientDNI: correctedDNI,
	})
	if err != nil {
		t.Errorf("corrected DNI should be accepted, got: %v", err)
	}
}

// ─── UpdateStatus – returned DNI validation ───────────────────────────────────

func TestUpdateStatus_Returned_RequiresSenderDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	// advance to ready_for_return (must be at origin branch)
	advanceToReadyForReturn(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusReturned, ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "el DNI del remitente es obligatorio para la devolución") {
		t.Errorf("expected sender_dni required error, got: %v", err)
	}
}

func TestUpdateStatus_Returned_WrongSenderDNIRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	advanceToReadyForReturn(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusReturned, ChangedBy: "supervisor", SenderDNI: "00000000",
	})
	if err == nil || !strings.Contains(err.Error(), "el DNI no coincide") {
		t.Errorf("expected DNI mismatch error, got: %v", err)
	}
}

func TestUpdateStatus_Returned_CorrectSenderDNISucceeds(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	advanceToReadyForReturn(t, ts, ship.TrackingID)

	result, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusReturned, ChangedBy: "supervisor",
		SenderDNI: defaultSender().DNI,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != model.StatusReturned {
		t.Errorf("status = %s, want returned", result.Status)
	}
}

// ─── UpdateStatus – ready_for_return location guard ──────────────────────────

func TestUpdateStatus_ReadyForReturn_NotAtOriginRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID) // at br-cordoba — at_hub → ready_for_return is invalid

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusReadyForReturn, ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "transición inválida") {
		t.Errorf("expected invalid transition error, got: %v", err)
	}
}

func TestUpdateStatus_ReadyForReturn_AtOriginSucceeds(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // ReceivingBranchID = br-caba, CurrentLocation = br-caba
	advanceToReadyForReturn(t, ts, ship.TrackingID)

	updated, err := ts.svc.GetByTrackingID(ship.TrackingID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if updated.Status != model.StatusReadyForReturn {
		t.Errorf("status = %s, want ready_for_return", updated.Status)
	}
}

// ─── UpdateStatus – auto-derive location ─────────────────────────────────────

func TestUpdateStatus_AtHub_AutoDerivesLocationFromInTransitEvent(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // CurrentLocation = br-caba

	toInTransit(t, ts, ship.TrackingID) // goes to br-cordoba

	result := toAtHub(t, ts, ship.TrackingID)
	// CurrentLocation must now be the destination set in the in_transit event (br-cordoba)
	if result.CurrentLocation != "br-cordoba" {
		t.Errorf("CurrentLocation = %q, want %q", result.CurrentLocation, "br-cordoba")
	}
}

func TestUpdateStatus_AtHub_FromDeliveryFailed_AutoDerivesFromLastAtHub(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtHub(t, ts, ship.TrackingID) // at br-cordoba
	toOutForDelivery(t, ts, ship.TrackingID)

	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDeliveryFailed, ChangedBy: "driver", Notes: "nobody home",
	})

	// rechazado auto-transitions to at_hub — verify the auto-derived location
	result := mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusRechazado, ChangedBy: "supervisor",
	})
	if result.Status != model.StatusAtHub {
		t.Errorf("Status = %q, want at_hub after rechazado auto-transition", result.Status)
	}
	if result.CurrentLocation != "br-cordoba" {
		t.Errorf("CurrentLocation = %q, want %q after rechazado auto-transition", result.CurrentLocation, "br-cordoba")
	}
}

// ─── CancelShipment ───────────────────────────────────────────────────────────

func TestCancelShipment_RequiresReason(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CancelShipment(ship.TrackingID, "supervisor", "")
	if err == nil || !strings.Contains(err.Error(), "el motivo de cancelación es obligatorio") {
		t.Errorf("expected reason-required error, got: %v", err)
	}
}

func TestCancelShipment_NonCancellableStates(t *testing.T) {
	tests := []struct {
		name  string
		setup func(ts testSetup) string
	}{
		{
			name: "draft",
			setup: func(ts testSetup) string {
				d, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
				return d.TrackingID
			},
		},
		{
			name: "delivered",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				toOutForDelivery(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDelivered, ChangedBy: "driver",
					RecipientDNI: defaultRecipient().DNI,
				})
				return ship.TrackingID
			},
		},
		{
			name: "returned",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				advanceToReadyForReturn(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusReturned, ChangedBy: "supervisor",
					SenderDNI: defaultSender().DNI,
				})
				return ship.TrackingID
			},
		},
		{
			name: "in_transit",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				return ship.TrackingID
			},
		},
		{
			name: "loaded",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusLoaded, ChangedBy: "supervisor",
				})
				return ship.TrackingID
			},
		},
		{
			name: "out_for_delivery",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				toOutForDelivery(t, ts, ship.TrackingID)
				return ship.TrackingID
			},
		},
		{
			name: "delivery_failed",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				toOutForDelivery(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDeliveryFailed, ChangedBy: "driver", Notes: "nobody home",
				})
				return ship.TrackingID
			},
		},
		{
			name: "already cancelled",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				ts.svc.CancelShipment(ship.TrackingID, "supervisor", "test")
				return ship.TrackingID
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ts := newSetup()
			id := tc.setup(ts)
			_, err := ts.svc.CancelShipment(id, "supervisor", "some reason")
			if err == nil || !strings.Contains(err.Error(), "no se puede cancelar") {
				t.Errorf("expected cannot-cancel error for %s, got: %v", tc.name, err)
			}
		})
	}
}

func TestCancelShipment_CancellableStates(t *testing.T) {
	tests := []struct {
		name  string
		setup func(ts testSetup) string
	}{
		{
			name: "at_origin_hub",
			setup: func(ts testSetup) string {
				return mustCreate(t, ts).TrackingID
			},
		},
		{
			name: "at_hub",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				return ship.TrackingID
			},
		},
		{
			name: "ready_for_pickup",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusReadyForPickup, ChangedBy: "supervisor",
				})
				return ship.TrackingID
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ts := newSetup()
			id := tc.setup(ts)
			result, err := ts.svc.CancelShipment(id, "supervisor", "cancelled by test")
			if err != nil {
				t.Fatalf("cancel failed for %s: %v", tc.name, err)
			}
			if result.Status != model.StatusCancelled {
				t.Errorf("status = %s, want cancelled", result.Status)
			}
		})
	}
}

func TestCancelShipment_AddsComment(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	reason := "damaged in warehouse"
	_, err := ts.svc.CancelShipment(ship.TrackingID, "supervisor", reason)
	if err != nil {
		t.Fatalf("cancel failed: %v", err)
	}

	comments, err := ts.commentSvc.GetComments(ship.TrackingID)
	if err != nil {
		t.Fatalf("get comments failed: %v", err)
	}
	if len(comments) == 0 {
		t.Fatal("expected cancellation comment, got none")
	}
	found := false
	for _, c := range comments {
		if strings.Contains(c.Body, reason) {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("cancellation comment with reason %q not found in %v", reason, comments)
	}
}

// ─── CorrectShipment ──────────────────────────────────────────────────────────

func TestCorrectShipment_EmptyCorrections(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{}, // all nil
	})
	if err == nil || !strings.Contains(err.Error(), "no se proporcionaron correcciones") {
		t.Errorf("expected no-corrections error, got: %v", err)
	}
}

func TestCorrectShipment_InvalidSenderDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{SenderDNI: strPtr("abc")},
	})
	if err == nil || !strings.Contains(err.Error(), "sender_dni debe contener solo dígitos") {
		t.Errorf("expected DNI validation error, got: %v", err)
	}
}

func TestCorrectShipment_InvalidRecipientDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{RecipientDNI: strPtr("1234")}, // too short
	})
	if err == nil || !strings.Contains(err.Error(), "recipient_dni debe tener al menos 7 dígitos") {
		t.Errorf("expected short-DNI error, got: %v", err)
	}
}

func TestCorrectShipment_InvalidEmail(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{SenderEmail: strPtr("bad-email")},
	})
	if err == nil || !strings.Contains(err.Error(), "sender_email no es una dirección de email válida") {
		t.Errorf("expected email error, got: %v", err)
	}
}

func TestCorrectShipment_BlockedStates(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(ts testSetup) string
		wantErr string
	}{
		{
			name: "draft",
			setup: func(ts testSetup) string {
				d, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
				return d.TrackingID
			},
			wantErr: "los borradores deben editarse directamente",
		},
		{
			name: "delivered",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				toOutForDelivery(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDelivered, ChangedBy: "driver",
					RecipientDNI: defaultRecipient().DNI,
				})
				return ship.TrackingID
			},
			wantErr: "no se pueden corregir envíos finalizados",
		},
		{
			name: "returned",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				advanceToReadyForReturn(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusReturned, ChangedBy: "supervisor",
					SenderDNI: defaultSender().DNI,
				})
				return ship.TrackingID
			},
			wantErr: "no se pueden corregir envíos finalizados",
		},
		{
			name: "cancelled",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				ts.svc.CancelShipment(ship.TrackingID, "supervisor", "test")
				return ship.TrackingID
			},
			wantErr: "no se pueden corregir envíos finalizados",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ts := newSetup()
			id := tc.setup(ts)
			_, err := ts.svc.CorrectShipment(id, "supervisor", model.CorrectShipmentRequest{
				Corrections: model.ShipmentCorrections{SenderName: strPtr("New Name")},
			})
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("expected %q error, got: %v", tc.wantErr, err)
			}
		})
	}
}

func TestCorrectShipment_Success(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	newName := "Alice Corrected"
	result, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{SenderName: strPtr(newName)},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Original data unchanged
	if result.Sender.Name != ship.Sender.Name {
		t.Errorf("original sender name modified: got %q, want %q", result.Sender.Name, ship.Sender.Name)
	}
	// Correction stored
	if result.Corrections == nil || result.Corrections.SenderName == nil {
		t.Fatal("correction not stored")
	}
	if *result.Corrections.SenderName != newName {
		t.Errorf("corrected name = %q, want %q", *result.Corrections.SenderName, newName)
	}
}

func TestCorrectShipment_GeneratesOneCommentPerField(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{
			SenderName:    strPtr("Alice New"),
			RecipientName: strPtr("Bob New"),
		},
	})
	if err != nil {
		t.Fatalf("correction failed: %v", err)
	}

	comments, _ := ts.commentSvc.GetComments(ship.TrackingID)
	if len(comments) != 2 {
		t.Errorf("expected 2 auto-comments, got %d", len(comments))
	}
}

func TestCorrectShipment_CorrectionsAccumulate(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	// first correction: sender name
	ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{SenderName: strPtr("First")},
	})
	// second correction: recipient name (sender name should be preserved)
	result, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{RecipientName: strPtr("Second")},
	})
	if err != nil {
		t.Fatalf("second correction failed: %v", err)
	}
	if result.Corrections == nil {
		t.Fatal("corrections is nil")
	}
	if result.Corrections.SenderName == nil || *result.Corrections.SenderName != "First" {
		t.Error("first correction should be preserved after second correction")
	}
	if result.Corrections.RecipientName == nil || *result.Corrections.RecipientName != "Second" {
		t.Error("second correction not stored")
	}
}

// ─── internal helpers for multi-step scenarios ────────────────────────────────

// advanceToReadyForReturn moves the shipment to ready_for_return by routing it
// out and back to the origin branch (br-caba), which is the ReceivingBranchID.
func advanceToReadyForReturn(t *testing.T, ts testSetup, id string) {
	t.Helper()
	// at_origin_hub → loaded → in_transit (to Córdoba)
	toInTransit(t, ts, id)
	// in_transit → at_hub (at br-cordoba)
	toAtHub(t, ts, id)
	// at_hub → loaded → in_transit (back to Buenos Aires / br-caba)
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusLoaded, ChangedBy: "supervisor",
	})
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusInTransit, Location: "Buenos Aires", ChangedBy: "supervisor",
	})
	// in_transit → at_hub (auto-derives to br-caba) → auto-promotes to at_origin_hub since at origin
	toAtHub(t, ts, id)
	// at_origin_hub → ready_for_return (manual, since IsReturning=false here)
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusReadyForReturn, ChangedBy: "supervisor",
	})
}

// seedShipmentAt inserts a shipment directly via the repo with a specific CreatedAt,
// allowing date-filter tests to exercise the full range without sleeping.
func seedShipmentAt(t *testing.T, ts testSetup, createdAt time.Time) model.Shipment {
	t.Helper()
	s := model.Shipment{
		TrackingID:          generateTrackingID(),
		Sender:              defaultSender(),
		Recipient:           defaultRecipient(),
		WeightKg:            1.0,
		PackageType:         model.PackageBox,
		Status:              model.StatusAtOriginHub,
		CurrentLocation:     "br-caba",
		CreatedAt:           createdAt,
		UpdatedAt:           createdAt,
		EstimatedDeliveryAt: createdAt.AddDate(0, 0, 7),
	}
	created, err := ts.shipmentRepo.Create(repository.CreateShipmentCmd{
		Shipment:  s,
		ChangedBy: "operator",
		Notes:     "seeded for date-filter test",
	})
	if err != nil {
		t.Fatalf("seedShipmentAt: %v", err)
	}
	return created
}

// ─── Search – by tracking ID (TC-09–TC-12) ───────────────────────────────────

func TestSearch_ByTrackingID_ExactMatch(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	results, err := ts.svc.Search(ship.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 || results[0].TrackingID != ship.TrackingID {
		t.Errorf("expected exactly shipment %q, got %v", ship.TrackingID, results)
	}
}

func TestSearch_ByTrackingID_PartialMatch(t *testing.T) {
	ts := newSetup()
	mustCreate(t, ts) // creates an LT-XXXXXXXX shipment

	results, err := ts.svc.Search("LT-")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) == 0 {
		t.Error("expected at least one result for partial tracking ID 'LT-', got none")
	}
	for _, r := range results {
		if !strings.HasPrefix(r.TrackingID, "LT-") {
			t.Errorf("unexpected non-LT result: %q", r.TrackingID)
		}
	}
}

func TestSearch_ByTrackingID_NoMatch(t *testing.T) {
	ts := newSetup()
	mustCreate(t, ts)

	results, err := ts.svc.Search("LT-NOTEXIST")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results for non-existent tracking ID, got %d", len(results))
	}
}

func TestSearch_ByTrackingID_CaseInsensitive(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	lower := strings.ToLower(ship.TrackingID)
	results, err := ts.svc.Search(lower)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, r := range results {
		if r.TrackingID == ship.TrackingID {
			found = true
		}
	}
	if !found {
		t.Errorf("search with lowercase ID %q did not return shipment %q", lower, ship.TrackingID)
	}
}

// ─── Search – by recipient name (TC-13–TC-16) ────────────────────────────────

func TestSearch_ByRecipientName_ExactMatch(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // recipient: "Bob Recipient"

	results, err := ts.svc.Search(defaultRecipient().Name)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, r := range results {
		if r.TrackingID == ship.TrackingID {
			found = true
		}
	}
	if !found {
		t.Errorf("shipment %q not found in results for exact recipient name search", ship.TrackingID)
	}
}

func TestSearch_ByRecipientName_PartialMatch(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // recipient: "Bob Recipient"

	results, err := ts.svc.Search("Bob")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, r := range results {
		if r.TrackingID == ship.TrackingID {
			found = true
		}
	}
	if !found {
		t.Errorf("shipment %q not found in results for partial recipient name 'Bob'", ship.TrackingID)
	}
}

func TestSearch_ByRecipientName_NoMatch(t *testing.T) {
	ts := newSetup()
	mustCreate(t, ts)

	results, err := ts.svc.Search("ZZZ-NoSuchPerson")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results for unknown recipient, got %d", len(results))
	}
}

func TestSearch_ByRecipientName_CaseInsensitive(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // recipient: "Bob Recipient"

	results, err := ts.svc.Search("bob recipient")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, r := range results {
		if r.TrackingID == ship.TrackingID {
			found = true
		}
	}
	if !found {
		t.Errorf("case-insensitive search 'bob recipient' did not find shipment %q", ship.TrackingID)
	}
}

// ─── GetByTrackingID – detail (TC-17–TC-20) ──────────────────────────────────

func TestGetByTrackingID_ReturnsCompleteShipment(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	result, err := ts.svc.GetByTrackingID(ship.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.TrackingID != ship.TrackingID {
		t.Errorf("tracking_id = %q, want %q", result.TrackingID, ship.TrackingID)
	}
	if result.Sender.Name != ship.Sender.Name {
		t.Errorf("sender name = %q, want %q", result.Sender.Name, ship.Sender.Name)
	}
	if result.Recipient.DNI != ship.Recipient.DNI {
		t.Errorf("recipient DNI = %q, want %q", result.Recipient.DNI, ship.Recipient.DNI)
	}
	if result.Status != model.StatusAtOriginHub {
		t.Errorf("status = %q, want at_origin_hub", result.Status)
	}
}

func TestGetByTrackingID_NotFound(t *testing.T) {
	ts := newSetup()

	_, err := ts.svc.GetByTrackingID("LT-NOTEXIST")
	if err == nil {
		t.Error("expected error for non-existent tracking ID, got nil")
	}
}

func TestGetByTrackingID_ReflectsCurrentStatus(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // at_origin_hub

	toInTransit(t, ts, ship.TrackingID)

	result, err := ts.svc.GetByTrackingID(ship.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != model.StatusInTransit {
		t.Errorf("status = %q after update, want in_transit", result.Status)
	}
}

func TestGetByTrackingID_Draft(t *testing.T) {
	ts := newSetup()
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{WeightKg: floatPtr(2.0)})

	result, err := ts.svc.GetByTrackingID(draft.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != model.StatusDraft {
		t.Errorf("status = %q, want draft", result.Status)
	}
	if !strings.HasPrefix(result.TrackingID, "DRAFT-") {
		t.Errorf("tracking_id = %q, want DRAFT- prefix", result.TrackingID)
	}
}

// ─── List – date filtering (TC-21–TC-24) ─────────────────────────────────────

func TestList_NoFilter_ReturnsAll(t *testing.T) {
	ts := newSetup()
	mustCreate(t, ts)
	mustCreate(t, ts)
	mustCreate(t, ts)

	results, err := ts.svc.List(model.ShipmentFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) < 3 {
		t.Errorf("expected at least 3 results, got %d", len(results))
	}
}

func TestList_FilterByDateFrom(t *testing.T) {
	ts := newSetup()
	yesterday := time.Now().UTC().AddDate(0, 0, -1)
	tomorrow := time.Now().UTC().AddDate(0, 0, 1)

	seedShipmentAt(t, ts, yesterday) // should be excluded
	seedShipmentAt(t, ts, tomorrow)  // should be included

	from := time.Now().UTC()
	results, err := ts.svc.List(model.ShipmentFilter{DateFrom: &from})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, r := range results {
		if r.CreatedAt.Before(from) {
			t.Errorf("shipment %q (created %v) is before DateFrom %v", r.TrackingID, r.CreatedAt, from)
		}
	}
}

func TestList_FilterByDateTo(t *testing.T) {
	ts := newSetup()
	yesterday := time.Now().UTC().AddDate(0, 0, -1)
	tomorrow := time.Now().UTC().AddDate(0, 0, 1)

	seedShipmentAt(t, ts, yesterday) // should be included
	seedShipmentAt(t, ts, tomorrow)  // should be excluded

	to := time.Now().UTC()
	results, err := ts.svc.List(model.ShipmentFilter{DateTo: &to})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, r := range results {
		if r.CreatedAt.After(to) {
			t.Errorf("shipment %q (created %v) is after DateTo %v", r.TrackingID, r.CreatedAt, to)
		}
	}
}

func TestList_FilterByDateRange(t *testing.T) {
	ts := newSetup()
	twoDaysAgo := time.Now().UTC().AddDate(0, 0, -2)
	yesterday := time.Now().UTC().AddDate(0, 0, -1)
	tomorrow := time.Now().UTC().AddDate(0, 0, 1)

	old := seedShipmentAt(t, ts, twoDaysAgo)
	inRange := seedShipmentAt(t, ts, yesterday)
	future := seedShipmentAt(t, ts, tomorrow)

	from := twoDaysAgo.Add(time.Hour) // strictly after twoDaysAgo
	to := time.Now().UTC()            // before tomorrow

	results, err := ts.svc.List(model.ShipmentFilter{DateFrom: &from, DateTo: &to})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ids := make(map[string]bool)
	for _, r := range results {
		ids[r.TrackingID] = true
	}
	if !ids[inRange.TrackingID] {
		t.Errorf("in-range shipment %q should be included", inRange.TrackingID)
	}
	if ids[old.TrackingID] {
		t.Errorf("old shipment %q should be excluded", old.TrackingID)
	}
	if ids[future.TrackingID] {
		t.Errorf("future shipment %q should be excluded", future.TrackingID)
	}
}

// ─── List – status coverage (TC-25–TC-28) ────────────────────────────────────
// Status filtering is client-side; the backend exposes all statuses so the
// frontend can apply whichever filter it needs. These tests verify that List
// never silently drops shipments of any particular status.

func TestList_IncludesShipmentsOfEveryStatus(t *testing.T) {
	ts := newSetup()

	mustCreate(t, ts) // at_origin_hub

	s2 := mustCreate(t, ts)
	toInTransit(t, ts, s2.TrackingID) // in_transit

	s3 := mustCreate(t, ts)
	toInTransit(t, ts, s3.TrackingID)
	toAtHub(t, ts, s3.TrackingID) // at_hub

	s4 := mustCreate(t, ts)
	toInTransit(t, ts, s4.TrackingID)
	toAtHub(t, ts, s4.TrackingID)
	toOutForDelivery(t, ts, s4.TrackingID)
	mustStatus(t, ts, s4.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
		RecipientDNI: defaultRecipient().DNI,
	}) // delivered

	ts.svc.SaveDraft(model.SaveDraftRequest{}) // draft

	all, err := ts.svc.List(model.ShipmentFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	statusSet := make(map[model.Status]bool)
	for _, s := range all {
		statusSet[s.Status] = true
	}
	for _, want := range []model.Status{
		model.StatusAtOriginHub, model.StatusInTransit,
		model.StatusAtHub, model.StatusDelivered, model.StatusDraft,
	} {
		if !statusSet[want] {
			t.Errorf("List is missing status %q — at least one shipment should have it", want)
		}
	}
}

func TestList_ReturnedShipmentIncluded(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	advanceToReadyForReturn(t, ts, ship.TrackingID)
	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusReturned, ChangedBy: "supervisor",
		SenderDNI: defaultSender().DNI,
	})

	all, err := ts.svc.List(model.ShipmentFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, s := range all {
		if s.TrackingID == ship.TrackingID {
			found = true
			if s.Status != model.StatusReturned {
				t.Errorf("status = %q, want returned", s.Status)
			}
		}
	}
	if !found {
		t.Error("returned shipment not found in List result")
	}
}

func TestList_CancelledShipmentIncluded(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	ts.svc.CancelShipment(ship.TrackingID, "supervisor", "test cancellation") //nolint

	all, err := ts.svc.List(model.ShipmentFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	found := false
	for _, s := range all {
		if s.TrackingID == ship.TrackingID {
			found = true
			if s.Status != model.StatusCancelled {
				t.Errorf("status = %q, want cancelled", s.Status)
			}
		}
	}
	if !found {
		t.Error("cancelled shipment not found in List result")
	}
}

func TestList_OrderedByTrackingID(t *testing.T) {
	ts := newSetup()
	mustCreate(t, ts)
	mustCreate(t, ts)
	mustCreate(t, ts)

	results, err := ts.svc.List(model.ShipmentFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for i := 1; i < len(results); i++ {
		if results[i].TrackingID < results[i-1].TrackingID {
			t.Errorf("List not sorted: %q comes after %q", results[i-1].TrackingID, results[i].TrackingID)
		}
	}
}
