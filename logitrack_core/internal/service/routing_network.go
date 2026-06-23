package service

import (
	"log"
	"sort"
	"strings"

	"github.com/logitrack/core/internal/model"
)

// =============================================================================
// Phase 3 Sprint 6 — Network analysis sobre el plan global
//
// Después de que GenerateGlobalPlan construye los BranchPlans, analyzeNetwork
// detecta señales cross-branch que el operador no podría ver desde el plan de
// una sola sucursal: vehículos ociosos vs demanda insatisfecha en otras sucursales,
// despachos paralelos al mismo destino, y métricas agregadas de la red.
// =============================================================================

// analyzeNetwork popula plan.Insights con el resultado del análisis cross-branch.
func (s *RoutingService) analyzeNetwork(plan *model.GlobalRoutingPlan) {
	insights := model.NetworkInsights{
		EmptyMoves:                 []model.EmptyMoveSuggestion{},
		ConsolidationOpportunities: []model.ConsolidationOpportunity{},
	}

	s.detectEmptyMoves(plan, &insights)
	s.detectConsolidationOpportunities(plan, &insights)
	insights.Metrics = s.computeNetworkMetrics(plan)

	plan.Insights = insights
}

// detectEmptyMoves identifica vehículos ociosos en una sucursal y sucursales
// con demanda sin atender (envíos unassigned por motivo `sin_vehiculos_*`).
// Para cada sucursal necesitada, sugiere el vehículo ocioso más cercano.
func (s *RoutingService) detectEmptyMoves(plan *model.GlobalRoutingPlan, insights *model.NetworkInsights) {
	// idleByBranch[branchID] = vehículos disponibles que NO se usaron en el plan
	idleByBranch := map[string][]model.VehicleLoad{}
	usedVehicleIDs := map[string]bool{}
	for _, bp := range plan.BranchPlans {
		for _, ib := range bp.Plan.InterBranch {
			usedVehicleIDs[ib.VehicleID] = true
		}
	}
	for _, bp := range plan.BranchPlans {
		for _, vl := range bp.Plan.VehicleLoads {
			if usedVehicleIDs[vl.VehicleID] {
				continue
			}
			idleByBranch[bp.BranchID] = append(idleByBranch[bp.BranchID], vl)
		}
	}

	// Para cada sucursal con demanda no atendida, contar envíos sin vehículo
	type needyBranch struct {
		branchID      string
		unservedCount int
	}
	var needy []needyBranch
	for _, bp := range plan.BranchPlans {
		count := 0
		for _, u := range bp.Plan.Unassigned {
			if strings.HasPrefix(u.Reason, "sin_vehiculos") {
				count++
			}
		}
		if count > 0 {
			needy = append(needy, needyBranch{branchID: bp.BranchID, unservedCount: count})
		}
	}

	if len(needy) == 0 || len(idleByBranch) == 0 {
		return
	}

	// Orden determinístico
	sort.SliceStable(needy, func(i, j int) bool {
		if needy[i].unservedCount != needy[j].unservedCount {
			return needy[i].unservedCount > needy[j].unservedCount
		}
		return needy[i].branchID < needy[j].branchID
	})

	usedVehicleForReposition := map[string]bool{}
	for _, nb := range needy {
		// Buscar el vehículo ocioso más cercano que no se haya usado para otra sugerencia
		var bestVehicleID, bestPlate, bestFromBranch string
		var bestDist float64 = -1
		var bestCap float64

		// Pares (fromBranch, vehicleID) con orden estable
		var pairs []struct {
			fromBranch string
			vl         model.VehicleLoad
		}
		for fromBranch, vehicles := range idleByBranch {
			if fromBranch == nb.branchID {
				continue // ya está acá, no es un movimiento
			}
			for _, vl := range vehicles {
				if usedVehicleForReposition[vl.VehicleID] {
					continue
				}
				pairs = append(pairs, struct {
					fromBranch string
					vl         model.VehicleLoad
				}{fromBranch, vl})
			}
		}
		sort.SliceStable(pairs, func(i, j int) bool {
			if pairs[i].fromBranch != pairs[j].fromBranch {
				return pairs[i].fromBranch < pairs[j].fromBranch
			}
			return pairs[i].vl.VehicleID < pairs[j].vl.VehicleID
		})

		for _, p := range pairs {
			d := s.branchDistance(p.fromBranch, nb.branchID)
			if d < 0 {
				continue
			}
			if bestDist < 0 || d < bestDist {
				bestDist = d
				bestVehicleID = p.vl.VehicleID
				bestPlate = p.vl.LicensePlate
				bestFromBranch = p.fromBranch
				bestCap = p.vl.CapacityKg
			}
		}

		if bestVehicleID == "" {
			continue
		}
		usedVehicleForReposition[bestVehicleID] = true
		insights.EmptyMoves = append(insights.EmptyMoves, model.EmptyMoveSuggestion{
			VehicleID:         bestVehicleID,
			LicensePlate:      bestPlate,
			CapacityKg:        bestCap,
			FromBranchID:      bestFromBranch,
			ToBranchID:        nb.branchID,
			DistanceKm:        bestDist,
			UnservedShipments: nb.unservedCount,
			Reason:            "vehiculo_ocioso_demanda_no_atendida",
		})
	}
}

