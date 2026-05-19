package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// =============================================================================
// Fake InterBranchTripRepository
// =============================================================================

type fakeTripRepo struct {
	mu    sync.Mutex
	trips map[string]model.InterBranchTrip
}

func newFakeTripRepo() *fakeTripRepo {
	return &fakeTripRepo{trips: make(map[string]model.InterBranchTrip)}
}

func (r *fakeTripRepo) Create(trip model.InterBranchTrip) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.trips[trip.ID] = trip
	return nil
}

func (r *fakeTripRepo) GetByID(id string) (model.InterBranchTrip, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[id]
	return t, ok
}

func (r *fakeTripRepo) GetActiveByDriver(driverID string) (model.InterBranchTrip, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.trips {
		if t.DriverID != nil && *t.DriverID == driverID &&
			(t.Status == model.TripStatusPending || t.Status == model.TripStatusInProgress) {
			return t, true
		}
	}
	return model.InterBranchTrip{}, false
}

func (r *fakeTripRepo) GetActiveByVehicle(vehicleID string) (model.InterBranchTrip, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, t := range r.trips {
		if t.VehicleID == vehicleID &&
			(t.Status == model.TripStatusPending || t.Status == model.TripStatusInProgress) {
			return t, true
		}
	}
	return model.InterBranchTrip{}, false
}

func (r *fakeTripRepo) ClaimByDriver(tripID, driverID string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[tripID]
	if !ok {
		return false, nil
	}
	if t.DriverID != nil {
		return false, nil
	}
	t.DriverID = &driverID
	r.trips[tripID] = t
	return true, nil
}

func (r *fakeTripRepo) UpdateStatus(id string, status model.TripStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[id]
	if !ok {
		return nil
	}
	t.Status = status
	r.trips[id] = t
	return nil
}

func (r *fakeTripRepo) SetDriver(id string, driverID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[id]
	if !ok {
		return nil
	}
	t.DriverID = &driverID
	r.trips[id] = t
	return nil
}

func (r *fakeTripRepo) SetStartedAt(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[id]
	if !ok {
		return nil
	}
	now := model.GenerateTripID() // just need a non-empty marker; StartedAt is time.Time
	_ = now
	// Set a non-zero started_at by mutating status (the real field is set in UpdateStatus flow)
	r.trips[id] = t
	return nil
}

func (r *fakeTripRepo) SetCompleted(id string, finishedByUserID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[id]
	if !ok {
		return nil
	}
	t.Status = model.TripStatusCompleted
	r.trips[id] = t
	return nil
}

func (r *fakeTripRepo) AdvanceStop(tripID string, stopIndex int, completedByUserID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[tripID]
	if !ok {
		return nil
	}
	t.CurrentStopIndex = stopIndex + 1
	r.trips[tripID] = t
	return nil
}

func (r *fakeTripRepo) MarkStopUnloaded(tripID string, stopIdx int, ts time.Time, byUserID string) error {
	return nil
}

func (r *fakeTripRepo) ReleaseDriver(tripID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.trips[tripID]
	if !ok {
		return nil
	}
	t.DriverID = nil
	r.trips[tripID] = t
	return nil
}

func (r *fakeTripRepo) ListByDestinationBranch(branchID string) []model.InterBranchTrip {
	return nil
}
func (r *fakeTripRepo) ListByOriginBranch(branchID string) []model.InterBranchTrip { return nil }
func (r *fakeTripRepo) ListByStopBranch(branchID string) []model.InterBranchTrip   { return nil }
func (r *fakeTripRepo) ListAllActive() []model.InterBranchTrip                     { return nil }
func (r *fakeTripRepo) AddShipment(tripID, shipmentID string) error                { return nil }

// =============================================================================
// Fake AuthRepository (minimal — only GetUserByID needed for AssignDriver)
// =============================================================================

type fakeAuthRepoForTrip struct{}

