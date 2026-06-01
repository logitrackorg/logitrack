package service

// routing_projection.go — motor de planificación multi-día con cascada de flota y envíos.
//
// Arquitectura:
//   - planContext: abstrae las fuentes de vehículos y envíos que generatePlan necesita.
//     En D=0 leen repos vivos; en D>0 leen del projectionState.
//   - projectionState: estado simulado que evoluciona D=0 → D=1 → D=2.
//   - GenerateMultiDayPlan: orquestador que corre el loop de días y aplica efectos.
//   - applyProjectedEffects: aplica los efectos de un plan sobre el estado simulado.
//
// Solo D=0 es aplicable. D>0 son pronósticos read-only (IsForecast=true).
// El scheduler regenera el horizonte completo a las 08:00 diariamente.

import (
	"context"
	"fmt"
	"log"
	"sort"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

// ─── planContext ──────────────────────────────────────────────────────────────

// planContext abstrae las fuentes de datos que generatePlan consume.
// En D=0 los source providers leen los repositorios vivos. En D>0 leen del
// projectionState, permitiendo simular sin mutar nada real.
type planContext struct {
	branchID   string
	forGlobal  bool
	existing   *model.GlobalRoutingPlan // contexto cross-branch (como hoy)

	// Posición en el horizonte.
	day      int             // 0=hoy, 1=mañana, 2=pasado
	planDate model.DateOnly  // fecha del día simulado
	now      time.Time       // base temporal del día

	// Fuentes inyectables de vehículos y envíos.
	vehicleSource  func(branchID string, mode model.VehicleMode) ([]model.Vehicle, map[string]float64)
	allVehicleSource func(branchID string) ([]model.Vehicle, map[string]float64)
	shipmentSource func(branchID string) []model.Shipment
	hubInventory   func() map[string][]model.Shipment // para cross-branch pickups

	// runSLARisk=true solo en D=0 (evita notificaciones falsas en días proyectados).
	runSLARisk bool
}

// liveContext crea un planContext que lee del estado vivo del sistema (comportamiento actual).
func (s *RoutingService) liveContext(branchID string, forGlobal bool, existing *model.GlobalRoutingPlan) *planContext {
	now := clock.Now().UTC()
	planDate := model.NewDateOnly(now.In(clock.LocalTZ))
	return &planContext{
		branchID:   branchID,
		forGlobal:  forGlobal,
		existing:   existing,
		day:        0,
		planDate:   planDate,
		now:        now,
		vehicleSource:    s.filterAvailableVehiclesForMode,
		allVehicleSource: s.filterAvailableVehicles,
		shipmentSource: func(b string) []model.Shipment {
			all, err := s.shipmentRepo.List(model.ShipmentFilter{ReceivingBranchID: b})
			if err != nil {
				return nil
			}
			return all
		},
		hubInventory: s.snapshotAtHubInventory,
		runSLARisk:   true,
	}
}

// ─── projectionState ─────────────────────────────────────────────────────────

type projectedVehicle struct {
	base    model.Vehicle
	branch  string
	readyAt time.Time // cuándo queda disponible (UTC)
}

type projectedShipment struct {
	base      model.Shipment
	branch    string    // sucursal donde está físicamente ahora (proyectado)
	readyAt   time.Time // disponible para despacho en 'branch' desde este momento
	remaining []string  // path de branchIDs restante hacia FinalBranchID (incl. branch actual)
	delivered bool      // true cuando llegó a su destino terminal
}

type projectionState struct {
	fleet     map[string]*projectedVehicle   // vehicleID → disponibilidad proyectada
	shipments map[string]*projectedShipment  // trackingID → ubicación/readiness proyectada
}

// availableVehicles devuelve los vehículos del estado proyectado disponibles en
// una sucursal para un modo dado, cuyo readyAt <= cutoff (mismo orden que filterAvailableVehiclesForMode).
func (st *projectionState) availableVehicles(branchID string, mode model.VehicleMode, cutoff time.Time) ([]model.Vehicle, map[string]float64) {
	var out []model.Vehicle
	for _, pv := range st.fleet {
		if pv.branch != branchID {
			continue
		}
		if pv.base.Mode != mode {
			continue
		}
		if pv.readyAt.After(cutoff) {
			continue
		}
		out = append(out, pv.base)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CapacityKg != out[j].CapacityKg {
			return out[i].CapacityKg < out[j].CapacityKg
		}
		return out[i].LicensePlate < out[j].LicensePlate
	})
	return out, map[string]float64{} // sin carga existente en proyección
}