// detectConsolidationOpportunities encuentra destinos a los que múltiples sucursales
// están despachando hoy. Es señal visual para que el operador evalúe alternativas
// (consolidar via una sucursal intermedia, postergar un viaje, etc.).
func (s *RoutingService) detectConsolidationOpportunities(plan *model.GlobalRoutingPlan, insights *model.NetworkInsights) {
	type dispatchInfo struct {
		fromBranchID string
		vehicleID    string
		licensePlate string
		totalWeight  float64
		capacity     float64
	}
	byDestination := map[string][]dispatchInfo{}

	for _, bp := range plan.BranchPlans {
		for _, ib := range bp.Plan.InterBranch {
			if ib.InTransit {
				continue // ya está en viaje, no es candidato
			}
			byDestination[ib.DestinationBranch] = append(byDestination[ib.DestinationBranch], dispatchInfo{
				fromBranchID: bp.BranchID,
				vehicleID:    ib.VehicleID,
				licensePlate: ib.LicensePlate,
				totalWeight:  ib.TotalWeightKg + ib.ExistingWeightKg,
				capacity:     ib.CapacityKg,
			})
		}
	}

	// Orden determinístico de destinos
	var destinations []string
	for dest := range byDestination {
		destinations = append(destinations, dest)
	}
	sort.Strings(destinations)

	for _, dest := range destinations {
		dispatches := byDestination[dest]
		// Buscar oportunidades: 2+ despachos desde sucursales DISTINTAS al mismo destino
		fromBranches := map[string]bool{}
		for _, d := range dispatches {
			fromBranches[d.fromBranchID] = true
		}
		if len(fromBranches) < 2 {
			continue
		}

		totalWeight := 0.0
		totalFillSum := 0.0
		consolDispatches := make([]model.ConsolidationDispatch, 0, len(dispatches))
		for _, d := range dispatches {
			fill := 0.0
			if d.capacity > 0 {
				fill = (d.totalWeight / d.capacity) * 100
			}
			totalWeight += d.totalWeight
			totalFillSum += fill
			consolDispatches = append(consolDispatches, model.ConsolidationDispatch{
				FromBranchID:  d.fromBranchID,
				VehicleID:     d.vehicleID,
				LicensePlate:  d.licensePlate,
				TotalWeightKg: roundKg(d.totalWeight),
				CapacityKg:    d.capacity,
			})
		}
		avgFill := totalFillSum / float64(len(dispatches))

		insights.ConsolidationOpportunities = append(insights.ConsolidationOpportunities, model.ConsolidationOpportunity{
			DestinationBranchID: dest,
			Dispatches:          consolDispatches,
			TotalWeightKg:       roundKg(totalWeight),
			AvgFillRatePct:      roundKg(avgFill), // reusa roundKg para 2 decimales
		})
	}
}

