package service

import (
	"strings"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// ─── test helpers ────────────────────────────────────────────────────────────

func strPtr(s string) *string { return &s }

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
	shipmentRepo repository.ShipmentRepository
	commentRepo  repository.CommentRepository
}

func newSetup() testSetup {
	shipmentRepo := repository.NewInMemoryShipmentRepository()
	branchRepo := testBranchRepo()
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	commentSvc := NewCommentService(commentRepo, shipmentRepo)
	svc := NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, nil)
	return testSetup{svc, commentSvc, shipmentRepo, commentRepo}
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

// advance in_progress → pre_transit → in_transit (to Córdoba / br-cordoba)
func toInTransit(t *testing.T, ts testSetup, id string) model.Shipment {
	t.Helper()
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusPreTransit, ChangedBy: "supervisor",
	})
	return mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusInTransit, Location: "Córdoba", ChangedBy: "supervisor",
	})
}

// advance in_transit → at_branch (location auto-derived)
func toAtBranch(t *testing.T, ts testSetup, id string) model.Shipment {
	t.Helper()
	return mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusAtBranch, ChangedBy: "supervisor",
	})
}

// advance at_branch → delivering
func toDelivering(t *testing.T, ts testSetup, id string) model.Shipment {
	t.Helper()
	return mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusDelivering, DriverID: "driver-01", ChangedBy: "supervisor",
	})
}

// ─── state machine ───────────────────────────────────────────────────────────

