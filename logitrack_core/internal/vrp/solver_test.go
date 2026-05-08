package vrp

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// makeProblem arma un Problem con paradas en una grilla 1D simple:
// el depósito en x=0, las entregas en x=1, x=2, ... La duración entre
// dos puntos es |dx| minutos * 60 = segundos. Esto hace los tests
// determinísticos sin depender de OSRM ni Haversine.
func makeProblem(deliveries []Node, drivers []Driver, deliveryX []float64) Problem {
	n := len(deliveries) + 1
	xs := make([]float64, n)
	xs[0] = 0
	for i, x := range deliveryX {
		xs[i+1] = x
	}
	dur := make([][]float64, n)
	dist := make([][]float64, n)
	for i := 0; i < n; i++ {
		dur[i] = make([]float64, n)
		dist[i] = make([]float64, n)
		for j := 0; j < n; j++ {
			d := xs[j] - xs[i]
			if d < 0 {
				d = -d
			}
			dur[i][j] = d * 60   // 1 unidad x = 1 minuto
			dist[i][j] = d * 1000 // 1 unidad x = 1 km
		}
	}
	return Problem{
		Depot:          Node{ID: "depot", Coord: Coord{}},
		Deliveries:     deliveries,
		Drivers:        drivers,
		DurationMatrix: dur,
		DistanceMatrix: dist,
		DepartureMin:   8 * 60, // 08:00
		ServiceTimeMin: 5,
		DayEndMin:      18 * 60, // 18:00
	}
}

func TestSolve_SingleDriverSingleDelivery(t *testing.T) {
	p := makeProblem(
		[]Node{{ID: "LT-01", WeightKg: 5, TimeWindow: model.TimeWindowFlexible}},
		[]Driver{{ID: "drv1", MaxShipments: 10, MaxWeightKg: 100}},
		[]float64{2},
	)
	sol := Solve(p)
	if len(sol.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(sol.Routes))
	}
	if len(sol.Routes[0].Stops) != 1 || sol.Routes[0].Stops[0].NodeID != "LT-01" {
		t.Fatalf("expected single stop LT-01, got %+v", sol.Routes[0].Stops)
	}
	if len(sol.Unassigned) != 0 {
		t.Fatalf("expected no unassigned, got %+v", sol.Unassigned)
	}
}

