package service

import (
	"sync"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// ─── fake implementations ────────────────────────────────────────────────────

// fakeDispatchRoutingCfg implementa dispatchRoutingCfgGetter con tasas configurables.
type fakeDispatchRoutingCfg struct {
	lastMileRate    float64
	interBranchRate float64
}

func (f *fakeDispatchRoutingCfg) Get() model.RoutingConfig {
	return model.RoutingConfig{
		MinFillLastMileRate:    f.lastMileRate,
		MinFillInterBranchRate: f.interBranchRate,
		MinFillRate:            0.40, // legado — no debe usarse cuando las nuevas están seteadas
	}
}

// fakeDispatchVolumeRepo implementa DispatchVolumeRepository en memoria.
type fakeDispatchVolumeRepo struct {
	mu     sync.Mutex
	states map[string]*time.Time // key: "origin|dest|type"
}

func newFakeDispatchVolumeRepo() *fakeDispatchVolumeRepo {
	return &fakeDispatchVolumeRepo{states: make(map[string]*time.Time)}
}

func (r *fakeDispatchVolumeRepo) key(origin, dest, tripType string) string {
	return origin + "|" + dest + "|" + tripType
}

func (r *fakeDispatchVolumeRepo) IsNotified(origin, dest, tripType string) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.states[r.key(origin, dest, tripType)]
	return ok && t != nil, nil
}

func (r *fakeDispatchVolumeRepo) SetNotified(origin, dest, tripType string, t time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.states[r.key(origin, dest, tripType)] = &t
	return nil
}

func (r *fakeDispatchVolumeRepo) ResetNotified(origin, dest, tripType string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.states[r.key(origin, dest, tripType)] = nil
	return nil
}

func (r *fakeDispatchVolumeRepo) GetAllNotified(origin string) ([]repository.DispatchVolumeState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []repository.DispatchVolumeState
	for k, t := range r.states {
		if t == nil {
			continue
		}
		// parse key
		var o, d, tt string
		parts := splitKey(k)
		if len(parts) != 3 {
			continue
		}
		o, d, tt = parts[0], parts[1], parts[2]
		if o != origin {
			continue
		}
		tc := *t
		out = append(out, repository.DispatchVolumeState{
			OriginBranchID: o, DestKey: d, TripType: tt, NotifiedAt: &tc,
		})
	}
	return out, nil
}

func splitKey(k string) []string {
	// split on first two '|'
	var parts []string
	rest := k
	for i := 0; i < 2; i++ {
		idx := indexByte(rest, '|')
		if idx < 0 {
			parts = append(parts, rest)
			return parts
		}
		parts = append(parts, rest[:idx])
		rest = rest[idx+1:]
	}
	parts = append(parts, rest)
	return parts
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// fakeNotifRepo implementa repository.NotificationRepository mínima para tests.
type fakeNotifRepo struct {
	mu    sync.Mutex
	notifs []model.Notification
	users  []model.User
}

func (r *fakeNotifRepo) Create(n model.Notification) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.notifs = append(r.notifs, n)
	return nil
}
func (r *fakeNotifRepo) ListByUser(_ string, _ repository.NotificationFilters) ([]model.Notification, int, error) {
	return nil, 0, nil
}
func (r *fakeNotifRepo) UnreadCount(_ string) (int, error)    { return 0, nil }
func (r *fakeNotifRepo) MarkRead(_, _ string) error           { return nil }
func (r *fakeNotifRepo) MarkAllRead(_ string) error           { return nil }
func (r *fakeNotifRepo) ExistsRecent(_ model.NotificationType, _ string, _ time.Time) (bool, error) {
	return false, nil
}
func (r *fakeNotifRepo) GetUsersByBranchAndRoles(branchID string, _ []model.Role) ([]model.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []model.User
	for _, u := range r.users {
		if u.BranchID == branchID {
			out = append(out, u)
		}
	}
	return out, nil
}
func (r *fakeNotifRepo) GetAdmins() ([]model.User, error) { return nil, nil }

func (r *fakeNotifRepo) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.notifs)
}

// ─── helpers de construcción ─────────────────────────────────────────────────

