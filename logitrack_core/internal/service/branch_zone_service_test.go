package service

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
)

// fakeBranchZoneRepo is a minimal in-memory stub for BranchZoneRepository.
type fakeBranchZoneRepo struct {
	zones []model.BranchZone
}

func (f *fakeBranchZoneRepo) ListByBranch(branchID string, includeInactive bool) ([]model.BranchZone, error) {
	var out []model.BranchZone
	for _, z := range f.zones {
		if z.BranchID == branchID && (includeInactive || z.Active) {
			out = append(out, z)
		}
	}
	return out, nil
}

func (f *fakeBranchZoneRepo) GetByBranchAndType(branchID string, zoneType model.BranchZoneType) (model.BranchZone, error) {
	for _, z := range f.zones {
		if z.BranchID == branchID && z.ZoneType == zoneType {
			return z, nil
		}
	}
	return model.BranchZone{}, fmt.Errorf("zona %q no encontrada en sucursal %s", zoneType, branchID)
}

func (f *fakeBranchZoneRepo) Create(zone model.BranchZone) error {
	f.zones = append(f.zones, zone)
	return nil
}

func (f *fakeBranchZoneRepo) SetActiveForBranch(branchID string, active bool) error {
	for i := range f.zones {
		if f.zones[i].BranchID == branchID {
			f.zones[i].Active = active
		}
	}
	return nil
}