func TestIsValidTransition(t *testing.T) {
	tests := []struct {
		from model.Status
		to   model.Status
		want bool
	}{
		// valid transitions
		{model.StatusInProgress, model.StatusPreTransit, true},
		{model.StatusPreTransit, model.StatusInTransit, true},
		{model.StatusPreTransit, model.StatusInProgress, true},
		{model.StatusPreTransit, model.StatusAtBranch, true},
		{model.StatusInTransit, model.StatusAtBranch, true},
		{model.StatusAtBranch, model.StatusPreTransit, true},
		{model.StatusAtBranch, model.StatusDelivering, true},
		{model.StatusAtBranch, model.StatusReadyForPickup, true},
		{model.StatusAtBranch, model.StatusReadyForReturn, true},
		{model.StatusDelivering, model.StatusDelivered, true},
		{model.StatusDelivering, model.StatusDeliveryFailed, true},
		{model.StatusDeliveryFailed, model.StatusDelivering, true},
		{model.StatusDeliveryFailed, model.StatusAtBranch, true},
		{model.StatusReadyForPickup, model.StatusDelivered, true},
		{model.StatusReadyForPickup, model.StatusPreTransit, true},
		{model.StatusReadyForReturn, model.StatusReturned, true},

		// invalid: pending can only be confirmed, not updated via UpdateStatus
		{model.StatusPending, model.StatusInProgress, false},
		{model.StatusPending, model.StatusInTransit, false},

		// invalid: cannot skip steps (pre_transit is now required before in_transit)
		{model.StatusInProgress, model.StatusInTransit, false},
		{model.StatusInProgress, model.StatusDelivered, false},
		{model.StatusInProgress, model.StatusAtBranch, false},
		{model.StatusAtBranch, model.StatusInTransit, false},
		{model.StatusReadyForPickup, model.StatusInTransit, false},
		{model.StatusInTransit, model.StatusDelivered, false},
		{model.StatusInTransit, model.StatusDelivering, false},
		{model.StatusAtBranch, model.StatusDelivered, false},
		{model.StatusAtBranch, model.StatusReturned, false},
		{model.StatusDelivering, model.StatusAtBranch, false},
		{model.StatusDelivering, model.StatusInTransit, false},

		// invalid: terminal states have no outgoing transitions
		{model.StatusDelivered, model.StatusInProgress, false},
		{model.StatusDelivered, model.StatusInTransit, false},
		{model.StatusReturned, model.StatusInProgress, false},
		{model.StatusCancelled, model.StatusInProgress, false},
		{model.StatusCancelled, model.StatusInTransit, false},
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
			wantErr: "origin city and province are required",
		},
		{
			name:    "missing origin province",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.Address.Province = "" },
			wantErr: "origin city and province are required",
		},
		{
			name:    "missing destination city",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.Address.City = "" },
			wantErr: "destination city and province are required",
		},
		{
			name:    "missing destination province",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.Address.Province = "" },
			wantErr: "destination city and province are required",
		},
		{
			name:    "sender DNI too short",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.DNI = "123" },
			wantErr: "sender_dni must be at least 7 digits",
		},
		{
			name:    "sender DNI with letters",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.DNI = "1234abc" },
			wantErr: "sender_dni must contain only digits",
		},
		{
			name:    "recipient DNI too short",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.DNI = "99" },
			wantErr: "recipient_dni must be at least 7 digits",
		},
		{
			name:    "recipient DNI with letters",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.DNI = "abc1234" },
			wantErr: "recipient_dni must contain only digits",
		},
		{
			name:    "invalid sender email",
			mutate:  func(r *model.CreateShipmentRequest) { r.Sender.Email = "notanemail" },
			wantErr: "sender_email is not a valid email address",
		},
		{
			name:    "invalid recipient email",
			mutate:  func(r *model.CreateShipmentRequest) { r.Recipient.Email = "bad@" },
			wantErr: "recipient_email is not a valid email address",
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
	if ship.Status != model.StatusInProgress {
		t.Errorf("status = %s, want in_progress", ship.Status)
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
	req := model.SaveDraftRequest{WeightKg: 1.5}
	ship, err := ts.svc.SaveDraft(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ship.Status != model.StatusPending {
		t.Errorf("status = %s, want pending", ship.Status)
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
	if err == nil || !strings.Contains(err.Error(), "sender_dni must contain only digits") {
		t.Errorf("expected DNI validation error, got: %v", err)
	}
}

func TestSaveDraft_ValidatesEmailWhenProvided(t *testing.T) {
	ts := newSetup()
	req := model.SaveDraftRequest{
		Recipient: model.Customer{Email: "notvalid"},
	}
	_, err := ts.svc.SaveDraft(req)
	if err == nil || !strings.Contains(err.Error(), "recipient_email is not a valid email address") {
		t.Errorf("expected email validation error, got: %v", err)
	}
}

// ─── UpdateDraft ──────────────────────────────────────────────────────────────

func TestUpdateDraft_RejectsNonDraft(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // status: in_progress, not pending
	_, err := ts.svc.UpdateDraft(ship.TrackingID, model.SaveDraftRequest{})
	if err == nil || !strings.Contains(err.Error(), "only draft shipments can be updated") {
		t.Errorf("expected non-draft error, got: %v", err)
	}
}

func TestUpdateDraft_ValidatesDNIWhenProvided(t *testing.T) {
	ts := newSetup()
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
	// "short" contains only digits but is < 7 chars
	req := model.SaveDraftRequest{Sender: model.Customer{DNI: "123"}}
	_, err := ts.svc.UpdateDraft(draft.TrackingID, req)
	if err == nil || !strings.Contains(err.Error(), "sender_dni must be at least 7 digits") {
		t.Errorf("expected DNI error, got: %v", err)
	}
}

// ─── ConfirmDraft ─────────────────────────────────────────────────────────────

func TestConfirmDraft_RejectsNonDraft(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.ConfirmDraft(ship.TrackingID, "operator")
	if err == nil || !strings.Contains(err.Error(), "only draft shipments can be confirmed") {
		t.Errorf("expected non-draft error, got: %v", err)
	}
}

func TestConfirmDraft_RejectsMissingFields(t *testing.T) {
	ts := newSetup()
	// draft with no data at all
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
	_, err := ts.svc.ConfirmDraft(draft.TrackingID, "operator")
	if err == nil || !strings.Contains(err.Error(), "missing required fields") {
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
		WeightKg: 2.0, PackageType: model.PackageBox,
	})
	// SaveDraft catches the short DNI first
	if err == nil {
		// If somehow it slipped through, ConfirmDraft must catch it
		_, err = ts.svc.ConfirmDraft(draft.TrackingID, "operator")
	}
	if err == nil || !strings.Contains(err.Error(), "sender_dni must be at least 7 digits") {
		t.Errorf("expected short-DNI error at save or confirm, got: %v", err)
	}
}

func TestConfirmDraft_Success(t *testing.T) {
	ts := newSetup()
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{
		Sender:    defaultSender(),
		Recipient: defaultRecipient(),
		WeightKg:  2.0, PackageType: model.PackageBox,
	})
	confirmed, err := ts.svc.ConfirmDraft(draft.TrackingID, "operator")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if confirmed.Status != model.StatusInProgress {
		t.Errorf("status = %s, want in_progress", confirmed.Status)
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
	toAtBranch(t, ts, ship.TrackingID)
	toDelivering(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDeliveryFailed, ChangedBy: "driver",
		// Notes intentionally empty
	})
	if err == nil || !strings.Contains(err.Error(), "notes are required for delivery_failed") {
		t.Errorf("expected notes-required error, got: %v", err)
	}
}

func TestUpdateStatus_Delivering_RequiresDriverID(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtBranch(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivering, ChangedBy: "supervisor",
		// DriverID intentionally empty
	})
	if err == nil || !strings.Contains(err.Error(), "driver_id is required when moving to delivering") {
		t.Errorf("expected driver_id-required error, got: %v", err)
	}
}