func (f *fakeAuthRepoForTrip) FindUser(_, _ string) (model.User, error) { return model.User{}, nil }
func (f *fakeAuthRepoForTrip) SaveToken(_ string, _ model.User)         {}
func (f *fakeAuthRepoForTrip) GetUserByToken(_ string) (model.User, error) {
	return model.User{}, nil
}
func (f *fakeAuthRepoForTrip) DeleteToken(_ string)          {}
func (f *fakeAuthRepoForTrip) ListAll() []model.User         { return nil }
func (f *fakeAuthRepoForTrip) GetUserByID(_ string) (model.User, error) {
	return model.User{}, nil
}
func (f *fakeAuthRepoForTrip) UpdateUser(_ string, _ repository.UserUpdate) (model.User, error) {
	return model.User{}, nil
}
func (f *fakeAuthRepoForTrip) CreateUser(_ repository.UserCreate) (model.User, error) {
	return model.User{}, nil
}
func (f *fakeAuthRepoForTrip) ChangePassword(_ context.Context, _, _, _ string) error {
	return nil
}
func (f *fakeAuthRepoForTrip) ListByRole(_ model.Role, _ string) []model.User { return nil }

// =============================================================================
// Helpers
// =============================================================================

func newTripService(tripRepo *fakeTripRepo, vehicleRepo *fakeVehicleRepo) *InterBranchTripService {
	shipmentRepo, _, _ := repository.NewInMemoryShipmentRepositoryWithDeps()
	branchRepo := repository.NewInMemoryBranchRepository()
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	commentSvc := NewCommentService(commentRepo, shipmentRepo)
	shipmentSvc := NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, nil)
	shipmentSvc.SetPricingService(NewPricingService(repository.NewInMemoryPricingConfigRepository()))

	svc := NewInterBranchTripService(tripRepo, vehicleRepo, branchRepo, &fakeAuthRepoForTrip{}, shipmentSvc)
	return svc
}

func vehicleEnCarga(id, qrToken string) model.Vehicle {
	return model.Vehicle{
		ID:             id,
		LicensePlate:   "AB123CD",
		QRToken:        qrToken,
		Status:         model.VehicleStatusLoading,
		AssignedBranch: ibStrPtr("caba"),
	}
}

func ibStrPtr(s string) *string { return &s }

// =============================================================================
// Tests
// =============================================================================

func TestClaimByQR_InterBranch_AutoStartsTrip(t *testing.T) {
	tripRepo := newFakeTripRepo()
	vehicleRepo := &fakeVehicleRepo{vehicles: []model.Vehicle{vehicleEnCarga("V1", "QR-V1")}}

	svc := newTripService(tripRepo, vehicleRepo)

	// Crear un trip intersucursal pendiente sin chofer
	driverID := "driver-ib-1"
	trip, err := svc.Create(CreateInterBranchTripCmd{
		Kind:                model.TripKindInterBranch,
		VehicleID:           "V1",
		LicensePlate:        "AB123CD",
		OriginBranchID:      "caba",
		DestinationBranchID: ibStrPtr("cordoba"),
		ShipmentIDs:         []string{},
		TotalWeightKg:       120,
		CreatedBy:           "op_caba",
		Stops: []model.TripStop{
			{BranchID: "cordoba", ShipmentIDs: []string{}, TotalWeightKg: 120},
		},
	})
	if err != nil {
		t.Fatalf("crear trip: %v", err)
	}
	if trip.Status != model.TripStatusPending {
		t.Fatalf("status esperado pendiente, got %s", trip.Status)
	}

	// Chofer escanea QR del vehículo
	claimed, err := svc.ClaimByQR("QR-V1", driverID, "caba", model.DriverTypeInterBranch)
	if err != nil {
		t.Fatalf("ClaimByQR: %v", err)
	}

	// Debe estar en_transito directamente
	if claimed.Status != model.TripStatusInProgress {
		t.Errorf("status esperado en_transito, got %s", claimed.Status)
	}
	if claimed.DriverID == nil || *claimed.DriverID != driverID {
		t.Errorf("driver_id esperado %q, got %v", driverID, claimed.DriverID)
	}
	if claimed.StartedAt == nil {
		t.Errorf("started_at debe estar seteado tras el auto-start")
	}
}

