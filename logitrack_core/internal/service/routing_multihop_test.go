package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

// =============================================================================
// Helpers
// =============================================================================

// newMultiHopService arma un RoutingService con dependencias mínimas para
// testear consolidateCrossBranchDispatches y enforceMinSegmentUtilization.
func newMultiHopService(shipments []model.Shipment, edges []model.BranchEdge) *RoutingService {
	branches := map[string]model.Branch{
		"caba":    {ID: "caba", Status: model.BranchStatusActive},
		"cordoba": {ID: "cordoba", Status: model.BranchStatusActive},
		"mendoza": {ID: "mendoza", Status: model.BranchStatusActive},
		"rosario": {ID: "rosario", Status: model.BranchStatusActive},
	}
	branchRepo := &fakeBranchRepo{branches: branches}
	graphSvc := NewBranchGraphService(
		&fakeBranchGraphRepo{edges: edges},
		branchRepo,
	)
	return &RoutingService{
		branchRepo:   branchRepo,
		shipmentRepo: &fakeShipmentRepo{shipments: shipments},
		graphSvc:     graphSvc,
	}
}

// shipAtHub crea un envío en estado at_hub.
func shipAtHub(tid, branch, finalBranch string, weight float64) model.Shipment {
	return model.Shipment{
		TrackingID:        tid,
		Status:            model.StatusAtHub,
		ReceivingBranchID: branch,
		FinalBranchID:     finalBranch,
		WeightKg:          weight,
		DeliveryMethod:    model.DeliveryMethodLastMile,
	}
}

// =============================================================================
// consolidateCrossBranchDispatches
// =============================================================================

func TestConsolidate_AbsorbsSingleHopIntoMultiHop(t *testing.T) {
	// A: CABA → Córdoba → Mendoza (1500 cap, 500 a Córdoba, 100 a Mendoza)
	// B: Córdoba → Mendoza single-hop con 2 envíos de 100 kg c/u
	// Esperado: B absorbido, A.PrimaryPickupShipments = [LT-B1, LT-B2] (200 kg),
	// A.AdditionalStops[0].Shipments += [LT-B1, LT-B2] (Mendoza dropoff).
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 500),
		shipAtHub("LT-MZ1", "caba", "mendoza", 100),
		shipAtHub("LT-B1", "cordoba", "mendoza", 100),
		shipAtHub("LT-B2", "cordoba", "mendoza", 100),
	}
	svc := newMultiHopService(shipments, nil)

	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     600,
					CapacityKg:        1500,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 100},
					},
				},
			},
		},
		"cordoba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-COR",
					DestinationBranch: "mendoza",
					Shipments:         []string{"LT-B1", "LT-B2"},
					TotalWeightKg:     200,
					CapacityKg:        1000,
				},
			},
		},
	})

	svc.consolidateCrossBranchDispatches(plan, model.DefaultRoutingConfig())

	// El dispatch B debe haber desaparecido del plan de Córdoba.
	corPlan := findBranchPlan(plan, "cordoba")
	if corPlan == nil || len(corPlan.InterBranch) != 0 {
		t.Fatalf("expected 0 dispatches en Córdoba tras consolidación, got %+v", corPlan.InterBranch)
	}
	// Los envíos de B vuelven a unassigned con motivo consolidado_en_viaje_multi_hop
	if len(corPlan.Unassigned) != 2 {
		t.Errorf("expected 2 unassigned en Córdoba, got %d", len(corPlan.Unassigned))
	}
	for _, u := range corPlan.Unassigned {
		if u.Reason != "consolidado_en_viaje_multi_hop" {
			t.Errorf("expected reason consolidado_en_viaje_multi_hop, got %s", u.Reason)
		}
	}

	// El dispatch A debe tener PrimaryPickupShipments + dropoffs extras en Mendoza
	cabaPlan := findBranchPlan(plan, "caba")
	if cabaPlan == nil || len(cabaPlan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch en CABA, got %+v", cabaPlan)
	}
	A := cabaPlan.InterBranch[0]
	if len(A.PrimaryPickupShipments) != 2 {
		t.Errorf("expected 2 primary pickups, got %v", A.PrimaryPickupShipments)
	}
	if A.PrimaryPickupWeightKg != 200 {
		t.Errorf("expected primary pickup weight 200, got %.1f", A.PrimaryPickupWeightKg)
	}
	if len(A.AdditionalStops) != 1 {
		t.Fatalf("expected 1 additional stop, got %d", len(A.AdditionalStops))
	}
	mendozaStop := A.AdditionalStops[0]
	if len(mendozaStop.Shipments) != 3 { // LT-MZ1 + LT-B1 + LT-B2
		t.Errorf("expected 3 dropoffs en Mendoza, got %v", mendozaStop.Shipments)
	}
	if mendozaStop.TotalWeightKg != 300 {
		t.Errorf("expected mendoza dropoff weight 300, got %.1f", mendozaStop.TotalWeightKg)
	}
	if A.TotalWeightKg != 800 { // 600 + 200
		t.Errorf("expected A total weight 800, got %.1f", A.TotalWeightKg)
	}
}