// allAvailableVehicles devuelve todos los vehículos proyectados disponibles en
// una sucursal (sin filtro de modo), cuyo readyAt <= cutoff.
func (st *projectionState) allAvailableVehicles(branchID string, cutoff time.Time) ([]model.Vehicle, map[string]float64) {
	var out []model.Vehicle
	for _, pv := range st.fleet {
		if pv.branch != branchID {
			continue
		}
		if pv.readyAt.After(cutoff) {
			continue
		}
		out = append(out, pv.base)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].LicensePlate < out[j].LicensePlate
	})
	return out, map[string]float64{}
}

// readyShipments devuelve los envíos proyectados disponibles en una sucursal cuyo
// readyAt <= cutoff (excluye entregados y los que ya pasaron al siguiente hub).
func (st *projectionState) readyShipments(branchID string, cutoff time.Time) []model.Shipment {
	var out []model.Shipment
	for _, ps := range st.shipments {
		if ps.delivered {
			continue
		}
		if ps.branch != branchID {
			continue
		}
		if ps.readyAt.After(cutoff) {
			continue
		}
		// Retornar el envío con ReceivingBranchID ya corregido para que los filtros
		// internos de generatePlan funcionen correctamente.
		sh := ps.base
		sh.ReceivingBranchID = branchID
		out = append(out, sh)
	}
	return out
}

// atHubInventory construye el inventario de cross-branch pickups desde el estado proyectado.
func (st *projectionState) atHubInventory(cutoff time.Time) map[string][]model.Shipment {
	inv := map[string][]model.Shipment{}
	for _, ps := range st.shipments {
		if ps.delivered {
			continue
		}
		if ps.readyAt.After(cutoff) {
			continue
		}
		sh := ps.base
		// Solo incluir si está en un hub intermedio (not at final branch).
		if sh.FinalBranchID == "" || sh.FinalBranchID == ps.branch {
			continue
		}
		if sh.IsReturning || sh.ReservedForTripID != nil {
			continue
		}
		sh.ReceivingBranchID = ps.branch
		inv[ps.branch] = append(inv[ps.branch], sh)
	}
	return inv
}

// ─── buildInitialProjectionState ─────────────────────────────────────────────

func (s *RoutingService) buildInitialProjectionState(now time.Time) *projectionState {
	st := &projectionState{
		fleet:     make(map[string]*projectedVehicle),
		shipments: make(map[string]*projectedShipment),
	}

	// Flota: todos los vehículos del sistema.
	for _, v := range s.vehicleRepo.List() {
		if v.Status == model.VehicleStatusInactive || v.Status == model.VehicleStatusInMaintenance {
			continue
		}
		pv := &projectedVehicle{base: v}
		switch v.Status {
		case model.VehicleStatusAvailable, model.VehicleStatusLoading:
			if v.AssignedBranch != nil {
				pv.branch = *v.AssignedBranch
			}
			pv.readyAt = now
		case model.VehicleStatusInTransit:
			// Buscar el trip activo para obtener ETA y destino.
			if s.interBranchTripSvc == nil {
				continue
			}
			trip, ok := s.interBranchTripSvc.repo.GetActiveByVehicle(v.ID)
			if !ok || trip.EstimatedArrivalAt == nil || trip.DestinationBranchID == nil {
				continue // sin ETA conocida — excluido del horizonte
			}
			pv.branch = *trip.DestinationBranchID
			pv.readyAt = *trip.EstimatedArrivalAt
		default:
			continue
		}
		if pv.branch != "" {
			st.fleet[v.ID] = pv
		}
	}

	// Envíos: todos los activos ruteables.
	all, err := s.shipmentRepo.List(model.ShipmentFilter{})
	if err != nil {
		return st
	}
	for _, sh := range all {
		eligible := sh.Status == model.StatusAtHub ||
			sh.Status == model.StatusAtOriginHub ||
			sh.Status == model.StatusRedeliveryScheduled
		if !eligible {
			continue
		}
		if sh.ReservedForTripID != nil {
			continue
		}
		if sh.ReceivingBranchID == "" || sh.FinalBranchID == "" {
			continue
		}
		// Calcular el path restante hacia el destino final.
		var remaining []string
		if s.graphSvc != nil {
			remaining = s.graphSvc.ShortestPath(sh.ReceivingBranchID, sh.FinalBranchID)
		}
		if len(remaining) == 0 {
			remaining = []string{sh.ReceivingBranchID, sh.FinalBranchID}
		}
		terminal := sh.ReceivingBranchID == sh.FinalBranchID && sh.DeliveryMethod == model.DeliveryMethodLastMile
		st.shipments[sh.TrackingID] = &projectedShipment{
			base:      sh,
			branch:    sh.ReceivingBranchID,
			readyAt:   now,
			remaining: remaining,
			delivered: terminal && (sh.Status == model.StatusDelivered || sh.Status == model.StatusReturned),
		}
	}
	return st
}