func TestUpdateStatus_InvalidTransition(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // in_progress
	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "invalid transition") {
		t.Errorf("expected invalid transition error, got: %v", err)
	}
}

func TestUpdateStatus_InTransit_SameDestinationRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // CurrentLocation = br-caba
	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusPreTransit, ChangedBy: "supervisor",
	})
	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status:    model.StatusInTransit,
		Location:  "Buenos Aires", // resolves to br-caba — same as current
		ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "destination branch must be different from current branch") {
		t.Errorf("expected same-destination error, got: %v", err)
	}
}

func TestUpdateStatus_InTransit_DifferentDestinationAllowed(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusPreTransit, ChangedBy: "supervisor",
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
	toAtBranch(t, ts, ship.TrackingID)
	toDelivering(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
	})
	if err == nil || !strings.Contains(err.Error(), "recipient_dni is required for delivery") {
		t.Errorf("expected recipient_dni required error, got: %v", err)
	}
}

func TestUpdateStatus_Delivered_WrongDNIRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtBranch(t, ts, ship.TrackingID)
	toDelivering(t, ts, ship.TrackingID)

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver", RecipientDNI: "00000000",
	})
	if err == nil || !strings.Contains(err.Error(), "DNI does not match") {
		t.Errorf("expected DNI mismatch error, got: %v", err)
	}
}

func TestUpdateStatus_Delivered_CorrectDNISucceeds(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtBranch(t, ts, ship.TrackingID)
	toDelivering(t, ts, ship.TrackingID)

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
	toAtBranch(t, ts, ship.TrackingID)

	// Apply a correction to recipient DNI before delivering
	correctedDNI := "11111111"
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{RecipientDNI: strPtr(correctedDNI)},
	})
	if err != nil {
		t.Fatalf("correction failed: %v", err)
	}

	toDelivering(t, ts, ship.TrackingID)

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
	if err == nil || !strings.Contains(err.Error(), "sender_dni is required for returned") {
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
	if err == nil || !strings.Contains(err.Error(), "DNI does not match") {
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
	ship := mustCreate(t, ts) // ReceivingBranchID = br-caba
	toInTransit(t, ts, ship.TrackingID)
	toAtBranch(t, ts, ship.TrackingID) // now at br-cordoba, not br-caba

	_, err := ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusReadyForReturn, ChangedBy: "supervisor",
	})
	if err == nil || !strings.Contains(err.Error(), "not at its origin branch") {
		t.Errorf("expected origin-branch error, got: %v", err)
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

func TestUpdateStatus_AtBranch_AutoDerivesLocationFromInTransitEvent(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts) // CurrentLocation = br-caba

	toInTransit(t, ts, ship.TrackingID) // goes to br-cordoba

	result := toAtBranch(t, ts, ship.TrackingID)
	// CurrentLocation must now be the destination set in the in_transit event (br-cordoba)
	if result.CurrentLocation != "br-cordoba" {
		t.Errorf("CurrentLocation = %q, want %q", result.CurrentLocation, "br-cordoba")
	}
}

func TestUpdateStatus_AtBranch_FromDeliveryFailed_AutoDerivesFromLastAtBranch(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	toInTransit(t, ts, ship.TrackingID)
	toAtBranch(t, ts, ship.TrackingID) // at br-cordoba
	toDelivering(t, ts, ship.TrackingID)

	// delivery_failed
	mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDeliveryFailed, ChangedBy: "driver", Notes: "nobody home",
	})

	// delivery_failed → at_branch: auto-derives from last at_branch event
	result := mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusAtBranch, ChangedBy: "supervisor",
	})
	if result.CurrentLocation != "br-cordoba" {
		t.Errorf("CurrentLocation = %q, want %q after delivery_failed → at_branch", result.CurrentLocation, "br-cordoba")
	}
}

// ─── CancelShipment ───────────────────────────────────────────────────────────

func TestCancelShipment_RequiresReason(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CancelShipment(ship.TrackingID, "supervisor", "")
	if err == nil || !strings.Contains(err.Error(), "cancellation reason is required") {
		t.Errorf("expected reason-required error, got: %v", err)
	}
}