func TestConsolidate_RejectsWhenBExceedsAvailableCapacityInSegment(t *testing.T) {
	// A: cap 200. Primary CABA→Córdoba con 150 kg, additional Mendoza con 30 kg.
	// Al salir de Córdoba: 150 - 150 + 0 (no primary pickup) = 0, luego carga el dropoff
	// de Mendoza... espera, el peso DURANTE el tramo es lo que el vehículo lleva.
	// Carga inicial: 150 + 30 = 180.
	// Después de drop primary (150): 30.
	// Tramo Córdoba→Mendoza: 30 kg encima.
	// B trae 200 kg más → 230. Pero capacity es 200 → NO entra.
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 150),
		shipAtHub("LT-MZ1", "caba", "mendoza", 30),
		shipAtHub("LT-B1", "cordoba", "mendoza", 200),
	}
	svc := newMultiHopService(shipments, nil)
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     180,
					CapacityKg:        200,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 30},
					},
				},
			},
		},
		"cordoba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-COR",
					DestinationBranch: "mendoza",
					Shipments:         []string{"LT-B1"},
					TotalWeightKg:     200,
					CapacityKg:        500,
				},
			},
		},
	})

	svc.consolidateCrossBranchDispatches(plan, model.DefaultRoutingConfig())

	corPlan := findBranchPlan(plan, "cordoba")
	if len(corPlan.InterBranch) != 1 {
		t.Errorf("expected B sigue en Córdoba (no entra capacidad), got %d", len(corPlan.InterBranch))
	}
	cabaPlan := findBranchPlan(plan, "caba")
	if len(cabaPlan.InterBranch[0].PrimaryPickupShipments) > 0 {
		t.Errorf("A no debería tener pickups primary, got %v", cabaPlan.InterBranch[0].PrimaryPickupShipments)
	}
}

func TestConsolidate_RejectsIfBIsMultiHop(t *testing.T) {
	// B es multi-hop (tiene additional stops). No se consolida.
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 100),
		shipAtHub("LT-MZ1", "caba", "mendoza", 100),
		shipAtHub("LT-B1", "cordoba", "mendoza", 50),
		shipAtHub("LT-B2", "cordoba", "rosario", 50),
	}
	svc := newMultiHopService(shipments, nil)
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     200,
					CapacityKg:        2000,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 100},
					},
				},
			},
		},
		"cordoba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-COR",
					DestinationBranch: "mendoza",
					Shipments:         []string{"LT-B1", "LT-B2"},
					TotalWeightKg:     100,
					CapacityKg:        500,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "rosario", Shipments: []string{"LT-B2"}, TotalWeightKg: 50},
					},
				},
			},
		},
	})

	svc.consolidateCrossBranchDispatches(plan, model.DefaultRoutingConfig())

	corPlan := findBranchPlan(plan, "cordoba")
	if len(corPlan.InterBranch) != 1 {
		t.Errorf("B multi-hop no debería consolidarse, got %d en Córdoba", len(corPlan.InterBranch))
	}
}

func TestConsolidate_RejectsIfBOriginNotInAPath(t *testing.T) {
	// A: CABA → Córdoba (single-hop). B: Rosario → Mendoza. Rosario no está en path de A.
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 100),
		shipAtHub("LT-B1", "rosario", "mendoza", 50),
	}
	svc := newMultiHopService(shipments, nil)
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1"},
					TotalWeightKg:     100,
					CapacityKg:        1000,
					// Sin additional stops: A no es multi-hop → no se busca consolidación
				},
			},
		},
		"rosario": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-ROS",
					DestinationBranch: "mendoza",
					Shipments:         []string{"LT-B1"},
					TotalWeightKg:     50,
					CapacityKg:        500,
				},
			},
		},
	})

	svc.consolidateCrossBranchDispatches(plan, model.DefaultRoutingConfig())
	rosPlan := findBranchPlan(plan, "rosario")
	if len(rosPlan.InterBranch) != 1 {
		t.Errorf("B en Rosario no debería consolidarse (A es single-hop), got %d", len(rosPlan.InterBranch))
	}
}