func TestClaimByQR_InterBranch_IdempotentSecondClaim(t *testing.T) {
	tripRepo := newFakeTripRepo()
	vehicleRepo := &fakeVehicleRepo{vehicles: []model.Vehicle{vehicleEnCarga("V2", "QR-V2")}}

	svc := newTripService(tripRepo, vehicleRepo)
	driverID := "driver-ib-2"

	_, _ = svc.Create(CreateInterBranchTripCmd{
		Kind:          model.TripKindInterBranch,
		VehicleID:     "V2",
		LicensePlate:  "EF456GH",
		OriginBranchID: "caba",
		ShipmentIDs:   []string{},
		TotalWeightKg: 50,
		CreatedBy:     "op_caba",
	})

	first, err := svc.ClaimByQR("QR-V2", driverID, "caba", model.DriverTypeInterBranch)
	if err != nil {
		t.Fatalf("primer claim: %v", err)
	}

	// Segundo claim del mismo chofer debe ser idempotente
	second, err := svc.ClaimByQR("QR-V2", driverID, "caba", model.DriverTypeInterBranch)
	if err != nil {
		t.Fatalf("segundo claim (idempotente): %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("ids distintos en claim idempotente: %s vs %s", first.ID, second.ID)
	}
}

// Last-mile auto-start requires at least one shipment; with 0 envíos el viaje
// queda pendiente hasta que el chofer toca "Iniciar". Verificamos que el claim
// no retorna error y que el tipo driver es respetado.
func TestClaimByQR_LastMile_ClaimSucceedsWithoutShipments(t *testing.T) {
	tripRepo := newFakeTripRepo()
	vehicleRepo := &fakeVehicleRepo{vehicles: []model.Vehicle{vehicleEnCarga("V3", "QR-V3")}}

	svc := newTripService(tripRepo, vehicleRepo)
	driverID := "driver-lm-1"

	_, _ = svc.Create(CreateInterBranchTripCmd{
		Kind:           model.TripKindLastMile,
		VehicleID:      "V3",
		LicensePlate:   "IJ789KL",
		OriginBranchID: "caba",
		ShipmentIDs:    []string{},
		TotalWeightKg:  30,
		CreatedBy:      "op_caba",
	})

	claimed, err := svc.ClaimByQR("QR-V3", driverID, "caba", model.DriverTypeLastMile)
	if err != nil {
		t.Fatalf("ClaimByQR last_mile sin envíos: %v", err)
	}
	if claimed.DriverID == nil || *claimed.DriverID != driverID {
		t.Errorf("driver_id no asignado: %v", claimed.DriverID)
	}
}

func TestClaimByQR_InterBranch_WrongDriverTypeRejected(t *testing.T) {
	tripRepo := newFakeTripRepo()
	vehicleRepo := &fakeVehicleRepo{vehicles: []model.Vehicle{vehicleEnCarga("V4", "QR-V4")}}

	svc := newTripService(tripRepo, vehicleRepo)

	_, _ = svc.Create(CreateInterBranchTripCmd{
		Kind:          model.TripKindInterBranch,
		VehicleID:     "V4",
		LicensePlate:  "MN000OP",
		OriginBranchID: "caba",
		ShipmentIDs:   []string{},
		TotalWeightKg: 80,
		CreatedBy:     "op_caba",
	})

	_, err := svc.ClaimByQR("QR-V4", "driver-lm-wrong", "caba", model.DriverTypeLastMile)
	if err == nil {
		t.Error("debería rechazar un chofer de última milla intentando reclamar un viaje intersucursal")
	}
}
