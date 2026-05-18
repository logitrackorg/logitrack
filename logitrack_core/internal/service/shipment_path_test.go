package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// newTestShipmentSvc arma un ShipmentService minimal con graphSvc inyectado.
func newTestShipmentSvc(edges []model.BranchEdge, branches map[string]model.Branch) (*ShipmentService, *fakeShipmentRepo) {
	repo := &fakeShipmentRepo{}
	svc := &ShipmentService{repo: repo}
	graphSvc := NewBranchGraphService(
		&fakeBranchGraphRepo{edges: edges},
		&fakeBranchRepo{branches: branches},
	)
	svc.SetBranchGraphService(graphSvc)
	return svc, repo
}

// TestMaybeRecordPath_HopAdvance_PreservesHistory verifica el fix del bug donde
// hop_advance recomputaba el path desde la posición actual, perdiendo los hubs
// anteriores. Después del fix, hop_advance debe preservar el path original y
// solo avanzar el hop_index.
func TestMaybeRecordPath_HopAdvance_PreservesHistory(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
	}
	svc, repo := newTestShipmentSvc(edges, map[string]model.Branch{
		"caba":    {ID: "caba"},
		"cordoba": {ID: "cordoba"},
		"mendoza": {ID: "mendoza"},
	})

	// Envío llegó a Córdoba como hub intermedio. Path original: [caba, cordoba, mendoza]
	sh := model.Shipment{
		TrackingID:        "LT-X",
		ReceivingBranchID: "cordoba", // ahora en Córdoba
		OriginBranchID:    "caba",
		FinalBranchID:     "mendoza",
		PlannedPath:       []string{"caba", "cordoba", "mendoza"},
		HopIndex:          0,
		PathRevision:      1,
	}

	svc.maybeRecordPath(sh, "hop_advance")

	if len(repo.recordedPaths) != 1 {
		t.Fatalf("esperado 1 RecordPathPlanned, got %d", len(repo.recordedPaths))
	}
	cmd := repo.recordedPaths[0]

	// Path original DEBE preservarse — no debe encogerse a [cordoba, mendoza]
	expectedPath := []string{"caba", "cordoba", "mendoza"}
	if len(cmd.PlannedPath) != len(expectedPath) {
		t.Fatalf("path debería preservar historia [caba,cordoba,mendoza], got %v", cmd.PlannedPath)
	}
	for i, b := range expectedPath {
		if cmd.PlannedPath[i] != b {
			t.Errorf("path[%d] esperado %s, got %s", i, b, cmd.PlannedPath[i])
		}
	}

	// HopIndex debe avanzar a la posición de cordoba (índice 1)
	if cmd.HopIndex != 1 {
		t.Errorf("hop_index esperado 1 (cordoba en path), got %d", cmd.HopIndex)
	}

	// Next_hop debe apuntar al siguiente: mendoza
	if cmd.NextHopBranchID != "mendoza" {
		t.Errorf("next_hop esperado mendoza, got %s", cmd.NextHopBranchID)
	}

	if cmd.Reason != "hop_advance" {
		t.Errorf("reason esperado hop_advance, got %s", cmd.Reason)
	}
}

// TestMaybeRecordPath_Initial_ComputesFreshPath verifica que en initial se
// compute un path fresco desde el origen.
func TestMaybeRecordPath_Initial_ComputesFreshPath(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
	}
	svc, repo := newTestShipmentSvc(edges, map[string]model.Branch{
		"caba":    {ID: "caba"},
		"cordoba": {ID: "cordoba"},
		"mendoza": {ID: "mendoza"},
	})

	sh := model.Shipment{
		TrackingID:        "LT-Y",
		ReceivingBranchID: "caba",
		OriginBranchID:    "caba",
		FinalBranchID:     "mendoza",
		// Sin PlannedPath previo
		HopIndex:     0,
		PathRevision: 0,
	}

	svc.maybeRecordPath(sh, "initial")

	if len(repo.recordedPaths) != 1 {
		t.Fatalf("esperado 1 RecordPathPlanned, got %d", len(repo.recordedPaths))
	}
	cmd := repo.recordedPaths[0]
	expected := []string{"caba", "cordoba", "mendoza"}
	if len(cmd.PlannedPath) != len(expected) {
		t.Fatalf("path inicial esperado %v, got %v", expected, cmd.PlannedPath)
	}
	if cmd.HopIndex != 0 {
		t.Errorf("hop_index inicial esperado 0, got %d", cmd.HopIndex)
	}
	if cmd.NextHopBranchID != "cordoba" {
		t.Errorf("next_hop esperado cordoba, got %s", cmd.NextHopBranchID)
	}
	if cmd.PathRevision != 1 {
		t.Errorf("path_revision esperado 1, got %d", cmd.PathRevision)
	}
}

// TestMaybeRecordPath_HopAdvanceFallback_WhenBranchNotInPath verifica que si
// el envío está en un hub que no está en su path original (escenario raro,
// e.g. desvío manual), hop_advance hace fallback a fresh computation.
func TestMaybeRecordPath_HopAdvanceFallback_WhenBranchNotInPath(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "rosario", ToBranchID: "mendoza", DistanceKm: 750, Enabled: true},
	}
	svc, repo := newTestShipmentSvc(edges, map[string]model.Branch{
		"rosario": {ID: "rosario"},
		"mendoza": {ID: "mendoza"},
	})

	// Envío con path original [caba, cordoba, mendoza] pero ahora está en rosario (desvío)
	sh := model.Shipment{
		TrackingID:        "LT-Z",
		ReceivingBranchID: "rosario",
		OriginBranchID:    "caba",
		FinalBranchID:     "mendoza",
		PlannedPath:       []string{"caba", "cordoba", "mendoza"},
		HopIndex:          0,
		PathRevision:      1,
	}

	svc.maybeRecordPath(sh, "hop_advance")

	if len(repo.recordedPaths) != 1 {
		t.Fatalf("esperado 1 RecordPathPlanned, got %d", len(repo.recordedPaths))
	}
	cmd := repo.recordedPaths[0]
	// Como rosario no estaba en el path original, recomputa fresh desde rosario
	if len(cmd.PlannedPath) != 2 || cmd.PlannedPath[0] != "rosario" || cmd.PlannedPath[1] != "mendoza" {
		t.Errorf("fallback fresh esperado [rosario,mendoza], got %v", cmd.PlannedPath)
	}
}
