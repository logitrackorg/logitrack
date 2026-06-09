package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

// fakeVehicleRepo implementa VehicleRepository para testing.
type fakeVehicleRepo struct {
	vehicles []model.Vehicle
}

func (f *fakeVehicleRepo) List() []model.Vehicle { return f.vehicles }
func (f *fakeVehicleRepo) Add(v model.Vehicle) error {
	f.vehicles = append(f.vehicles, v)
	return nil
}
func (f *fakeVehicleRepo) GetByID(id string) (model.Vehicle, bool) {
	for _, v := range f.vehicles {
		if v.ID == id {
			return v, true
		}
	}
	return model.Vehicle{}, false
}
func (f *fakeVehicleRepo) GetByLicensePlate(p string) (model.Vehicle, bool) {
	for _, v := range f.vehicles {
		if v.LicensePlate == p {
			return v, true
		}
	}
	return model.Vehicle{}, false
}
func (f *fakeVehicleRepo) UpdateStatus(id string, s model.VehicleStatus) error { return nil }
func (f *fakeVehicleRepo) UpdateStatusByUser(id string, s model.VehicleStatus, u string) error {
	return nil
}
func (f *fakeVehicleRepo) AddShipment(id, tid string) error          { return nil }
func (f *fakeVehicleRepo) RemoveShipment(id, tid string) error       { return nil }
func (f *fakeVehicleRepo) ClearShipments(id string) error            { return nil }
func (f *fakeVehicleRepo) AssignBranch(id string, b *string) error   { return nil }
func (f *fakeVehicleRepo) SetDestinationBranch(id string, b *string) error {
	return nil
}
func (f *fakeVehicleRepo) UpdateLocation(id string, lat, lng float64) error { return nil }
func (f *fakeVehicleRepo) GetByQRToken(token string) (model.Vehicle, bool) {
	for _, v := range f.vehicles {
		if v.QRToken == token {
			return v, true
		}
	}
	return model.Vehicle{}, false
}
func (f *fakeVehicleRepo) RotateQRToken(id string) (string, error) { return "new-token", nil }
func (f *fakeVehicleRepo) SyncMode(licensePlate string, mode model.VehicleMode) error {
	for i, v := range f.vehicles {
		if v.LicensePlate == licensePlate {
			f.vehicles[i].Mode = mode
			return nil
		}
	}
	return nil
}

// =============================================================================
// matchBackhauls — verifica el fix de capacidad completa
// =============================================================================

// fakeShipmentRepoWithData extiende fakeShipmentRepo para devolver una lista
// específica desde List. (fakeShipmentRepo ya define List(); reutilizamos su
// campo shipments seteándolo en el constructor.)

func TestMatchBackhauls_UsesFullVehicleCapacityNotOutboundRemainder(t *testing.T) {
	// Despacho saliente: vehículo 500 kg, lleva 400 kg a Córdoba.
	// Si usáramos `capacity - outbound = 100 kg`, solo cabrían envíos de retorno
	// pequeños. Con el fix usando capacidad COMPLETA (500 kg), cabe todo el retorno.
	plan := &model.RoutingPlan{
		InterBranch: []model.InterBranchAssignment{
			{
				VehicleID:         "V1",
				LicensePlate:      "AA111AA",
				DestinationBranch: "cordoba",
				Shipments:         []string{"LT-OUT1"},
				TotalWeightKg:     400,
				ExistingWeightKg:  0,
				CapacityKg:        500,
			},
		},
	}

	// Envíos en Córdoba con destino CABA (retorno). Suma 300 kg.
	// Con el bug viejo (available=100kg), solo entraría el primero (100kg).
	// Con el fix (available=500kg), entran los tres.
	shipmentsAtCordoba := []model.Shipment{
		{TrackingID: "LT-RET1", Status: model.StatusAtHub, ReceivingBranchID: "cordoba", FinalBranchID: "caba", NextHopBranchID: "caba", WeightKg: 100, DeliveryMethod: model.DeliveryMethodLastMile},
		{TrackingID: "LT-RET2", Status: model.StatusAtHub, ReceivingBranchID: "cordoba", FinalBranchID: "caba", NextHopBranchID: "caba", WeightKg: 100, DeliveryMethod: model.DeliveryMethodLastMile},
		{TrackingID: "LT-RET3", Status: model.StatusAtHub, ReceivingBranchID: "cordoba", FinalBranchID: "caba", NextHopBranchID: "caba", WeightKg: 100, DeliveryMethod: model.DeliveryMethodLastMile},
	}

	svc := &RoutingService{
		shipmentRepo: &fakeShipmentRepo{shipments: shipmentsAtCordoba},
	}

	svc.matchBackhauls(plan, "caba")

	bh := plan.InterBranch[0].Backhaul
	if bh == nil {
		t.Fatal("backhaul debería existir")
	}
	if len(bh.Shipments) != 3 {
		t.Errorf("esperado 3 envíos de backhaul (capacidad COMPLETA del vehículo), got %d", len(bh.Shipments))
	}
	if bh.TotalWeightKg != 300 {
		t.Errorf("peso total backhaul esperado 300, got %.1f", bh.TotalWeightKg)
	}
	// fill_rate = 300 / 500 = 60%
	if bh.FillRatePct < 59 || bh.FillRatePct > 61 {
		t.Errorf("fill_rate_pct esperado ~60, got %.1f", bh.FillRatePct)
	}
}

