package vrp

import (
	"sort"

	"github.com/logitrack/core/internal/model"
)

// Solve resuelve el problema y devuelve la solución.
//
// Algoritmo:
//  1. Nearest Neighbor por chofer, ordenado por carga existente ASC,
//     respetando ventanas horarias hard y capacidades.
//  2. 2-opt intra-ruta: revierte segmentos si reduce duración total y
//     no rompe ventanas.
//
// La salida es determinística: a igual entrada, igual salida. Las
// iteraciones sobre estructuras se hacen sobre slices ordenados.
func Solve(p Problem) Solution {
	if len(p.Deliveries) == 0 || len(p.Drivers) == 0 || len(p.DurationMatrix) == 0 {
		// Sin candidatos: devolvemos todos como unassigned por capacidad
		// (mismo motivo que usaría el caller con su propio greedy).
		var unassigned []UnassignedNode
		for _, d := range p.Deliveries {
			unassigned = append(unassigned, UnassignedNode{NodeID: d.ID, Reason: ReasonNoDriverCapacity})
		}
		return Solution{Unassigned: unassigned}
	}

	routes, unassigned := nearestNeighbor(p)

	// 2-opt sobre cada ruta de >= 4 paradas (con menos no hay nada para revertir).
	for i := range routes {
		if len(routes[i].Stops) >= 4 {
			routes[i] = twoOpt(routes[i], p)
		}
	}

	return Solution{Routes: routes, Unassigned: unassigned}
}