// computeNetworkMetrics suma a nivel red.
func (s *RoutingService) computeNetworkMetrics(plan *model.GlobalRoutingPlan) model.NetworkMetrics {
	m := model.NetworkMetrics{}

	dispatchedVehicles := map[string]bool{}
	allActiveVehicles := map[string]bool{}
	branchesWithUnservedDemand := map[string]bool{}

	ibUtilTotal := 0.0
	ibUtilCount := 0
	ibTotal := 0
	ibSLAForced := 0

	lmUtilTotal := 0.0
	lmUtilCount := 0

	for _, bp := range plan.BranchPlans {
		for _, ib := range bp.Plan.InterBranch {
			if ib.Projected {
				continue
			}
			dispatchedVehicles[ib.VehicleID] = true
			allActiveVehicles[ib.VehicleID] = true
			m.TotalShipmentsAssigned += len(ib.Shipments)
			ibTotal++
			if ib.Rule == model.DispatchRuleSLA {
				ibSLAForced++
			}
			if ib.CapacityKg > 0 {
				// TotalWeightKg acumula todas las etapas del viaje multi-hop.
				// Para el fill-rate solo se usa el peso del despacho primario
				// (lo que cargó el vehículo al salir del origen).
				primaryKg := ib.TotalWeightKg
				for _, st := range ib.AdditionalStops {
					primaryKg -= st.TotalWeightKg
				}
				if primaryKg < 0 {
					primaryKg = 0
				}
				util := (primaryKg + ib.ExistingWeightKg) / ib.CapacityKg
				if util > 1.0 {
					util = 1.0
				}
				ibUtilTotal += util
				ibUtilCount++
			}
		}
		for _, lm := range bp.Plan.LastMile {
			if lm.InTransit {
				continue
			}
			allActiveVehicles[lm.VehicleID] = true
			m.TotalShipmentsAssigned += len(lm.Shipments)
			if lm.CapacityKg > 0 {
				log.Printf("[metrics] LM branch=%s vehicle=%s shipments=%d total=%.2f existing=%.2f cap=%.1f",
					bp.BranchID, lm.VehicleID, len(lm.Shipments), lm.TotalWeightKg, lm.ExistingWeightKg, lm.CapacityKg)
				util := (lm.TotalWeightKg + lm.ExistingWeightKg) / lm.CapacityKg
				if util > 1.0 {
					util = 1.0
				}
				lmUtilTotal += util
				lmUtilCount++
			}
		}
		m.TotalShipmentsUnassigned += len(bp.Plan.Unassigned)

		for _, u := range bp.Plan.Unassigned {
			if strings.HasPrefix(u.Reason, "sin_vehiculos") {
				branchesWithUnservedDemand[bp.BranchID] = true
				break
			}
		}

		for _, vl := range bp.Plan.VehicleLoads {
			if !allActiveVehicles[vl.VehicleID] {
				m.IdleVehiclesCount++
			}
		}
	}

	m.TotalVehiclesDispatched = len(dispatchedVehicles)
	m.BranchesWithUnservedDemand = len(branchesWithUnservedDemand)

	if ibUtilCount > 0 {
		m.AvgInterBranchUtilizationPct = roundKg((ibUtilTotal / float64(ibUtilCount)) * 100)
	}
	if lmUtilCount > 0 {
		m.AvgLastMileUtilizationPct = roundKg((lmUtilTotal / float64(lmUtilCount)) * 100)
	}
	if ibTotal > 0 {
		m.SLAForcedPct = roundKg((float64(ibSLAForced) / float64(ibTotal)) * 100)
	}

	// Compatibilidad: promedio combinado de ambos tipos.
	allUtil := ibUtilTotal + lmUtilTotal
	allCount := ibUtilCount + lmUtilCount
	if allCount > 0 {
		m.AvgVehicleUtilizationPct = roundKg((allUtil / float64(allCount)) * 100)
	}

	return m
}