func TestCancelShipment_NonCancellableStates(t *testing.T) {
	tests := []struct {
		name  string
		setup func(ts testSetup) string
	}{
		{
			name: "pending",
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
				toAtBranch(t, ts, ship.TrackingID)
				toDelivering(t, ts, ship.TrackingID)
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
			if err == nil || !strings.Contains(err.Error(), "cannot cancel") {
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
			name: "in_progress",
			setup: func(ts testSetup) string {
				return mustCreate(t, ts).TrackingID
			},
		},
		{
			name: "at_branch",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtBranch(t, ts, ship.TrackingID)
				return ship.TrackingID
			},
		},
		{
			name: "delivering",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtBranch(t, ts, ship.TrackingID)
				toDelivering(t, ts, ship.TrackingID)
				return ship.TrackingID
			},
		},
		{
			name: "delivery_failed",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtBranch(t, ts, ship.TrackingID)
				toDelivering(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDeliveryFailed, ChangedBy: "driver", Notes: "nobody home",
				})
				return ship.TrackingID
			},
		},
		{
			name: "ready_for_pickup",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtBranch(t, ts, ship.TrackingID)
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
	if err == nil || !strings.Contains(err.Error(), "no corrections provided") {
		t.Errorf("expected no-corrections error, got: %v", err)
	}
}

func TestCorrectShipment_InvalidSenderDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{SenderDNI: strPtr("abc")},
	})
	if err == nil || !strings.Contains(err.Error(), "sender_dni must contain only digits") {
		t.Errorf("expected DNI validation error, got: %v", err)
	}
}

func TestCorrectShipment_InvalidRecipientDNI(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{RecipientDNI: strPtr("1234")}, // too short
	})
	if err == nil || !strings.Contains(err.Error(), "recipient_dni must be at least 7 digits") {
		t.Errorf("expected short-DNI error, got: %v", err)
	}
}

func TestCorrectShipment_InvalidEmail(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.svc.CorrectShipment(ship.TrackingID, "supervisor", model.CorrectShipmentRequest{
		Corrections: model.ShipmentCorrections{SenderEmail: strPtr("bad-email")},
	})
	if err == nil || !strings.Contains(err.Error(), "sender_email is not a valid email address") {
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
			name: "pending draft",
			setup: func(ts testSetup) string {
				d, _ := ts.svc.SaveDraft(model.SaveDraftRequest{})
				return d.TrackingID
			},
			wantErr: "drafts must be edited directly",
		},
		{
			name: "delivered",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtBranch(t, ts, ship.TrackingID)
				toDelivering(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDelivered, ChangedBy: "driver",
					RecipientDNI: defaultRecipient().DNI,
				})
				return ship.TrackingID
			},
			wantErr: "cannot correct finalized shipments",
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
			wantErr: "cannot correct finalized shipments",
		},
		{
			name: "cancelled",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				ts.svc.CancelShipment(ship.TrackingID, "supervisor", "test")
				return ship.TrackingID
			},
			wantErr: "cannot correct finalized shipments",
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
	// in_progress → in_transit (to Córdoba)
	toInTransit(t, ts, id)
	// in_transit → at_branch (at br-cordoba)
	toAtBranch(t, ts, id)
	// at_branch → pre_transit → in_transit (back to Buenos Aires / br-caba)
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusPreTransit, ChangedBy: "supervisor",
	})
	mustStatus(t, ts, id, model.UpdateStatusRequest{
		Status: model.StatusInTransit, Location: "Buenos Aires", ChangedBy: "supervisor",
	})
	// in_transit → at_branch (auto-derives to br-caba)
	toAtBranch(t, ts, id)
	// at_branch → ready_for_return (now at origin br-caba)
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
		Status:              model.StatusInProgress,
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
	if result.Status != model.StatusInProgress {
		t.Errorf("status = %q, want in_progress", result.Status)
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
	ship := mustCreate(t, ts) // in_progress

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
	draft, _ := ts.svc.SaveDraft(model.SaveDraftRequest{WeightKg: 2.0})

	result, err := ts.svc.GetByTrackingID(draft.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != model.StatusPending {
		t.Errorf("status = %q, want pending", result.Status)
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

	mustCreate(t, ts) // in_progress

	s2 := mustCreate(t, ts)
	toInTransit(t, ts, s2.TrackingID) // in_transit

	s3 := mustCreate(t, ts)
	toInTransit(t, ts, s3.TrackingID)
	toAtBranch(t, ts, s3.TrackingID) // at_branch

	s4 := mustCreate(t, ts)
	toInTransit(t, ts, s4.TrackingID)
	toAtBranch(t, ts, s4.TrackingID)
	toDelivering(t, ts, s4.TrackingID)
	mustStatus(t, ts, s4.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDelivered, ChangedBy: "driver",
		RecipientDNI: defaultRecipient().DNI,
	}) // delivered

	ts.svc.SaveDraft(model.SaveDraftRequest{}) // pending

	all, err := ts.svc.List(model.ShipmentFilter{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	statusSet := make(map[model.Status]bool)
	for _, s := range all {
		statusSet[s.Status] = true
	}
	for _, want := range []model.Status{
		model.StatusInProgress, model.StatusInTransit,
		model.StatusAtBranch, model.StatusDelivered, model.StatusPending,
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