// newMultiHopServiceWithCoords es como newMultiHopService pero setea lat/lng
// en caba/cordoba/mendoza para tener un branchDistance determinístico
// (necesario para validar el SLA safety check).
func newMultiHopServiceWithCoords(shipments []model.Shipment) *RoutingService {
	lat0, lat1, lat2 := 0.0, 1.0, 2.0
	lng := 0.0
	branches := map[string]model.Branch{
		"caba":    {ID: "caba", Status: model.BranchStatusActive, Latitude: &lat0, Longitude: &lng},
		"cordoba": {ID: "cordoba", Status: model.BranchStatusActive, Latitude: &lat1, Longitude: &lng},
		"mendoza": {ID: "mendoza", Status: model.BranchStatusActive, Latitude: &lat2, Longitude: &lng},
	}
	branchRepo := &fakeBranchRepo{branches: branches}
	graphSvc := NewBranchGraphService(&fakeBranchGraphRepo{edges: nil}, branchRepo)
	return &RoutingService{
		branchRepo:   branchRepo,
		shipmentRepo: &fakeShipmentRepo{shipments: shipments},
		graphSvc:     graphSvc,
	}
}

func TestConsolidate_RejectsWhenBHasSLACriticalShipmentThatBreachesViaARoute(t *testing.T) {
	// Setup: A: CABA → Córdoba → Mendoza. B: Córdoba → Mendoza, single-hop, con un envío SLA-crítico.
	// Distancia total CABA→Córdoba→Mendoza ≈ 2 × 111 km × 1.3 detour = 288.6 km.
	// A 25 km/h → ~11.5h. Si el envío SLA-crítico vence en 5h, la ruta de A
	// rompería el SLA y la consolidación debe rechazarse.
	now := clock.Now()
	slaDeadline := now.Add(5 * time.Hour)
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 100),
		shipAtHub("LT-MZ1", "caba", "mendoza", 50),
		{
			TrackingID:          "LT-B1",
			Status:              model.StatusAtHub,
			ReceivingBranchID:   "cordoba",
			FinalBranchID:       "mendoza",
			WeightKg:            50,
			DeliveryMethod:      model.DeliveryMethodLastMile,
			EstimatedDeliveryAt: &slaDeadline,
		},
	}
	svc := newMultiHopServiceWithCoords(shipments)
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     150,
					CapacityKg:        2000,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 50},
					},
				},
			},
		},
		"cordoba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-COR",
					DestinationBranch: "mendoza",
					Shipments:         []string{"LT-B1"},
					TotalWeightKg:     50,
					CapacityKg:        500,
				},
			},
		},
	})

	svc.consolidateCrossBranchDispatches(plan, model.DefaultRoutingConfig())

	corPlan := findBranchPlan(plan, "cordoba")
	if len(corPlan.InterBranch) != 1 {
		t.Fatalf("B con SLA crítico no debería consolidarse — debería seguir como dispatch independiente, got %d", len(corPlan.InterBranch))
	}
	cabaPlan := findBranchPlan(plan, "caba")
	if len(cabaPlan.InterBranch[0].PrimaryPickupShipments) > 0 {
		t.Errorf("A no debería tener pickups (B preservado), got %v", cabaPlan.InterBranch[0].PrimaryPickupShipments)
	}
}

func TestConsolidate_AbsorbsWhenSLAFitsInARoute(t *testing.T) {
	// Mismo setup que el test anterior, pero el SLA del envío vence en 48h:
	// está dentro del horizonte forzado (24h) NO, así que no aplica la verificación
	// — se absorbe normalmente. Caso de control: cuando ningún envío de B es
	// SLA-crítico, el comportamiento previo se mantiene.
	now := clock.Now()
	farDeadline := now.Add(48 * time.Hour)
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 100),
		shipAtHub("LT-MZ1", "caba", "mendoza", 50),
		{
			TrackingID:          "LT-B1",
			Status:              model.StatusAtHub,
			ReceivingBranchID:   "cordoba",
			FinalBranchID:       "mendoza",
			WeightKg:            50,
			DeliveryMethod:      model.DeliveryMethodLastMile,
			EstimatedDeliveryAt: &farDeadline,
		},
	}
	svc := newMultiHopServiceWithCoords(shipments)
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     150,
					CapacityKg:        2000,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 50},
					},
				},
			},
		},
		"cordoba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-COR",
					DestinationBranch: "mendoza",
					Shipments:         []string{"LT-B1"},
					TotalWeightKg:     50,
					CapacityKg:        500,
				},
			},
		},
	})

	svc.consolidateCrossBranchDispatches(plan, model.DefaultRoutingConfig())

	corPlan := findBranchPlan(plan, "cordoba")
	if len(corPlan.InterBranch) != 0 {
		t.Errorf("B sin SLA crítico debería consolidarse, sigue en Córdoba: %d", len(corPlan.InterBranch))
	}
}

// =============================================================================
// enforceMinSegmentUtilization
// =============================================================================