// ─── applyProjectedEffects ───────────────────────────────────────────────────

// applyProjectedEffects aplica los efectos del dayPlan sobre el projectionState.
// Mueve vehículos a sus destinos y avanza envíos por la cadena de hubs.
// Solo se llama cuando hay un día siguiente (day < horizonDays-1).
func (s *RoutingService) applyProjectedEffects(st *projectionState, dayPlan *model.GlobalRoutingPlan, planDateStr string, cfg model.RoutingConfig) {
	planDate, err := parseDateOnly(planDateStr)
	if err != nil {
		return
	}

	for _, bp := range dayPlan.BranchPlans {
		origin := bp.BranchID
		for _, a := range bp.Plan.InterBranch {
			if len(a.Shipments) == 0 && len(a.PrimaryPickupShipments) == 0 {
				continue // card vacía de vehículo ya cargado — no proyectar
			}

			// (A) Efecto flota: el vehículo queda disponible en la última parada del viaje.
			lastBranch := a.DestinationBranch
			lastArrMin := a.PrimaryEstimatedArrivalMin
			if len(a.AdditionalStops) > 0 {
				lastStop := a.AdditionalStops[len(a.AdditionalStops)-1]
				if lastStop.BranchID != "" {
					lastBranch = lastStop.BranchID
				}
			}
			if a.EstimatedArrivalMin > 0 {
				lastArrMin = a.EstimatedArrivalMin
			}
			if pv, ok := st.fleet[a.VehicleID]; ok && lastBranch != "" && lastArrMin > 0 {
				pv.branch = lastBranch
				pv.readyAt = dateAtMinute(planDate, lastArrMin)
			}

			// (B) Efecto envíos: avanzar cada envío despachado por la cadena de hubs.
			arrivalByBranch := interBranchArrivalByBranch(a)

			// Recopilar todos los envíos del despacho (dropoffs + pickups).
			allTIDs := make([]string, 0, len(a.Shipments)+len(a.PrimaryPickupShipments))
			allTIDs = append(allTIDs, a.Shipments...)
			allTIDs = append(allTIDs, a.PrimaryPickupShipments...)
			for _, st2 := range a.AdditionalStops {
				allTIDs = append(allTIDs, st2.Shipments...)
				allTIDs = append(allTIDs, st2.PickupShipments...)
			}

			for _, tid := range allTIDs {
				ps, ok := st.shipments[tid]
				if !ok {
					continue
				}
				if ps.delivered {
					continue
				}

				// Encontrar en qué parada baja este envío: la primera parada que coincide
				// con su final_branch_id, o la última del viaje si es transferencia.
				dropBranch := findDropBranch(a, tid, ps.base.FinalBranchID)
				if dropBranch == "" {
					dropBranch = lastBranch
				}

				arrMin, ok := arrivalByBranch[dropBranch]
				if !ok || arrMin <= 0 {
					// No hay ETA para esta parada — usar la del origen + dwell mínimo.
					arrMin = cfg.InterBranchDispatchHour*60 + cfg.InterBranchStopMinutes
				}
				arrTime := dateAtMinute(planDate, arrMin)

				// Garantía de monotonía: readyAt nunca retrocede.
				if !arrTime.After(ps.readyAt) {
					arrTime = ps.readyAt.Add(time.Minute)
				}

				ps.branch = dropBranch
				ps.readyAt = arrTime

				// Verificar si es entrega terminal.
				if dropBranch == ps.base.FinalBranchID {
					if ps.base.DeliveryMethod == model.DeliveryMethodLastMile {
						// Llegó al hub de destino final — se repartirá en última milla el día
						// en que readyAt caiga en el cutoff. No marcar delivered todavía.
					} else {
						// retiro_sucursal en destino final: terminal.
						ps.delivered = true
					}
				}

				// Recortar el path restante.
				ps.remaining = trimPath(ps.remaining, dropBranch)
			}
		}

		// Efecto de última milla: envíos que salen en última milla este día
		// quedan marcados como delivered (entrega terminal al final del día).
		for _, lm := range bp.Plan.LastMile {
			for _, tid := range lm.Shipments {
				if ps, ok := st.shipments[tid]; ok && !ps.delivered {
					// Calcular arribo estimado de última milla.
					endMin := lm.SuggestedDepartureMin
					if len(lm.OrderedStops) > 0 {
						last := lm.OrderedStops[len(lm.OrderedStops)-1]
						if last.ArrivalMin >= 0 {
							endMin = lm.SuggestedDepartureMin + last.ArrivalMin + cfg.ServiceTimeMinutes
						}
					}
					arrTime := dateAtMinute(planDate, endMin)
					if !arrTime.After(ps.readyAt) {
						arrTime = ps.readyAt.Add(time.Minute)
					}
					// El envío queda en la sucursal destino final listo para entrega.
					ps.branch = ps.base.FinalBranchID
					ps.readyAt = arrTime
					ps.delivered = true // terminal: última milla
				}
			}
		}
		_ = origin // evitar "declared but not used" si go vet lo señala
	}
}