// nearestNeighbor construye una solución inicial asignando paradas a
// choferes en orden de carga existente ASC. Para cada chofer, mientras
// quede capacidad, elige la entrega no asignada de menor tiempo de viaje
// que respete las ventanas horarias y las capacidades.
func nearestNeighbor(p Problem) ([]Route, []UnassignedNode) {
	type driverState struct {
		driver       Driver
		stops        []int   // índices a p.Deliveries
		weight       float64 // peso de las nuevas asignaciones (sin contar existing)
		count        int     // cantidad nueva
		currentNode  int     // índice en la matriz: 0 = depot, 1..N = deliveries
		currentTime  float64 // minutos desde DepartureMin
		totalTimeMin float64
	}

	// Orden estable de drivers: por carga existente ASC, luego ID ASC.
	drivers := make([]Driver, len(p.Drivers))
	copy(drivers, p.Drivers)
	sort.SliceStable(drivers, func(i, j int) bool {
		if drivers[i].ExistingWeightKg != drivers[j].ExistingWeightKg {
			return drivers[i].ExistingWeightKg < drivers[j].ExistingWeightKg
		}
		return drivers[i].ID < drivers[j].ID
	})

	states := make([]*driverState, len(drivers))
	for i, d := range drivers {
		states[i] = &driverState{driver: d, currentNode: 0}
	}

	// Pool de entregas pendientes (índices a p.Deliveries).
	remaining := map[int]bool{}
	for i := range p.Deliveries {
		remaining[i] = true
	}

	// Razones de descarte por nodo. Si un nodo se queda al final por
	// capacidad pero también lo descartamos por ventana en algún chofer,
	// preferimos reportar el problema "duro" (ventana inviable) primero.
	timeWindowFailed := map[int]bool{}

	// Asignación round-robin chofer-por-chofer: cada chofer agrega su
	// mejor candidato, después pasamos al siguiente. Esto balancea mejor
	// las cargas que llenar uno y después otro.
	for {
		assignedThisRound := false
		for _, st := range states {
			if !canFitMore(st.driver, st.weight, st.count) {
				continue
			}
			best := -1
			bestTravel := 0.0
			for idx := range remaining {
				del := p.Deliveries[idx]
				travelSec := p.DurationMatrix[st.currentNode][idx+1]
				travelMin := travelSec / 60.0
				arrival := st.currentTime + travelMin
				if !respectsWindow(del.TimeWindow, p.DepartureMin+arrival, p.DayEndMin) {
					timeWindowFailed[idx] = true
					continue
				}
				if !nodeFits(st.driver, st.weight, st.count, del.WeightKg) {
					continue
				}
				if best == -1 || travelMin < bestTravel {
					best = idx
					bestTravel = travelMin
				}
			}
			if best == -1 {
				continue
			}
			del := p.Deliveries[best]
			arrival := st.currentTime + bestTravel
			st.stops = append(st.stops, best)
			st.weight += del.WeightKg
			st.count++
			st.currentTime = arrival + p.ServiceTimeMin
			st.currentNode = best + 1
			delete(remaining, best)
			assignedThisRound = true
		}
		if !assignedThisRound {
			break
		}
	}

	// Construir Routes finales (sumar regreso al depósito en TotalDuration).
	routes := make([]Route, 0, len(states))
	for _, st := range states {
		if len(st.stops) == 0 {
			continue
		}
		stops := make([]Stop, len(st.stops))
		// Re-simular para obtener arrivals "limpias" (consistente post-2opt también).
		curNode := 0
		curTime := 0.0
		totalDistKm := 0.0
		for i, idx := range st.stops {
			travel := p.DurationMatrix[curNode][idx+1] / 60.0
			arrival := curTime + travel
			stops[i] = Stop{NodeID: p.Deliveries[idx].ID, ArrivalMin: arrival}
			if len(p.DistanceMatrix) > 0 {
				totalDistKm += p.DistanceMatrix[curNode][idx+1] / 1000.0
			}
			curTime = arrival + p.ServiceTimeMin
			curNode = idx + 1
		}
		// Vuelta al depósito.
		returnTravel := p.DurationMatrix[curNode][0] / 60.0
		if len(p.DistanceMatrix) > 0 {
			totalDistKm += p.DistanceMatrix[curNode][0] / 1000.0
		}
		routes = append(routes, Route{
			DriverID:         st.driver.ID,
			Stops:            stops,
			TotalDurationMin: curTime + returnTravel,
			TotalDistanceKm:  totalDistKm,
		})
	}

	// Unassigned: lo que quedó en remaining. Reportamos ventana inviable
	// si en algún momento la rechazamos por eso, sino capacidad.
	var unassigned []UnassignedNode
	leftover := make([]int, 0, len(remaining))
	for idx := range remaining {
		leftover = append(leftover, idx)
	}
	sort.Ints(leftover)
	for _, idx := range leftover {
		reason := ReasonNoDriverCapacity
		if timeWindowFailed[idx] {
			reason = ReasonTimeWindowInfeasible
		}
		unassigned = append(unassigned, UnassignedNode{NodeID: p.Deliveries[idx].ID, Reason: reason})
	}

	// Orden estable de routes por DriverID para reproducibilidad.
	sort.SliceStable(routes, func(i, j int) bool { return routes[i].DriverID < routes[j].DriverID })
	return routes, unassigned
}