func TestEnforce_RemovesLowUtilStop(t *testing.T) {
	// A: CABA → Córdoba → Mendoza
	// Capacidad 1000. CABA→Córdoba lleva 1000 (full). Córdoba→Mendoza lleva 50 kg.
	// Utilización del tramo Córdoba→Mendoza = 50/1000 = 5% < 40%.
	// Esperado: se elimina la parada Mendoza, LT-MZ1 va a unassigned.
	now := clock.Now()
	_ = now
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 950),
		shipAtHub("LT-MZ1", "caba", "mendoza", 50),
	}
	svc := newMultiHopService(shipments, nil)
	cfg := model.DefaultRoutingConfig() // MinFillRate = 0.40
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     1000,
					CapacityKg:        1000,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 50},
					},
				},
			},
		},
	})
	svc.enforceMinSegmentUtilization(plan, cfg)

	cabaPlan := findBranchPlan(plan, "caba")
	A := cabaPlan.InterBranch[0]
	if len(A.AdditionalStops) != 0 {
		t.Errorf("expected 0 additional stops tras enforce, got %d", len(A.AdditionalStops))
	}
	if A.DestinationBranch != "cordoba" {
		t.Errorf("primary destination debe seguir siendo cordoba, got %s", A.DestinationBranch)
	}
	if len(cabaPlan.Unassigned) != 1 {
		t.Fatalf("expected 1 unassigned, got %d", len(cabaPlan.Unassigned))
	}
	if cabaPlan.Unassigned[0].Reason != "tramo_subutilizado" {
		t.Errorf("expected reason tramo_subutilizado, got %s", cabaPlan.Unassigned[0].Reason)
	}
	if cabaPlan.Unassigned[0].TrackingID != "LT-MZ1" {
		t.Errorf("expected unassigned LT-MZ1, got %s", cabaPlan.Unassigned[0].TrackingID)
	}
	// Shipments del dispatch debe haber quitado LT-MZ1
	for _, tid := range A.Shipments {
		if tid == "LT-MZ1" {
			t.Errorf("LT-MZ1 no debería estar en A.Shipments")
		}
	}
}

func TestEnforce_KeepsStopIfSLAForced(t *testing.T) {
	// Mismo escenario que arriba, pero LT-MZ1 tiene SLA en 2 horas → forzado.
	soon := clock.Now().Add(2 * time.Hour)
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 950),
		{
			TrackingID:          "LT-MZ1",
			Status:              model.StatusAtHub,
			ReceivingBranchID:   "caba",
			FinalBranchID:       "mendoza",
			WeightKg:            50,
			DeliveryMethod:      model.DeliveryMethodLastMile,
			EstimatedDeliveryAt: &soon,
		},
	}
	svc := newMultiHopService(shipments, nil)
	cfg := model.DefaultRoutingConfig()
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     1000,
					CapacityKg:        1000,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 50},
					},
				},
			},
		},
	})
	svc.enforceMinSegmentUtilization(plan, cfg)

	A := findBranchPlan(plan, "caba").InterBranch[0]
	if len(A.AdditionalStops) != 1 {
		t.Errorf("SLA forzado debería preservar la parada, got %d stops", len(A.AdditionalStops))
	}
}

func TestEnforce_KeepsStopIfUtilizationOk(t *testing.T) {
	// Tramo Córdoba→Mendoza con 50% de utilización (500/1000). OK.
	shipments := []model.Shipment{
		shipAtHub("LT-CB1", "caba", "cordoba", 500),
		shipAtHub("LT-MZ1", "caba", "mendoza", 500),
	}
	svc := newMultiHopService(shipments, nil)
	cfg := model.DefaultRoutingConfig()
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{
					VehicleID:         "V-CABA",
					DestinationBranch: "cordoba",
					Shipments:         []string{"LT-CB1", "LT-MZ1"},
					TotalWeightKg:     1000,
					CapacityKg:        1000,
					AdditionalStops: []model.AssignmentStop{
						{BranchID: "mendoza", Shipments: []string{"LT-MZ1"}, TotalWeightKg: 500},
					},
				},
			},
		},
	})
	svc.enforceMinSegmentUtilization(plan, cfg)

	A := findBranchPlan(plan, "caba").InterBranch[0]
	if len(A.AdditionalStops) != 1 {
		t.Errorf("tramo válido debería preservarse, got %d stops", len(A.AdditionalStops))
	}
}

// =============================================================================
// Helpers locales
// =============================================================================

func findBranchPlan(plan *model.GlobalRoutingPlan, branchID string) *model.RoutingPlan {
	for i := range plan.BranchPlans {
		if plan.BranchPlans[i].BranchID == branchID {
			return &plan.BranchPlans[i].Plan
		}
	}
	return nil
}