func (f *fakeBranchZoneRepo) EnsureZonesForBranch(branchID string) error {
	existing, _ := f.ListByBranch(branchID, true)
	existingMap := map[model.BranchZoneType]bool{}
	for _, z := range existing {
		existingMap[z.ZoneType] = true
	}
	allTypes := []model.BranchZoneType{
		model.ZoneEntrada,
		model.ZoneSalida,
		model.ZoneRevision,
		model.ZoneDevolucion,
	}
	now := time.Now()
	for _, zt := range allTypes {
		if existingMap[zt] {
			continue
		}
		f.zones = append(f.zones, model.BranchZone{
			ID:        uuid.New().String(),
			BranchID:  branchID,
			ZoneType:  zt,
			Name:      string(zt),
			Active:    true,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}
	return nil
}

// fakeShipmentUpdater is a minimal stub that implements the UpdateStatus path
// for ClassifyShipment tests. We use the real ShipmentService via the in-memory
// event store and projection.
func newBranchZoneTestSvc() (*BranchZoneService, *fakeBranchZoneRepo, repository.ShipmentRepository, repository.EventStore, *projection.ShipmentProjection) {
	zoneRepo := &fakeBranchZoneRepo{}
	shipmentRepo, eventStore, proj := repository.NewInMemoryShipmentRepositoryWithDeps()
	svc := NewBranchZoneService(zoneRepo, shipmentRepo, eventStore, proj)

	// Seed zones for test branch
	_ = zoneRepo.EnsureZonesForBranch("branch_a")

	return svc, zoneRepo, shipmentRepo, eventStore, proj.(*projection.ShipmentProjection)
}

// createTestShipment creates a shipment in the in-memory repo with the given status and branch.
func createTestShipment(t *testing.T, shipmentRepo repository.ShipmentRepository, eventStore repository.EventStore, proj projection.Projector, trackingID, branchID string, status model.Status) {
	t.Helper()
	now := time.Now().UTC()
	sh := model.Shipment{
		TrackingID:        trackingID,
		Status:            status,
		ReceivingBranchID: branchID,
		CreatedAt:         now,
		UpdatedAt:         now,
		Recipient:         model.Customer{Name: "Test", DNI: "12345678"},
		Sender:            model.Customer{Name: "Sender", DNI: "87654321"},
		WeightKg:          5,
	}
	event := model.DomainEvent{
		ID:         uuid.New().String(),
		TrackingID: trackingID,
		EventType:  model.EventShipmentCreated,
		Payload:    model.ShipmentCreatedPayload{Shipment: sh},
		Timestamp:  now,
	}
	if err := eventStore.Append(event); err != nil {
		t.Fatal(err)
	}
	proj.Apply(event)
	// The event-sourced repo creates the shipment; re-read to verify
	_, err := shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		t.Fatalf("shipment not created: %v", err)
	}
}

// setShipmentZone sets current_zone via a direct event emission.
func setShipmentZone(t *testing.T, eventStore repository.EventStore, proj projection.Projector, trackingID string, zone model.BranchZoneType) {
	t.Helper()
	zoneStr := string(zone)
	event := model.DomainEvent{
		ID:         uuid.New().String(),
		TrackingID: trackingID,
		EventType:  model.EventShipmentZoned,
		Payload:    model.ShipmentZonedPayload{Zone: zone, BranchID: "branch_a"},
		Timestamp:  time.Now().UTC(),
	}
	if err := eventStore.Append(event); err != nil {
		t.Fatal(err)
	}
	proj.Apply(event)
	// track via CurrentZone pointer
	sh, _ := proj.(*projection.ShipmentProjection).Get(trackingID)
	if sh.CurrentZone == nil || *sh.CurrentZone != zoneStr {
		t.Fatalf("expected current_zone=%s, got %v", zoneStr, sh.CurrentZone)
	}
}

// ── Tests ──────────────────────────────────────────────────────────────────────

func setupMoveTest(t *testing.T) (*BranchZoneService, *fakeBranchZoneRepo, repository.EventStore, *projection.ShipmentProjection) {
	svc, zoneRepo, shipmentRepo, eventStore, proj := newBranchZoneTestSvc()
	createTestShipment(t, shipmentRepo, eventStore, proj, "LT-AAAA", "branch_a", model.StatusAtHub)
	createTestShipment(t, shipmentRepo, eventStore, proj, "LT-BBBB", "branch_a", model.StatusAtHub)
	createTestShipment(t, shipmentRepo, eventStore, proj, "LT-CCCC", "branch_b", model.StatusAtHub)
	return svc, zoneRepo, eventStore, proj
}

func TestMoveShipment_EntradaToSalida(t *testing.T) {
	svc, _, _, _ := setupMoveTest(t)
	// LT-AAAA starts in Entrada (default)
	err := svc.MoveShipment("LT-AAAA", "op1", "branch_a", "sin daños", model.ZoneSalida, model.RoleOperator)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestMoveShipment_EntradaToRevision(t *testing.T) {
	svc, _, _, _ := setupMoveTest(t)
	err := svc.MoveShipment("LT-AAAA", "op1", "branch_a", "embalaje dañado", model.ZoneRevision, model.RoleOperator)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestMoveShipment_SalidaToRevision(t *testing.T) {
	svc, _, eventStore, proj := setupMoveTest(t)
	setShipmentZone(t, eventStore, proj, "LT-AAAA", model.ZoneSalida)
	err := svc.MoveShipment("LT-AAAA", "op1", "branch_a", "control calidad", model.ZoneRevision, model.RoleOperator)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestMoveShipment_SalidaToEntrada(t *testing.T) {
	svc, _, eventStore, proj := setupMoveTest(t)
	setShipmentZone(t, eventStore, proj, "LT-AAAA", model.ZoneSalida)
	err := svc.MoveShipment("LT-AAAA", "op1", "branch_a", "reingreso", model.ZoneEntrada, model.RoleOperator)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestMoveShipment_OtherBranch_Forbidden(t *testing.T) {
	svc, _, _, _ := setupMoveTest(t)
	err := svc.MoveShipment("LT-CCCC", "op1", "branch_a", "", model.ZoneSalida, model.RoleOperator)
	if err == nil {
		t.Fatal("expected error for other branch, got nil")
	}
}

func TestMoveShipment_DevolucionDirect_Blocked(t *testing.T) {
	svc, _, _, _ := setupMoveTest(t)
	err := svc.MoveShipment("LT-AAAA", "op1", "branch_a", "", model.ZoneDevolucion, model.RoleOperator)
	if err == nil {
		t.Fatal("expected error for direct devolucion, got nil")
	}
}

// ── Revision tests ─────────────────────────────────────────────────────────────

func setupRevisionTest(t *testing.T) (*BranchZoneService, repository.EventStore, *projection.ShipmentProjection) {
	svc, _, shipmentRepo, eventStore, proj := newBranchZoneTestSvc()
	createTestShipment(t, shipmentRepo, eventStore, proj, "LT-AAAA", "branch_a", model.StatusAtHub)
	setShipmentZone(t, eventStore, proj, "LT-AAAA", model.ZoneRevision)
	return svc, eventStore, proj
}

func TestRevision_OperatorCannotMove(t *testing.T) {
	svc, _, _ := setupRevisionTest(t)
	err := svc.MoveShipment("LT-AAAA", "op1", "branch_a", "", model.ZoneSalida, model.RoleOperator)
	if err == nil {
		t.Fatal("expected error for operator moving from Revision, got nil")
	}
}

func TestRevision_SupervisorCanApprove(t *testing.T) {
	svc, _, _ := setupRevisionTest(t)
	err := svc.ApproveFromRevision("LT-AAAA", "sup1", "branch_a", "aprobado")
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestRevision_ApproveWrongBranch(t *testing.T) {
	svc, _, _ := setupRevisionTest(t)
	err := svc.ApproveFromRevision("LT-AAAA", "sup1", "branch_b", "aprobado")
	if err == nil {
		t.Fatal("expected error for wrong branch, got nil")
	}
}

// ── Classify tests ─────────────────────────────────────────────────────────────

// minimalShipmentSvc creates a real ShipmentService wired to the same in-memory stores
// so that ClassifyShipment can call UpdateStatus.
// stubSystemConfig is a minimal SystemConfigProvider for tests.
type stubSystemConfig struct{}

func (s *stubSystemConfig) Get() model.SystemConfig {
	return model.SystemConfig{MaxDeliveryAttempts: 3}
}

func setupClassifyTest(t *testing.T) (*BranchZoneService, repository.ShipmentRepository) {
	zoneRepo := &fakeBranchZoneRepo{}
	shipmentRepo, eventStore, proj := repository.NewInMemoryShipmentRepositoryWithDeps()
	branchRepo := repository.NewInMemoryBranchRepository()
	branchRepo.Add(model.Branch{
		ID:       "branch_a",
		Name:     "BRANCH-A",
		Status:   model.BranchStatusActive,
		Province: "Buenos Aires",
		Address:  model.Address{City: "Buenos Aires"},
	})
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	commentSvc := NewCommentService(commentRepo, shipmentRepo)
	mlClient := NewMLService("")
	shipmentSvc := NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, mlClient)
	shipmentSvc.SetSystemConfig(&stubSystemConfig{})

	// Wire BranchZoneService with the real ShipmentService
	svc := NewBranchZoneService(zoneRepo, shipmentRepo, eventStore, proj)
	svc.SetShipmentService(shipmentSvc)
	_ = zoneRepo.EnsureZonesForBranch("branch_a")

	// Create shipment in Revision zone with a valid origin branch
	now := time.Now().UTC()
	sh := model.Shipment{
		TrackingID:        "LT-AAAA",
		Status:            model.StatusAtHub,
		ReceivingBranchID: "branch_a",
		OriginBranchID:    "branch_a",
		CreatedAt:         now,
		UpdatedAt:         now,
		Recipient:         model.Customer{Name: "Test", DNI: "12345678"},
		Sender:            model.Customer{Name: "Sender", DNI: "87654321"},
		WeightKg:          5,
		CurrentLocation:   "branch_a",
	}
	event := model.DomainEvent{
		ID:         uuid.New().String(),
		TrackingID: "LT-AAAA",
		EventType:  model.EventShipmentCreated,
		Payload:    model.ShipmentCreatedPayload{Shipment: sh},
		Timestamp:  now,
	}
	if err := eventStore.Append(event); err != nil {
		t.Fatal(err)
	}
	proj.Apply(event)

	setShipmentZone(t, eventStore, proj, "LT-AAAA", model.ZoneRevision)

	return svc, shipmentRepo
}

func TestClassifyShipment_Lost(t *testing.T) {
	svc, shipmentRepo := setupClassifyTest(t)

	err := svc.ClassifyShipment("LT-AAAA", "sup1", "branch_a", "lost", "paquete vacío")
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}

	sh, err := shipmentRepo.GetByTrackingID("LT-AAAA")
	if err != nil {
		t.Fatal(err)
	}
	if sh.Status != model.StatusLost {
		t.Fatalf("expected StatusLost, got %s", sh.Status)
	}
	if sh.CurrentZone != nil {
		t.Fatalf("expected current_zone=nil after classification, got %v", *sh.CurrentZone)
	}
}

func TestClassifyShipment_Destroyed(t *testing.T) {
	svc, shipmentRepo := setupClassifyTest(t)

	err := svc.ClassifyShipment("LT-AAAA", "sup1", "branch_a", "destroyed", "destruido")
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}

	sh, err := shipmentRepo.GetByTrackingID("LT-AAAA")
	if err != nil {
		t.Fatal(err)
	}
	if sh.Status != model.StatusDestroyed {
		t.Fatalf("expected StatusDestroyed, got %s", sh.Status)
	}
}

func TestClassifyShipment_InvalidClassification(t *testing.T) {
	svc, _ := setupClassifyTest(t)

	err := svc.ClassifyShipment("LT-AAAA", "sup1", "branch_a", "invalid", "")
	if err == nil {
		t.Fatal("expected error for invalid classification, got nil")
	}
}

func TestClassifyShipment_WrongBranch(t *testing.T) {
	svc, _ := setupClassifyTest(t)

	err := svc.ClassifyShipment("LT-AAAA", "sup1", "branch_b", "lost", "")
	if err == nil {
		t.Fatal("expected error for wrong branch, got nil")
	}
}