func TestMatchBackhauls_RespectsVehicleCapacityCeiling(t *testing.T) {
	// Vehículo de 200 kg, candidates suman 350 kg. Solo deben entrar 2 de 3.
	plan := &model.RoutingPlan{
		InterBranch: []model.InterBranchAssignment{
			{
				VehicleID:         "V1",
				DestinationBranch: "cordoba",
				CapacityKg:        200,
			},
		},
	}
	shipmentsAtCordoba := []model.Shipment{
		{TrackingID: "LT-R1", Status: model.StatusAtHub, ReceivingBranchID: "cordoba", NextHopBranchID: "caba", WeightKg: 100, DeliveryMethod: model.DeliveryMethodLastMile},
		{TrackingID: "LT-R2", Status: model.StatusAtHub, ReceivingBranchID: "cordoba", NextHopBranchID: "caba", WeightKg: 100, DeliveryMethod: model.DeliveryMethodLastMile},
		{TrackingID: "LT-R3", Status: model.StatusAtHub, ReceivingBranchID: "cordoba", NextHopBranchID: "caba", WeightKg: 150, DeliveryMethod: model.DeliveryMethodLastMile},
	}
	svc := &RoutingService{shipmentRepo: &fakeShipmentRepo{shipments: shipmentsAtCordoba}}

	svc.matchBackhauls(plan, "caba")

	bh := plan.InterBranch[0].Backhaul
	if bh == nil {
		t.Fatal("backhaul debería existir con 2 envíos")
	}
	if bh.TotalWeightKg > 200 {
		t.Errorf("backhaul no debe exceder capacidad: total=%.1f cap=200", bh.TotalWeightKg)
	}
}

// =============================================================================
// tryProjectedDispatch — verifica el fix de filtrado por reason
// =============================================================================

func TestTryProjectedDispatch_OnlyRescuesNoVehicleReasons(t *testing.T) {
	now := mustParseTime("2026-05-13T10:00:00Z")
	arrivalIn3h := now.Add(3 * time.Hour)

	plan := &model.RoutingPlan{
		IncomingVehicles: []model.IncomingVehicle{
			{
				VehicleID:          "VPROJ",
				LicensePlate:       "BB222BB",
				CapacityKg:         1000,
				EstimatedArrivalAt: &arrivalIn3h,
			},
		},
		Unassigned: []model.UnassignedShipment{
			{TrackingID: "LT-WAIT", Destination: "mendoza", Reason: "esperando_consolidacion", WeightKg: 50},
			{TrackingID: "LT-NOVEH", Destination: "cordoba", Reason: "sin_vehiculos_disponibles", WeightKg: 100},
			{TrackingID: "LT-OVERSIZE", Destination: "posadas", Reason: "sobrepeso_excede_vehiculo", WeightKg: 5000},
		},
	}

	graphSvc := NewBranchGraphService(
		&fakeBranchGraphRepo{},
		&fakeBranchRepo{branches: map[string]model.Branch{}},
	)
	vehicles := []model.Vehicle{
		{ID: "VPROJ", LicensePlate: "BB222BB", CapacityKg: 1000, Status: model.VehicleStatusInTransit},
	}
	svc := &RoutingService{
		vehicleRepo: &fakeVehicleRepo{vehicles: vehicles},
		graphSvc:    graphSvc,
	}
	cfg := model.RoutingConfig{FleetProjectionHorizonHours: 8}

	svc.tryProjectedDispatch(plan, "caba", cfg, now)

	// Solo "sin_vehiculos_disponibles" debe haberse rescatado (cordoba dispatch nuevo)
	if len(plan.InterBranch) != 1 {
		t.Fatalf("esperado 1 dispatch nuevo (solo sin_vehiculos_*), got %d", len(plan.InterBranch))
	}
	if plan.InterBranch[0].DestinationBranch != "cordoba" {
		t.Errorf("dispatch esperado a cordoba, got %s", plan.InterBranch[0].DestinationBranch)
	}

	// Los otros 2 deben seguir unassigned (esperando_consolidacion + sobrepeso)
	if len(plan.Unassigned) != 2 {
		t.Fatalf("esperado 2 sigan unassigned, got %d", len(plan.Unassigned))
	}
	for _, u := range plan.Unassigned {
		if u.Reason == "sin_vehiculos_disponibles" {
			t.Errorf("sin_vehiculos_disponibles debería haberse rescatado, no quedar en unassigned")
		}
	}
}