// twoOpt intenta mejorar una ruta revirtiendo segmentos. Acepta la mejora
// solo si reduce duración total Y la nueva secuencia respeta ventanas.
//
// Trabaja en términos de índices a p.Deliveries (no a la matriz), por eso
// hace el +1 cuando consulta DurationMatrix.
func twoOpt(r Route, p Problem) Route {
	if len(r.Stops) < 4 {
		return r
	}
	// Recuperar la secuencia de índices originales.
	idxs := make([]int, len(r.Stops))
	for i, s := range r.Stops {
		// Buscar el índice del NodeID en p.Deliveries.
		for j, d := range p.Deliveries {
			if d.ID == s.NodeID {
				idxs[i] = j
				break
			}
		}
	}

	improved := true
	bestDur := totalDuration(idxs, p)
	for improved {
		improved = false
		// i: posición del primer extremo del segmento a revertir (0..n-2)
		// j: posición del segundo extremo (i+2..n-1) — i+1 reversa-trivial sin efecto
		for i := 0; i < len(idxs)-1; i++ {
			for j := i + 2; j < len(idxs); j++ {
				cand := make([]int, len(idxs))
				copy(cand, idxs)
				reverseSlice(cand[i+1 : j+1])
				if !routeRespectsWindows(cand, p) {
					continue
				}
				d := totalDuration(cand, p)
				if d+1e-9 < bestDur {
					idxs = cand
					bestDur = d
					improved = true
				}
			}
			if improved {
				break // restart desde i=0
			}
		}
	}

	// Re-simular para arrivals + distancia.
	stops := make([]Stop, len(idxs))
	curNode := 0
	curTime := 0.0
	totalDistKm := 0.0
	for i, idx := range idxs {
		travel := p.DurationMatrix[curNode][idx+1] / 60.0
		arrival := curTime + travel
		stops[i] = Stop{NodeID: p.Deliveries[idx].ID, ArrivalMin: arrival}
		if len(p.DistanceMatrix) > 0 {
			totalDistKm += p.DistanceMatrix[curNode][idx+1] / 1000.0
		}
		curTime = arrival + p.ServiceTimeMin
		curNode = idx + 1
	}
	returnTravel := p.DurationMatrix[curNode][0] / 60.0
	if len(p.DistanceMatrix) > 0 {
		totalDistKm += p.DistanceMatrix[curNode][0] / 1000.0
	}
	return Route{
		DriverID:         r.DriverID,
		Stops:            stops,
		TotalDurationMin: curTime + returnTravel,
		TotalDistanceKm:  totalDistKm,
	}
}

// totalDuration suma el tiempo de la ruta completa (depot → stops → depot)
// incluyendo tiempo de servicio en cada parada.
func totalDuration(idxs []int, p Problem) float64 {
	curNode := 0
	curTime := 0.0
	for _, idx := range idxs {
		curTime += p.DurationMatrix[curNode][idx+1] / 60.0
		curTime += p.ServiceTimeMin
		curNode = idx + 1
	}
	curTime += p.DurationMatrix[curNode][0] / 60.0
	return curTime
}

// routeRespectsWindows verifica que toda la secuencia respete las ventanas
// horarias hard y el día operativo.
func routeRespectsWindows(idxs []int, p Problem) bool {
	curNode := 0
	curTime := 0.0
	for _, idx := range idxs {
		curTime += p.DurationMatrix[curNode][idx+1] / 60.0
		if !respectsWindow(p.Deliveries[idx].TimeWindow, p.DepartureMin+curTime, p.DayEndMin) {
			return false
		}
		curTime += p.ServiceTimeMin
		curNode = idx + 1
	}
	return true
}

// respectsWindow chequea si una hora absoluta de llegada cae dentro de
// la ventana del envío y antes del fin del día.
// Envíos con ventana flexible no tienen restricción de horario: pueden
// asignarse en cualquier momento del día operativo.
func respectsWindow(tw model.TimeWindow, absArrivalMin, dayEndMin float64) bool {
	const noon = 12.0 * 60.0
	switch tw {
	case model.TimeWindowMorning:
		return absArrivalMin <= noon && absArrivalMin <= dayEndMin
	case model.TimeWindowAfternoon:
		return absArrivalMin >= noon && absArrivalMin <= dayEndMin
	default: // flexible o vacío — sin restricción de franja horaria
		return true
	}
}

// canFitMore: el chofer todavía no llegó al tope.
func canFitMore(d Driver, newWeight float64, newCount int) bool {
	if d.ExistingCount+newCount >= d.MaxShipments {
		return false
	}
	if d.ExistingWeightKg+newWeight >= d.MaxWeightKg {
		return false
	}
	return true
}

// nodeFits: agregar este envío específico no rompe los topes.
func nodeFits(d Driver, currWeight float64, currCount int, addWeight float64) bool {
	if d.ExistingCount+currCount+1 > d.MaxShipments {
		return false
	}
	if d.ExistingWeightKg+currWeight+addWeight > d.MaxWeightKg {
		return false
	}
	return true
}

func reverseSlice(s []int) {
	for i, j := 0, len(s)-1; i < j; i, j = i+1, j-1 {
		s[i], s[j] = s[j], s[i]
	}
}