func makeChecker(
	ships []model.Shipment,
	vehicles []model.Vehicle,
	branches []model.Branch,
	stateRepo *fakeDispatchVolumeRepo,
	notifRepo *fakeNotifRepo,
	lastMileRate, interRate float64,
) *DispatchVolumeChecker {
	shipRepo := repository.NewInMemoryShipmentRepository()
	vehicleRepo := repository.NewInMemoryVehicleRepository()
	branchRepo := repository.NewInMemoryBranchRepository()

	for _, sh := range ships {
		_ = shipRepo // ships are seeded via Create; use alternate approach below
		_ = sh
	}
	for _, v := range vehicles {
		_ = vehicleRepo.Add(v)
	}
	for _, b := range branches {
		branchRepo.Add(b)
	}

	// Build shipment repo with pre-loaded shipments using the projection.
	realShipRepo := newFakeShipmentRepo(ships)

	return NewDispatchVolumeChecker(
		realShipRepo, vehicleRepo, branchRepo, stateRepo, notifRepo,
		&fakeDispatchRoutingCfg{lastMileRate: lastMileRate, interBranchRate: interRate},
	)
}

// fakeDispatchShipmentRepo devuelve una lista fija de envíos para tests.
type fakeDispatchShipmentRepo struct {
	ships []model.Shipment
}

func newFakeShipmentRepo(ships []model.Shipment) repository.ShipmentRepository {
	return &fakeDispatchShipmentRepo{ships: ships}
}

func (r *fakeDispatchShipmentRepo) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	var out []model.Shipment
	for _, sh := range r.ships {
		if filter.ReceivingBranchID != "" {
			loc := sh.CurrentLocation
			if loc == "" {
				loc = sh.ReceivingBranchID
			}
			if loc != filter.ReceivingBranchID {
				continue
			}
		}
		out = append(out, sh)
	}
	return out, nil
}

// stubs para cumplir la interfaz — no usados en estos tests.
func (r *fakeDispatchShipmentRepo) Create(_ repository.CreateShipmentCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) SaveDraft(_ repository.SaveDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) UpdateDraft(_ repository.UpdateDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) ConfirmDraft(_ repository.ConfirmDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) UpdateStatus(_ repository.StatusUpdateCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) ApplyCorrections(_ repository.CorrectCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) CancelShipment(_ repository.CancelCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) ExtendETA(_ repository.ExtendETACmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) RequestPayment(_ repository.RequestPaymentCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) ConfirmPayment(_ repository.ConfirmPaymentCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) RevertToDraft(_ repository.RevertToDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) RecordPathPlanned(_ repository.PathPlannedCmd) error      { return nil }
func (r *fakeDispatchShipmentRepo) SetPalletID(_, _ string) error                            { return nil }
func (r *fakeDispatchShipmentRepo) ReserveForTrip(_, _ string) error                         { return nil }
func (r *fakeDispatchShipmentRepo) ReleaseFromTrip(_ string) error                           { return nil }
func (r *fakeDispatchShipmentRepo) SetSLANotified(_ string, _ *time.Time) error              { return nil }
func (r *fakeDispatchShipmentRepo) SetSLAExpiredNotified(_ string, _ *time.Time) error       { return nil }
func (r *fakeDispatchShipmentRepo) AvgTimePerStatus(_, _ *time.Time) (model.AvgTimePerStatus, error) {
	return model.AvgTimePerStatus{}, nil
}
func (r *fakeDispatchShipmentRepo) CancellationStats(_, _ *time.Time, _ string) (model.CancellationStats, error) {
	return model.CancellationStats{}, nil
}
func (r *fakeDispatchShipmentRepo) SetConfirmationEmailSent(_ string) (bool, error)          { return true, nil }
func (r *fakeDispatchShipmentRepo) AuthenticateRecipient(_ repository.AuthenticateRecipientCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) RequestPickup(_ repository.RequestPickupCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) RescheduleDelivery(_ repository.RescheduleDeliveryCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) CancelByRecipient(_ repository.CancelByRecipientCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) GetByTrackingID(_ string) (model.Shipment, error) {
	return model.Shipment{}, nil
}
func (r *fakeDispatchShipmentRepo) Search(_ string) ([]model.Shipment, error) { return nil, nil }
func (r *fakeDispatchShipmentRepo) GetEvents(_ string) ([]model.ShipmentEvent, error) {
	return nil, nil
}
func (r *fakeDispatchShipmentRepo) Stats(_ model.ShipmentFilter) (model.Stats, error) { return model.Stats{}, nil }
func (r *fakeDispatchShipmentRepo) StatsDetail(_ string, _ *time.Time, _ *time.Time) (map[string]int, error) {
	return nil, nil
}

// ─── tests ────────────────────────────────────────────────────────────────────