// findDropBranch determina en qué parada se descarga un envío dado (por su TID y FinalBranchID).
// Prioriza la parada que coincide con FinalBranchID; si no la encuentra, devuelve la última parada.
func findDropBranch(a model.InterBranchAssignment, tid, finalBranch string) string {
	// ¿Baja en la parada primaria?
	for _, t := range a.Shipments {
		if t == tid && !isInAdditionalStops(a.AdditionalStops, tid) {
			return a.DestinationBranch
		}
	}
	// ¿Baja en una parada adicional?
	for _, st := range a.AdditionalStops {
		for _, t := range st.Shipments {
			if t == tid {
				return st.BranchID
			}
		}
	}
	// No encontrado explícitamente → última parada (pickup que sigue viaje).
	if len(a.AdditionalStops) > 0 {
		return a.AdditionalStops[len(a.AdditionalStops)-1].BranchID
	}
	return a.DestinationBranch
}

func isInAdditionalStops(stops []model.AssignmentStop, tid string) bool {
	for _, st := range stops {
		for _, t := range st.Shipments {
			if t == tid {
				return true
			}
		}
	}
	return false
}

// trimPath recorta el path hasta el branch dado (inclusive), devolviendo lo que queda.
func trimPath(path []string, branch string) []string {
	for i, b := range path {
		if b == branch {
			return path[i:]
		}
	}
	return path
}

// parseDateOnly parsea una fecha YYYY-MM-DD como model.DateOnly.
func parseDateOnly(s string) (model.DateOnly, error) {
	t, err := time.ParseInLocation("2006-01-02", s, clock.LocalTZ)
	if err != nil {
		return model.DateOnly{}, err
	}
	return model.NewDateOnly(t), nil
}

