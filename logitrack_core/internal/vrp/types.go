// Package vrp implementa un solver de Vehicle Routing Problem para entrega
// de última milla.
//
// El solver es heurístico (Nearest Neighbor + 2-opt intra-ruta) — no busca
// óptimo global, busca una solución razonable y reproducible. Para escalas
// chicas (<50 paradas, <10 choferes) la calidad es buena y el tiempo de
// cómputo es subsegundo.
//
// Restricciones soportadas:
//   - Capacidad por chofer (peso máximo y tope de envíos).
//   - Ventanas horarias hard (morning, afternoon, flexible) vs hora estimada
//     de llegada acumulada desde un horario de salida configurable.
//   - Carga preexistente del chofer (envíos ya en su ruta del día).
//
// Nodos sin coordenadas no participan del solver — el caller los maneja
// fuera (típicamente appendea al final de la ruta menos cargada).
package vrp

import "github.com/logitrack/core/internal/model"

// Coord es una coordenada geográfica (WGS84).
type Coord struct {
	Lat float64
	Lon float64
}

// Node representa una parada candidata: el depósito (índice 0) o una
// entrega (índices 1..N).
type Node struct {
	ID         string // tracking_id; el depósito usa un ID convencional como "depot"
	Coord      Coord
	WeightKg   float64
	TimeWindow model.TimeWindow
}

// Driver es un chofer disponible con sus topes y carga preexistente.
type Driver struct {
	ID               string
	MaxShipments     int
	MaxWeightKg      float64
	ExistingCount    int     // envíos ya en ruta del día
	ExistingWeightKg float64 // peso ya en ruta del día
}

// Stop es una parada dentro de una ruta resuelta.
type Stop struct {
	NodeID     string  // tracking_id del envío
	ArrivalMin float64 // minutos transcurridos desde la salida del depósito hasta llegar
}

// Route es la solución para un chofer.
type Route struct {
	DriverID         string
	Stops            []Stop
	TotalDurationMin float64 // ida + servicio + vuelta al depósito
	TotalDistanceKm  float64
}

// UnassignedReason es un código snake_case que indica por qué un nodo no
// pudo ser ruteado por el solver.
type UnassignedReason string

const (
	ReasonTimeWindowInfeasible UnassignedReason = "ventana_horaria_inviable"
	ReasonNoDriverCapacity     UnassignedReason = "sin_capacidad_en_choferes"
)

// UnassignedNode es un nodo que el solver no pudo asignar.
type UnassignedNode struct {
	NodeID string
	Reason UnassignedReason
}

// Solution es la salida del solver.
type Solution struct {
	Routes     []Route
	Unassigned []UnassignedNode
}

// Problem es la entrada del solver. La matriz tiene en el índice 0 al
// depósito y en 1..N a Deliveries[i-1].
type Problem struct {
	Depot      Node
	Deliveries []Node
	Drivers    []Driver

	// DurationMatrix[i][j] = segundos de viaje del nodo i al nodo j.
	DurationMatrix [][]float64
	// DistanceMatrix[i][j] = metros entre el nodo i y el j (opcional).
	DistanceMatrix [][]float64

	// DepartureMin: minutos desde medianoche en los que el chofer sale.
	// Típicamente max(8:00, now). Se usa para validar ventanas horarias
	// (la hora de llegada absoluta es DepartureMin + ArrivalMin).
	DepartureMin float64

	// ServiceTimeMin: minutos que el chofer pasa en cada parada (entrega).
	ServiceTimeMin float64

	// DayEndMin: minutos desde medianoche del fin del día operativo (ej: 18:00).
	// Sirve como tope absoluto para todas las ventanas.
	DayEndMin float64
}