// TestDispatchVolume_LastMileThresholdMet verifica que se emite notificación
// cuando el volumen de última milla alcanza la tasa mínima de al menos un vehículo.
func TestDispatchVolume_LastMileThresholdMet(t *testing.T) {
	branchID := "br-caba"
	plate := "ABC123"
	capKg := 100.0
	rate := 0.40 // umbral: 40 kg

	vehicles := []model.Vehicle{
		{
			ID: "v1", LicensePlate: plate, Mode: model.VehicleModeLastMile,
			CapacityKg: capKg, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(branchID),
		},
	}
	// 50 kg de última milla > 40 kg de umbral → debe notificar.
	ships := []model.Shipment{
		{
			TrackingID: "LT-001", Status: model.StatusAtHub,
			WeightKg: 30.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
		{
			TrackingID: "LT-002", Status: model.StatusAtHub,
			WeightKg: 20.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
	}
	notifRepo := &fakeNotifRepo{
		users: []model.User{{ID: "op1", BranchID: branchID, Role: model.RoleOperator}},
	}
	stateRepo := newFakeDispatchVolumeRepo()
	checker := makeChecker(ships, vehicles, nil, stateRepo, notifRepo, rate, rate)

	checker.Check(branchID)

	if notifRepo.count() != 1 {
		t.Errorf("esperaba 1 notificación, obtuve %d", notifRepo.count())
	}
	notified, _ := stateRepo.IsNotified(branchID, "ultima_milla", repository.TripTypeLastMile)
	if !notified {
		t.Error("esperaba que el par quedara marcado como notificado")
	}
}

// TestDispatchVolume_BelowThreshold verifica que NO se emite notificación
// cuando el volumen está por debajo del umbral.
func TestDispatchVolume_BelowThreshold(t *testing.T) {
	branchID := "br-caba"
	vehicles := []model.Vehicle{
		{
			ID: "v1", LicensePlate: "ABC123", Mode: model.VehicleModeLastMile,
			CapacityKg: 100.0, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(branchID),
		},
	}
	// 10 kg < 40 kg de umbral → NO debe notificar.
	ships := []model.Shipment{
		{
			TrackingID: "LT-003", Status: model.StatusAtHub,
			WeightKg: 10.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
	}
	notifRepo := &fakeNotifRepo{
		users: []model.User{{ID: "op1", BranchID: branchID, Role: model.RoleOperator}},
	}
	stateRepo := newFakeDispatchVolumeRepo()
	checker := makeChecker(ships, vehicles, nil, stateRepo, notifRepo, 0.40, 0.40)

	checker.Check(branchID)

	if notifRepo.count() != 0 {
		t.Errorf("no esperaba notificaciones, obtuve %d", notifRepo.count())
	}
}

// TestDispatchVolume_Deduplication verifica que no se re-notifica un par ya notificado (CA-04).
func TestDispatchVolume_Deduplication(t *testing.T) {
	branchID := "br-caba"
	vehicles := []model.Vehicle{
		{
			ID: "v1", LicensePlate: "ABC123", Mode: model.VehicleModeLastMile,
			CapacityKg: 100.0, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(branchID),
		},
	}
	ships := []model.Shipment{
		{
			TrackingID: "LT-004", Status: model.StatusAtHub,
			WeightKg: 60.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
	}
	notifRepo := &fakeNotifRepo{
		users: []model.User{{ID: "op1", BranchID: branchID, Role: model.RoleOperator}},
	}
	stateRepo := newFakeDispatchVolumeRepo()
	checker := makeChecker(ships, vehicles, nil, stateRepo, notifRepo, 0.40, 0.40)

	// Primera llamada: debe notificar.
	checker.Check(branchID)
	if notifRepo.count() != 1 {
		t.Fatalf("primer Check: esperaba 1 notificación, obtuve %d", notifRepo.count())
	}

	// Segunda llamada sin resetear: NO debe notificar de nuevo.
	checker.Check(branchID)
	if notifRepo.count() != 1 {
		t.Errorf("segundo Check (CA-04): esperaba 1 notificación, obtuve %d", notifRepo.count())
	}
}

// TestDispatchVolume_ResetAfterDispatch verifica que el estado se resetea cuando
// el volumen cae por debajo del umbral (CA-05).
func TestDispatchVolume_ResetAfterDispatch(t *testing.T) {
	branchID := "br-caba"
	vehicles := []model.Vehicle{
		{
			ID: "v1", LicensePlate: "ABC123", Mode: model.VehicleModeLastMile,
			CapacityKg: 100.0, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(branchID),
		},
	}
	notifRepo := &fakeNotifRepo{
		users: []model.User{{ID: "op1", BranchID: branchID, Role: model.RoleOperator}},
	}
	stateRepo := newFakeDispatchVolumeRepo()

	// Primer check con volumen alto → notifica.
	heavyShips := []model.Shipment{
		{
			TrackingID: "LT-005", Status: model.StatusAtHub,
			WeightKg: 60.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
	}
	checker1 := makeChecker(heavyShips, vehicles, nil, stateRepo, notifRepo, 0.40, 0.40)
	checker1.Check(branchID)

	notified, _ := stateRepo.IsNotified(branchID, "ultima_milla", repository.TripTypeLastMile)
	if !notified {
		t.Fatal("esperaba estado notificado tras primer Check")
	}

	// Simular despacho: ahora el repo tiene pocos kg (como si el envío fue despachado).
	lightShips := []model.Shipment{
		{
			TrackingID: "LT-006", Status: model.StatusAtHub,
			WeightKg: 5.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
	}
	checker2 := makeChecker(lightShips, vehicles, nil, stateRepo, notifRepo, 0.40, 0.40)
	checker2.CheckAfterDispatch(branchID)

	notifiedAfter, _ := stateRepo.IsNotified(branchID, "ultima_milla", repository.TripTypeLastMile)
	if notifiedAfter {
		t.Error("CA-05: el estado debería haberse reseteado después del despacho")
	}
}

// TestDispatchVolume_InterBranchNotification verifica notificación para despacho intersucursal.
func TestDispatchVolume_InterBranchNotification(t *testing.T) {
	originBranch := "br-caba"
	destBranch := "br-cordoba"

	vehicles := []model.Vehicle{
		{
			ID: "v2", LicensePlate: "XYZ789", Mode: model.VehicleModeInterBranch,
			CapacityKg: 500.0, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(originBranch),
		},
	}
	// 250 kg ≥ 40% de 500 kg → debe notificar.
	ships := []model.Shipment{
		{
			TrackingID: "LT-007", Status: model.StatusAtOriginHub,
			WeightKg: 130.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: originBranch, ReceivingBranchID: originBranch,
			FinalBranchID: destBranch,
		},
		{
			TrackingID: "LT-008", Status: model.StatusAtOriginHub,
			WeightKg: 120.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: originBranch, ReceivingBranchID: originBranch,
			FinalBranchID: destBranch,
		},
	}
	notifRepo := &fakeNotifRepo{
		users: []model.User{{ID: "op2", BranchID: originBranch, Role: model.RoleOperator}},
	}
	stateRepo := newFakeDispatchVolumeRepo()
	branches := []model.Branch{
		{ID: destBranch, Name: "CORD-01", Status: model.BranchStatusActive},
	}
	checker := makeChecker(ships, vehicles, branches, stateRepo, notifRepo, 0.40, 0.40)

	checker.Check(originBranch)

	if notifRepo.count() != 1 {
		t.Errorf("esperaba 1 notificación intersucursal, obtuve %d", notifRepo.count())
	}
	notified, _ := stateRepo.IsNotified(originBranch, destBranch, repository.TripTypeInterBranch)
	if !notified {
		t.Error("esperaba par intersucursal marcado como notificado")
	}
}

// TestDispatchVolume_SeparateRatesCA07 verifica CA-07: última milla y despacho
// intersucursal usan tasas independientes.
func TestDispatchVolume_SeparateRatesCA07(t *testing.T) {
	branchID := "br-caba"
	destBranch := "br-mendoza"

	vehicles := []model.Vehicle{
		{
			ID: "v-lm", LicensePlate: "LM001", Mode: model.VehicleModeLastMile,
			CapacityKg: 100.0, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(branchID),
		},
		{
			ID: "v-ib", LicensePlate: "IB001", Mode: model.VehicleModeInterBranch,
			CapacityKg: 500.0, Status: model.VehicleStatusAvailable,
			AssignedBranch: strPtr(branchID),
		},
	}
	ships := []model.Shipment{
		// 45 kg de última milla: alcanza tasa del 40% (threshold=40kg) pero NO el 60% (threshold=60kg).
		{
			TrackingID: "LT-LM", Status: model.StatusAtHub,
			WeightKg: 45.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: branchID,
		},
		// 250 kg intersucursal: alcanza tasa del 40% (threshold=200kg) pero NO el 60% (threshold=300kg).
		{
			TrackingID: "LT-IB", Status: model.StatusAtHub,
			WeightKg: 250.0, DeliveryMethod: model.DeliveryMethodLastMile,
			CurrentLocation: branchID, ReceivingBranchID: branchID,
			FinalBranchID: destBranch,
		},
	}

	t.Run("last_mile_low_rate_triggers_inter_does_not", func(t *testing.T) {
		notifRepo := &fakeNotifRepo{
			users: []model.User{{ID: "op", BranchID: branchID, Role: model.RoleOperator}},
		}
		stateRepo := newFakeDispatchVolumeRepo()
		// última milla: 40% → 45 kg alcanza 40kg → notifica
		// intersucursal: 60% → 250 kg NO alcanza 300kg → no notifica
		checker := makeChecker(ships, vehicles, []model.Branch{
			{ID: destBranch, Name: "MEND-01", Status: model.BranchStatusActive},
		}, stateRepo, notifRepo, 0.40, 0.60)

		checker.Check(branchID)

		if notifRepo.count() != 1 {
			t.Errorf("esperaba solo 1 notificación (última milla), obtuve %d", notifRepo.count())
		}
		lmNotified, _ := stateRepo.IsNotified(branchID, "ultima_milla", repository.TripTypeLastMile)
		ibNotified, _ := stateRepo.IsNotified(branchID, destBranch, repository.TripTypeInterBranch)
		if !lmNotified {
			t.Error("última milla debería estar notificada")
		}
		if ibNotified {
			t.Error("intersucursal NO debería estar notificada (CA-07)")
		}
	})

	t.Run("both_rates_met_both_notify", func(t *testing.T) {
		notifRepo := &fakeNotifRepo{
			users: []model.User{{ID: "op", BranchID: branchID, Role: model.RoleOperator}},
		}
		stateRepo := newFakeDispatchVolumeRepo()
		// ambas tasas al 40% → ambas alcanzan el umbral
		checker := makeChecker(ships, vehicles, []model.Branch{
			{ID: destBranch, Name: "MEND-01", Status: model.BranchStatusActive},
		}, stateRepo, notifRepo, 0.40, 0.40)

		checker.Check(branchID)

		if notifRepo.count() != 2 {
			t.Errorf("esperaba 2 notificaciones, obtuve %d", notifRepo.count())
		}
	})
}

// TestShipmentService_CallsDispatchCheck verifica que ShipmentService invoca Check
// cuando un envío transiciona a at_hub / at_origin_hub (CA-01/CA-02).
func TestShipmentService_CallsDispatchCheck(t *testing.T) {
	type callRecord struct {
		branchID string
	}
	calls := make(chan callRecord, 5)

	checker := &fakeDispatchVolumeNotifier{
		checkFn: func(branchID string) {
			calls <- callRecord{branchID}
		},
	}

	ts := newSetup()
	ts.svc.SetDispatchVolumeService(checker)

	// Crear envío desde br-caba.
	ship, err := ts.svc.Create(defaultCreateReq()) // at_origin_hub en br-caba
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Esperar el Check de la confirmación (at_origin_hub).
	select {
	case call := <-calls:
		if call.branchID != ship.OriginBranchID {
			t.Errorf("esperaba Check en %s, llamado en %s", ship.OriginBranchID, call.branchID)
		}
	case <-time.After(2 * time.Second):
		t.Error("timeout: Check no fue llamado tras confirmación (CA-01)")
	}

	// Llevar el envío a at_hub (llegó a sucursal intermedia).
	_ = toInTransit(t, ts, ship.TrackingID)
	ts.svc.UpdateStatus(ship.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusAtHub, Location: "br-cordoba", ChangedBy: "supervisor",
	})

	select {
	case call := <-calls:
		if call.branchID != "br-cordoba" {
			t.Errorf("esperaba Check en br-cordoba, llamado en %s", call.branchID)
		}
	case <-time.After(2 * time.Second):
		t.Error("timeout: Check no fue llamado tras at_hub (CA-02)")
	}
}

// fakeDispatchVolumeNotifier implementa DispatchVolumeNotifier para tests de integración.
type fakeDispatchVolumeNotifier struct {
	checkFn func(string)
}

func (f *fakeDispatchVolumeNotifier) Check(branchID string) {
	if f.checkFn != nil {
		f.checkFn(branchID)
	}
}
func (f *fakeDispatchVolumeNotifier) CheckAfterDispatch(branchID string) {
	if f.checkFn != nil {
		f.checkFn(branchID)
	}
}