// ─── GenerateMultiDayPlan ────────────────────────────────────────────────────

// GenerateMultiDayPlan genera el horizonte de planificación (hoy + N-1 pronósticos).
// D=0 se genera con datos vivos; D>0 se generan con el estado proyectado.
// Solo D=0 es aplicable; D>0 tienen IsForecast=true.
func (s *RoutingService) GenerateMultiDayPlan(ctx context.Context) ([]*model.GlobalRoutingPlan, error) {
	cfg := s.cfgSvc.Get()
	now := clock.Now().UTC()
	local := now.In(clock.LocalTZ)
	horizonDays := cfg.PlanningHorizonDays
	if horizonDays <= 0 {
		horizonDays = 1
	}

	plans := make([]*model.GlobalRoutingPlan, 0, horizonDays)
	branches := s.branchRepo.List()

	// Estado de proyección: se construye ahora y evoluciona día a día.
	state := s.buildInitialProjectionState(now)

	for day := 0; day < horizonDays; day++ {
		dayLocal := local.AddDate(0, 0, day)
		planDateStr := dayLocal.Format("2006-01-02")
		planDate := model.NewDateOnly(dayLocal)
		// Hora de corte: hora de despacho inter-sucursal del día (UTC).
		cutoff := dateAtMinute(planDate, cfg.InterBranchDispatchHour*60)

		plan := &model.GlobalRoutingPlan{
			ID:              newUUID(),
			PlanDate:        planDateStr,
			Status:          model.PlanStatusPending,
			BranchPlans:     []model.BranchPlan{},
			GeneratedAt:     now,
			HorizonOffset:   day,
			IsForecast:      day > 0,
			AppliedBranches: []string{},
		}

		totalCandidates, totalAssigned, totalUnassigned := 0, 0, 0

		for _, br := range branches {
			if br.Status != model.BranchStatusActive {
				continue
			}

			var pc *planContext
			if day == 0 {
				// D=0: fuentes vivas.
				pc = s.liveContext(br.ID, true, nil)
			} else {
				// D>0: fuentes proyectadas.
				pc = s.projectedContext(br.ID, day, planDate, cutoff, state)
			}

			branchPlan, err := s.generatePlan(ctx, pc)
			if err != nil {
				log.Printf("[routing-multiday] día %d sucursal %s: %v", day, br.ID, err)
				continue
			}
			plan.BranchPlans = append(plan.BranchPlans, model.BranchPlan{
				BranchID: br.ID,
				Plan:     branchPlan,
			})

			for _, lm := range branchPlan.LastMile {
				totalAssigned += len(lm.Shipments)
				totalCandidates += len(lm.Shipments)
			}
			for _, ib := range branchPlan.InterBranch {
				totalAssigned += len(ib.Shipments)
				totalCandidates += len(ib.Shipments)
			}
			totalUnassigned += len(branchPlan.Unassigned)
			totalCandidates += len(branchPlan.Unassigned)
		}

		plan.Log = model.GlobalPlanLog{
			TotalCandidates: totalCandidates,
			TotalAssigned:   totalAssigned,
			TotalUnassigned: totalUnassigned,
			TotalBranches:   len(plan.BranchPlans),
		}

		// Pases globales (cross-branch pickups, consolidación, poda) — igual que GenerateGlobalPlan.
		// En días proyectados usamos un snapshotAtHubInventory derivado del estado.
		if day == 0 {
			s.addCrossBranchPickups(plan)
		} else {
			s.addCrossBranchPickupsProjected(plan, state, cutoff)
		}
		s.consolidateCrossBranchDispatches(plan, cfg)
		s.enforceMinSegmentUtilization(plan, cfg)

		// Backhauling global en el plan proyectado.
		if cfg.BackhaulEnabled {
			s.matchBackhaulPairs(plan, cfg, cutoff)
			inv := state.atHubInventory(cutoff)
			taken := s.takenFromBackhauls(plan)
			for bi := range plan.BranchPlans {
				bp := &plan.BranchPlans[bi]
				s.addBackhaulReturnsFiltered(&bp.Plan, bp.BranchID, inv, cfg, cutoff, taken)
			}
		}

		// Balanceo de flota blando (proyección).
		if cfg.KeepOneVehiclePerBranch {
			s.enforceFleetBalance(plan, cfg, cutoff)
		}

		// Re-calcular schedule después de los pases globales (incluyendo backhaul).
		for i := range plan.BranchPlans {
			bp := &plan.BranchPlans[i]
			s.scheduleInterBranchAssignments(bp.Plan.InterBranch, bp.BranchID, cfg)
		}

		plans = append(plans, plan)

		// Aplicar efectos al estado para el día siguiente.
		if day < horizonDays-1 {
			s.applyProjectedEffects(state, plan, planDateStr, cfg)
		}
	}

	return plans, nil
}