func TestSolve_NoDriversAllUnassigned(t *testing.T) {
	p := makeProblem(
		[]Node{
			{ID: "LT-01", WeightKg: 5, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-02", WeightKg: 3, TimeWindow: model.TimeWindowFlexible},
		},
		nil,
		[]float64{1, 2},
	)
	sol := Solve(p)
	if len(sol.Routes) != 0 {
		t.Fatalf("expected no routes, got %d", len(sol.Routes))
	}
	if len(sol.Unassigned) != 2 {
		t.Fatalf("expected 2 unassigned, got %d", len(sol.Unassigned))
	}
	for _, u := range sol.Unassigned {
		if u.Reason != ReasonNoDriverCapacity {
			t.Errorf("expected reason %s, got %s", ReasonNoDriverCapacity, u.Reason)
		}
	}
}

func TestSolve_TwoOptFixesOrder(t *testing.T) {
	// Cuatro entregas en línea — depot=0, en x=1, 2, 3, 4.
	// Construyo la lista en un orden adversario para forzar 2-opt:
	// si NN visita en orden de ID, el resultado debería ser óptimo.
	// Pero acá lo nombramos en orden (LT-01..LT-04) y el solver debe
	// ordenarlos por nearest neighbor. La ruta óptima ida-vuelta es
	// 1→2→3→4 con duración 4 (ida) + 4 (vuelta) + 4*service = 28 min.
	p := makeProblem(
		[]Node{
			{ID: "LT-04", WeightKg: 1, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-01", WeightKg: 1, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-03", WeightKg: 1, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-02", WeightKg: 1, TimeWindow: model.TimeWindowFlexible},
		},
		[]Driver{{ID: "drv1", MaxShipments: 10, MaxWeightKg: 100}},
		[]float64{4, 1, 3, 2},
	)
	sol := Solve(p)
	if len(sol.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(sol.Routes))
	}
	r := sol.Routes[0]
	if len(r.Stops) != 4 {
		t.Fatalf("expected 4 stops, got %d", len(r.Stops))
	}
	// Verificar orden: 01, 02, 03, 04.
	want := []string{"LT-01", "LT-02", "LT-03", "LT-04"}
	for i, s := range r.Stops {
		if s.NodeID != want[i] {
			t.Errorf("stop %d: want %s got %s", i, want[i], s.NodeID)
		}
	}
	// Duración esperada: 4 ida + 5*4 servicio + 4 vuelta = 28
	if r.TotalDurationMin < 27 || r.TotalDurationMin > 29 {
		t.Errorf("expected ~28 min total, got %.1f", r.TotalDurationMin)
	}
}

func TestSolve_LoadBalancesAcrossDrivers(t *testing.T) {
	p := makeProblem(
		[]Node{
			{ID: "LT-01", WeightKg: 10, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-02", WeightKg: 10, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-03", WeightKg: 10, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-04", WeightKg: 10, TimeWindow: model.TimeWindowFlexible},
		},
		[]Driver{
			{ID: "drv1", MaxShipments: 10, MaxWeightKg: 100},
			{ID: "drv2", MaxShipments: 10, MaxWeightKg: 100},
		},
		[]float64{1, 2, 3, 4},
	)
	sol := Solve(p)
	if len(sol.Routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(sol.Routes))
	}
	for _, r := range sol.Routes {
		if len(r.Stops) != 2 {
			t.Errorf("expected 2 stops per driver (load-balanced), drv=%s got %d", r.DriverID, len(r.Stops))
		}
	}
}

func TestSolve_TimeWindowMorningInfeasible(t *testing.T) {
	// Depot lejos: ida = 5 horas, llegaría a las 13:00 — fuera de morning.
	p := makeProblem(
		[]Node{{ID: "LT-01", WeightKg: 1, TimeWindow: model.TimeWindowMorning}},
		[]Driver{{ID: "drv1", MaxShipments: 10, MaxWeightKg: 100}},
		[]float64{300}, // 300 min = 5h
	)
	sol := Solve(p)
	if len(sol.Routes) != 0 {
		t.Fatalf("expected no routes, got %d", len(sol.Routes))
	}
	if len(sol.Unassigned) != 1 || sol.Unassigned[0].Reason != ReasonTimeWindowInfeasible {
		t.Fatalf("expected 1 unassigned with time_window reason, got %+v", sol.Unassigned)
	}
}

func TestSolve_DriverCapacityCap(t *testing.T) {
	// Chofer max_shipments=2, 4 envíos disponibles → 2 unassigned por capacidad.
	p := makeProblem(
		[]Node{
			{ID: "LT-01", WeightKg: 5, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-02", WeightKg: 5, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-03", WeightKg: 5, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-04", WeightKg: 5, TimeWindow: model.TimeWindowFlexible},
		},
		[]Driver{{ID: "drv1", MaxShipments: 2, MaxWeightKg: 100}},
		[]float64{1, 2, 3, 4},
	)
	sol := Solve(p)
	if len(sol.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(sol.Routes))
	}
	if len(sol.Routes[0].Stops) != 2 {
		t.Errorf("expected 2 stops (capacity cap), got %d", len(sol.Routes[0].Stops))
	}
	if len(sol.Unassigned) != 2 {
		t.Errorf("expected 2 unassigned, got %d", len(sol.Unassigned))
	}
	for _, u := range sol.Unassigned {
		if u.Reason != ReasonNoDriverCapacity {
			t.Errorf("expected reason %s, got %s", ReasonNoDriverCapacity, u.Reason)
		}
	}
}

func TestSolve_ExistingLoadConsidered(t *testing.T) {
	// Chofer con carga existente alta no debería recibir nuevos envíos
	// si supera el cap de peso.
	p := makeProblem(
		[]Node{
			{ID: "LT-01", WeightKg: 50, TimeWindow: model.TimeWindowFlexible},
			{ID: "LT-02", WeightKg: 50, TimeWindow: model.TimeWindowFlexible},
		},
		[]Driver{
			{ID: "drv1", MaxShipments: 10, MaxWeightKg: 100, ExistingWeightKg: 90}, // solo entra 1 si pesa <=10
			{ID: "drv2", MaxShipments: 10, MaxWeightKg: 100},
		},
		[]float64{1, 2},
	)
	sol := Solve(p)
	if len(sol.Routes) != 1 {
		t.Fatalf("expected 1 route (only drv2 takes both), got %d", len(sol.Routes))
	}
	if sol.Routes[0].DriverID != "drv2" {
		t.Errorf("expected drv2 to be the route, got %s", sol.Routes[0].DriverID)
	}
	if len(sol.Routes[0].Stops) != 2 {
		t.Errorf("expected drv2 to take both shipments, got %d", len(sol.Routes[0].Stops))
	}
}

func TestSolve_DepartureTimePropagates(t *testing.T) {
	// Si DepartureMin = 14:00 (840), un envío morning siempre falla.
	p := makeProblem(
		[]Node{{ID: "LT-01", WeightKg: 1, TimeWindow: model.TimeWindowMorning}},
		[]Driver{{ID: "drv1", MaxShipments: 10, MaxWeightKg: 100}},
		[]float64{1},
	)
	p.DepartureMin = 14 * 60
	sol := Solve(p)
	if len(sol.Unassigned) != 1 || sol.Unassigned[0].Reason != ReasonTimeWindowInfeasible {
		t.Fatalf("expected morning shipment unassigned at 14:00 departure, got %+v", sol.Unassigned)
	}
}
