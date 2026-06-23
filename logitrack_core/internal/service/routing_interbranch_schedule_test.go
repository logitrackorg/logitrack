package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// TestScheduleInterBranch_MultiHopWithTransitHours verifica que el schedule
// inter-sucursal use AvgTransitHours del grafo y sume el dwell (ServiceTimeMinutes)
// en cada parada intermedia — incluida la parada primaria cuando es intermedia.
//
// Viaje: CABA → Córdoba → Mendoza, con bajada y subida en Córdoba.
//   - edge caba→cordoba   = 2 h
//   - edge cordoba→mendoza = 3 h
//   - salida 08:00 (480), dwell inter-sucursal 240 min (4 h)
//
// Esperado:
//
//	salida           = 480
//	arribo Córdoba   = 480 + 120          = 600    (PrimaryEstimatedArrivalMin)
//	+ dwell Córdoba  = 600 + 240          = 840    (intermedia: descarga + carga)
//	arribo Mendoza   = 840 + 180          = 1020   (AdditionalStops[0])
//	llegada final    = 1020                        (última parada, sin dwell)
func TestScheduleInterBranch_MultiHopWithTransitHours(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", AvgTransitHours: 2, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", AvgTransitHours: 3, Enabled: true},
	}
	svc := newMultiHopService(nil, edges)

	cfg := model.RoutingConfig{
		InterBranchDispatchHour: 8,
		InterBranchStopMinutes:  240,
		InterBranchAvgSpeedKmh:  60,
	}

	assignments := []model.InterBranchAssignment{
		{
			VehicleID:         "V-CABA",
			DestinationBranch: "cordoba",
			Shipments:         []string{"LT-1", "LT-2"},
			AdditionalStops: []model.AssignmentStop{
				{BranchID: "mendoza", Shipments: []string{"LT-2"}},
			},
		},
	}

	svc.scheduleInterBranchAssignments(assignments, "caba", cfg)

	a := assignments[0]
	if a.EstimatedDepartureMin != 480 {
		t.Errorf("EstimatedDepartureMin = %d, esperado 480", a.EstimatedDepartureMin)
	}
	if a.PrimaryEstimatedArrivalMin != 600 {
		t.Errorf("PrimaryEstimatedArrivalMin = %d, esperado 600", a.PrimaryEstimatedArrivalMin)
	}
	if len(a.AdditionalStops) != 1 || a.AdditionalStops[0].EstimatedArrivalMin != 1020 {
		t.Errorf("AdditionalStops[0].EstimatedArrivalMin = %d, esperado 1020 (incluye dwell 240 en Córdoba)",
			a.AdditionalStops[0].EstimatedArrivalMin)
	}
	if a.EstimatedArrivalMin != 1020 {
		t.Errorf("EstimatedArrivalMin = %d, esperado 1020 (última parada, sin dwell extra)", a.EstimatedArrivalMin)
	}

	// Monotonicidad: salida < arribo primaria < arribo final.
	if !(a.EstimatedDepartureMin < a.PrimaryEstimatedArrivalMin &&
		a.PrimaryEstimatedArrivalMin < a.EstimatedArrivalMin) {
		t.Errorf("schedule no monótono: salida=%d primaria=%d final=%d",
			a.EstimatedDepartureMin, a.PrimaryEstimatedArrivalMin, a.EstimatedArrivalMin)
	}
}

// TestScheduleInterBranch_SingleHopNoDwell verifica que un viaje de una sola
// parada no sume dwell (la llegada es el fin del viaje) y que use el tiempo de
// tránsito del grafo.
func TestScheduleInterBranch_SingleHopNoDwell(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", AvgTransitHours: 2, Enabled: true},
	}
	svc := newMultiHopService(nil, edges)

	cfg := model.RoutingConfig{
		InterBranchDispatchHour: 8,
		InterBranchStopMinutes:  240,
		InterBranchAvgSpeedKmh:  60,
	}

	assignments := []model.InterBranchAssignment{
		{VehicleID: "V1", DestinationBranch: "cordoba", Shipments: []string{"LT-1"}},
	}
	svc.scheduleInterBranchAssignments(assignments, "caba", cfg)

	a := assignments[0]
	// salida 480 + 120 = 600. Sin dwell porque Córdoba es la última (y única) parada.
	if a.PrimaryEstimatedArrivalMin != 600 || a.EstimatedArrivalMin != 600 {
		t.Errorf("single-hop: primaria=%d final=%d, esperado 600/600 sin dwell",
			a.PrimaryEstimatedArrivalMin, a.EstimatedArrivalMin)
	}
}
