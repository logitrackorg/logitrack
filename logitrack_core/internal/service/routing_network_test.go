package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// Helper: arma un GlobalRoutingPlan minimal con las branches y sus dispatches/unassigned
func newGlobalPlan(branches map[string]model.RoutingPlan) *model.GlobalRoutingPlan {
	bp := make([]model.BranchPlan, 0, len(branches))
	for id, plan := range branches {
		bp = append(bp, model.BranchPlan{BranchID: id, Plan: plan})
	}
	return &model.GlobalRoutingPlan{BranchPlans: bp}
}

// Helper para crear RoutingService con branchRepo (necesario para branchDistance)
func newNetworkTestService() *RoutingService {
	cabaLat, cabaLng := -34.6037, -58.3816
	cordLat, cordLng := -31.4201, -64.1888
	mendLat, mendLng := -32.8908, -68.8272
	branchRepo := &fakeBranchRepo{branches: map[string]model.Branch{
		"caba":    {ID: "caba", Latitude: &cabaLat, Longitude: &cabaLng, Province: "Buenos Aires"},
		"cordoba": {ID: "cordoba", Latitude: &cordLat, Longitude: &cordLng, Province: "Córdoba"},
		"mendoza": {ID: "mendoza", Latitude: &mendLat, Longitude: &mendLng, Province: "Mendoza"},
	}}
	return &RoutingService{branchRepo: branchRepo}
}

// =============================================================================
// detectEmptyMoves
// =============================================================================

func TestDetectEmptyMoves_SuggestsClosestIdleVehicleToNeedyBranch(t *testing.T) {
	// CABA tiene 1 envío unassigned por falta de vehículo.
	// Córdoba tiene un vehículo ocioso (en pool pero no en dispatches).
	// Mendoza tiene otro ocioso pero está más lejos.
	// Debería sugerir Córdoba → CABA.
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			Unassigned: []model.UnassignedShipment{
				{TrackingID: "LT-X", Reason: "sin_vehiculos_disponibles", Destination: "mendoza"},
			},
		},
		"cordoba": {
			VehicleLoads: []model.VehicleLoad{
				{VehicleID: "V-COR", LicensePlate: "AA111AA", CapacityKg: 500},
			},
		},
		"mendoza": {
			VehicleLoads: []model.VehicleLoad{
				{VehicleID: "V-MEN", LicensePlate: "BB222BB", CapacityKg: 500},
			},
		},
	})

	svc := newNetworkTestService()
	insights := model.NetworkInsights{}
	svc.detectEmptyMoves(plan, &insights)

	if len(insights.EmptyMoves) != 1 {
		t.Fatalf("esperado 1 empty move, got %d", len(insights.EmptyMoves))
	}
	mv := insights.EmptyMoves[0]
	if mv.FromBranchID != "cordoba" {
		t.Errorf("esperado fromBranch=cordoba (más cerca de CABA que mendoza), got %s", mv.FromBranchID)
	}
	if mv.ToBranchID != "caba" {
		t.Errorf("esperado toBranch=caba, got %s", mv.ToBranchID)
	}
	if mv.UnservedShipments != 1 {
		t.Errorf("esperado UnservedShipments=1, got %d", mv.UnservedShipments)
	}
}

func TestDetectEmptyMoves_NoSuggestionWhenNoUnservedDemand(t *testing.T) {
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			Unassigned: []model.UnassignedShipment{
				// Motivo NO es sin_vehiculos_* → no es candidato para empty move
				{TrackingID: "LT-X", Reason: "esperando_consolidacion"},
			},
		},
		"cordoba": {
			VehicleLoads: []model.VehicleLoad{{VehicleID: "V1", CapacityKg: 500}},
		},
	})
	svc := newNetworkTestService()
	insights := model.NetworkInsights{}
	svc.detectEmptyMoves(plan, &insights)
	if len(insights.EmptyMoves) != 0 {
		t.Errorf("no se esperaban empty moves para esperando_consolidacion, got %d", len(insights.EmptyMoves))
	}
}

func TestDetectEmptyMoves_ExcludesUsedVehicles(t *testing.T) {
	// Vehículo está en VehicleLoads (pool) Y en InterBranch (despachado) → no es ocioso.
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			Unassigned: []model.UnassignedShipment{
				{TrackingID: "LT-X", Reason: "sin_vehiculos_para_destino"},
			},
		},
		"cordoba": {
			VehicleLoads: []model.VehicleLoad{{VehicleID: "V-COR", CapacityKg: 500}},
			InterBranch: []model.InterBranchAssignment{
				{VehicleID: "V-COR", DestinationBranch: "rosario"},
			},
		},
	})
	svc := newNetworkTestService()
	insights := model.NetworkInsights{}
	svc.detectEmptyMoves(plan, &insights)
	if len(insights.EmptyMoves) != 0 {
		t.Errorf("vehículo ya despachado no debe sugerirse como ocioso, got %d empty moves", len(insights.EmptyMoves))
	}
}