// projectedContext crea un planContext que lee del projectionState para días futuros.
func (s *RoutingService) projectedContext(branchID string, day int, planDate model.DateOnly, cutoff time.Time, st *projectionState) *planContext {
	now := cutoff // usar la hora de corte como base temporal del día proyectado
	return &planContext{
		branchID:  branchID,
		forGlobal: true,
		existing:  nil,
		day:       day,
		planDate:  planDate,
		now:       now,
		vehicleSource: func(b string, mode model.VehicleMode) ([]model.Vehicle, map[string]float64) {
			return st.availableVehicles(b, mode, cutoff)
		},
		allVehicleSource: func(b string) ([]model.Vehicle, map[string]float64) {
			return st.allAvailableVehicles(b, cutoff)
		},
		shipmentSource: func(b string) []model.Shipment {
			return st.readyShipments(b, cutoff)
		},
		hubInventory: func() map[string][]model.Shipment {
			return st.atHubInventory(cutoff)
		},
		runSLARisk: false,
	}
}

// addCrossBranchPickupsProjected es la variante proyectada de addCrossBranchPickups.
// Usa el inventario del projectionState en lugar del shipmentRepo vivo.
func (s *RoutingService) addCrossBranchPickupsProjected(plan *model.GlobalRoutingPlan, st *projectionState, cutoff time.Time) {
	inventory := st.atHubInventory(cutoff)
	taken := map[string]bool{}
	for bi := range plan.BranchPlans {
		s.enrichDispatchesWithPickups(&plan.BranchPlans[bi].Plan, inventory, taken)
	}
}

// ─── GenerateAndPersistMultiDay ───────────────────────────────────────────────

// GenerateAndPersistMultiDay genera el horizonte completo y lo persiste.
// Preserva los planes con status "applied" (la lógica ON CONFLICT en el repo los protege).
// Es el nuevo entrypoint del scheduler y del endpoint de regeneración global.
func (s *RoutingService) GenerateAndPersistMultiDay(ctx context.Context) ([]*model.GlobalRoutingPlan, error) {
	plans, err := s.GenerateMultiDayPlan(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.planRepo.UpsertMulti(plans); err != nil {
		return nil, fmt.Errorf("routing multi-day: persistir planes: %w", err)
	}
	if len(plans) > 0 {
		log.Printf("[routing-multiday] %d planes persistidos (hoy=%s, horizonte=%d días): %d asignados, %d sin asignar",
			len(plans), plans[0].PlanDate, len(plans),
			plans[0].Log.TotalAssigned, plans[0].Log.TotalUnassigned)
	}
	return plans, nil
}

// GenerateAndPersistGlobalPlan es un shim que mantiene la firma existente.
// Llama a GenerateAndPersistMultiDay y devuelve el plan de hoy (D=0).
// Los callers existentes (scheduler, main.go, handler) no necesitan cambios.
func (s *RoutingService) GenerateAndPersistGlobalPlan(ctx context.Context) (*model.GlobalRoutingPlan, error) {
	plans, err := s.GenerateAndPersistMultiDay(ctx)
	if err != nil {
		return nil, err
	}
	if len(plans) == 0 {
		return nil, fmt.Errorf("routing multi-day: no se generaron planes")
	}
	return plans[0], nil
}