// =============================================================================
// detectConsolidationOpportunities
// =============================================================================

func TestDetectConsolidationOpportunities_SameDestinationFromMultipleBranches(t *testing.T) {
	// CABA y Mendoza ambos despachan a Córdoba con baja utilización → oportunidad
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{VehicleID: "V-CABA", LicensePlate: "AA111AA", DestinationBranch: "cordoba", TotalWeightKg: 100, CapacityKg: 500},
			},
		},
		"mendoza": {
			InterBranch: []model.InterBranchAssignment{
				{VehicleID: "V-MEN", LicensePlate: "BB222BB", DestinationBranch: "cordoba", TotalWeightKg: 150, CapacityKg: 500},
			},
		},
	})
	svc := newNetworkTestService()
	insights := model.NetworkInsights{}
	svc.detectConsolidationOpportunities(plan, &insights)

	if len(insights.ConsolidationOpportunities) != 1 {
		t.Fatalf("esperado 1 oportunidad de consolidación, got %d", len(insights.ConsolidationOpportunities))
	}
	c := insights.ConsolidationOpportunities[0]
	if c.DestinationBranchID != "cordoba" {
		t.Errorf("destino esperado cordoba, got %s", c.DestinationBranchID)
	}
	if len(c.Dispatches) != 2 {
		t.Errorf("esperado 2 dispatches, got %d", len(c.Dispatches))
	}
	if c.TotalWeightKg != 250 {
		t.Errorf("peso total esperado 250, got %.1f", c.TotalWeightKg)
	}
}

func TestDetectConsolidationOpportunities_NoOpportunityWhenSingleBranch(t *testing.T) {
	// Solo CABA despacha a Córdoba → no hay oportunidad cross-branch
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{VehicleID: "V1", DestinationBranch: "cordoba", TotalWeightKg: 100, CapacityKg: 500},
			},
		},
	})
	svc := newNetworkTestService()
	insights := model.NetworkInsights{}
	svc.detectConsolidationOpportunities(plan, &insights)
	if len(insights.ConsolidationOpportunities) != 0 {
		t.Errorf("un solo despacho no es oportunidad, got %d", len(insights.ConsolidationOpportunities))
	}
}

// =============================================================================
// computeNetworkMetrics
// =============================================================================

func TestComputeNetworkMetrics_SumsAcrossBranches(t *testing.T) {
	plan := newGlobalPlan(map[string]model.RoutingPlan{
		"caba": {
			InterBranch: []model.InterBranchAssignment{
				{VehicleID: "V1", Shipments: []string{"A", "B"}, TotalWeightKg: 250, CapacityKg: 500},
			},
			LastMile: []model.LastMileAssignment{
				{VehicleID: "LM1", LicensePlate: "LM1", Shipments: []string{"C", "D", "E"}},
			},
			Unassigned: []model.UnassignedShipment{
				{TrackingID: "F", Reason: "sin_vehiculos_disponibles"},
			},
			VehicleLoads: []model.VehicleLoad{
				{VehicleID: "V1"}, // usado
				{VehicleID: "V2"}, // idle
			},
		},
		"cordoba": {
			InterBranch: []model.InterBranchAssignment{
				{VehicleID: "V3", Shipments: []string{"G"}, TotalWeightKg: 400, CapacityKg: 500},
			},
			VehicleLoads: []model.VehicleLoad{{VehicleID: "V3"}},
		},
	})
	svc := newNetworkTestService()
	m := svc.computeNetworkMetrics(plan)

	if m.TotalVehiclesDispatched != 2 {
		t.Errorf("vehículos despachados esperado 2, got %d", m.TotalVehiclesDispatched)
	}
	if m.TotalShipmentsAssigned != 6 {
		t.Errorf("envíos asignados esperado 6, got %d", m.TotalShipmentsAssigned)
	}
	if m.TotalShipmentsUnassigned != 1 {
		t.Errorf("envíos unassigned esperado 1, got %d", m.TotalShipmentsUnassigned)
	}
	if m.IdleVehiclesCount != 1 {
		t.Errorf("vehículos ociosos esperado 1, got %d", m.IdleVehiclesCount)
	}
	if m.BranchesWithUnservedDemand != 1 {
		t.Errorf("sucursales con demanda no atendida esperado 1, got %d", m.BranchesWithUnservedDemand)
	}
	// Util prom: V1=50%, V3=80% → avg 65
	if m.AvgVehicleUtilizationPct < 64 || m.AvgVehicleUtilizationPct > 66 {
		t.Errorf("util prom esperado ~65, got %.1f", m.AvgVehicleUtilizationPct)
	}
}
