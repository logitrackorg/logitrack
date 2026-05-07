package service

import (
	"context"
	"log"
	"sort"
	"time"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/osrm"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/vrp"
)

// RoutingService genera y aplica el plan de ruteo diario para una sucursal.
//
// El plan vive en memoria del cliente entre Generate y Apply (no se persiste en backend).
// Apply hace validación per-item contra el estado actual antes de mutar — no es transaccional
// porque shipment, vehicle y route viven en stores distintos.
type RoutingService struct {
	cfgSvc       *RoutingConfigService
	shipmentRepo repository.ShipmentRepository
	vehicleRepo  repository.VehicleRepository
	branchRepo   repository.BranchRepository
	authRepo     repository.AuthRepository
	routeSvc     *RouteService
	shipmentSvc  *ShipmentService
	osrmClient   *osrm.Client // nullable; sin OSRM se usa Haversine para la matriz
}

func NewRoutingService(
	cfgSvc *RoutingConfigService,
	shipmentRepo repository.ShipmentRepository,
	vehicleRepo repository.VehicleRepository,
	branchRepo repository.BranchRepository,
	authRepo repository.AuthRepository,
	routeSvc *RouteService,
	shipmentSvc *ShipmentService,
	osrmClient *osrm.Client,
) *RoutingService {
	return &RoutingService{
		cfgSvc:       cfgSvc,
		shipmentRepo: shipmentRepo,
		vehicleRepo:  vehicleRepo,
		branchRepo:   branchRepo,
		authRepo:     authRepo,
		routeSvc:     routeSvc,
		shipmentSvc:  shipmentSvc,
		osrmClient:   osrmClient,
	}
}

const lastMileDestLabel = "(última milla)"

// =============================================================================
// GeneratePlan
// =============================================================================

func (s *RoutingService) GeneratePlan(_ context.Context, branchID string) (model.RoutingPlan, error) {
	cfg := s.cfgSvc.Get()
	now := time.Now().UTC()

	plan := model.RoutingPlan{
		BranchID:       branchID,
		GeneratedAt:    now,
		LastMile:       []model.LastMileAssignment{},
		InterBranch:    []model.InterBranchAssignment{},
		Unassigned:     []model.UnassignedShipment{},
		BlockedDrivers: []model.BlockedDriver{},
		DriverLoads:    []model.DriverLoad{},
		VehicleLoads:   []model.VehicleLoad{},
		ConfigSnapshot: cfg,
	}

	// 1) Cargar candidatos en la sucursal y particionar
	all, err := s.shipmentRepo.List(model.ShipmentFilter{ReceivingBranchID: branchID})
	if err != nil {
		return model.RoutingPlan{}, err
	}

	var lastMileQ []model.Shipment
	interBranchQ := map[string][]model.Shipment{}
	shipmentByTID := map[string]model.Shipment{}
	for _, sh := range all {
		// La query del proyector incluye in-transit hacia nosotros vía OR — descartar
		if sh.ReceivingBranchID != branchID {
			continue
		}
		// Estados elegibles para participar del plan:
		//  - at_hub / at_origin_hub: envíos esperando despacho.
		//  - redelivery_scheduled: reentregas agendadas, listas para una nueva
		//    salida de última milla (vuelven a out_for_delivery al aplicarse).
		if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub && sh.Status != model.StatusRedeliveryScheduled {
			continue
		}
		if sh.DeliveryMethod == model.DeliveryMethodBranchPickup {
			continue
		}

		// Returns: el destino es el origin_branch del envío, no el final.
		// No participan de última milla — al llegar al origen auto-pasan a ready_for_return.
		if sh.IsReturning {
			dest := sh.OriginBranchID
			if dest == "" || dest == branchID {
				continue // ya en origen (lo maneja la auto-transición a ready_for_return)
			}
			interBranchQ[dest] = append(interBranchQ[dest], sh)
			shipmentByTID[sh.TrackingID] = sh
			continue
		}

		if sh.FinalBranchID == branchID && sh.DeliveryMethod == model.DeliveryMethodLastMile &&
			(sh.Status == model.StatusAtHub || sh.Status == model.StatusRedeliveryScheduled) {
			lastMileQ = append(lastMileQ, sh)
			shipmentByTID[sh.TrackingID] = sh
			continue
		}
		// Reentregas en una sucursal que NO es la final no aplican: solo se reprograma
		// la última milla, el inter-sucursal ya pasó.
		if sh.Status == model.StatusRedeliveryScheduled {
			continue
		}
		if sh.FinalBranchID != branchID && sh.FinalBranchID != "" {
			interBranchQ[sh.FinalBranchID] = append(interBranchQ[sh.FinalBranchID], sh)
			shipmentByTID[sh.TrackingID] = sh
			continue
		}
		// Edge: at_origin_hub + final == branch (no es ruteable hoy) → no entra al plan
	}

	// 2) Última milla — VRP optimizado (con fallback automático al greedy)
	plan.LastMile, plan.Unassigned, plan.BlockedDrivers = s.lastMileVRP(lastMileQ, branchID, cfg, plan.Unassigned, plan.BlockedDrivers, now)

	// Cargas pendientes de los choferes no bloqueados (incluso los que el algoritmo
	// no usó en este plan). Sirve para validación cliente-side al reasignar manual.
	blockedSet := map[string]bool{}
	for _, b := range plan.BlockedDrivers {
		blockedSet[b.DriverID] = true
	}
	for _, d := range s.authRepo.ListByRole(model.RoleDriver, branchID) {
		if blockedSet[d.ID] {
			continue
		}
		count, weight := s.routeSvc.PendingLoad(d.ID, model.NewDateOnly(now))
		existingTIDs := s.routeSvc.PendingShipments(d.ID, model.NewDateOnly(now))
		plan.DriverLoads = append(plan.DriverLoads, model.DriverLoad{
			DriverID:          d.ID,
			DriverName:        driverDisplayName(d),
			ExistingCount:     count,
			ExistingWeightKg:  roundKg(weight),
			ExistingShipments: existingTIDs,
		})
	}

	// 3) Inter-sucursal — agrupar por destino, aplicar reglas, asignar vehículo
	availableVehicles, existingVehicleLoad := s.filterAvailableVehicles(branchID)
	plan.InterBranch, plan.Unassigned = s.dispatchInterBranch(interBranchQ, availableVehicles, existingVehicleLoad, cfg, now, plan.Unassigned)

	// Cargas actuales de cada vehículo del pool — útil cuando el operador
	// reasigna manualmente a un vehículo que no entró al plan.
	for _, v := range availableVehicles {
		// Copia defensiva: AssignedShipments podría compartir backing con
		// el slice del repo. El cliente solo lee, pero igual evitamos sorpresas.
		existingTIDs := append([]string(nil), v.AssignedShipments...)
		plan.VehicleLoads = append(plan.VehicleLoads, model.VehicleLoad{
			VehicleID:         v.ID,
			LicensePlate:      v.LicensePlate,
			CapacityKg:        v.CapacityKg,
			ExistingWeightKg:  roundKg(existingVehicleLoad[v.ID]),
			ExistingShipments: existingTIDs,
		})
	}

	// 4) Piggyback — sumar envíos huérfanos a despachos que los acerquen a su destino final
	s.piggybackUnassigned(&plan, branchID, shipmentByTID)

	// Orden determinístico de salida
	sort.SliceStable(plan.InterBranch, func(i, j int) bool {
		return plan.InterBranch[i].DestinationBranch < plan.InterBranch[j].DestinationBranch
	})
	sort.SliceStable(plan.LastMile, func(i, j int) bool {
		return plan.LastMile[i].DriverID < plan.LastMile[j].DriverID
	})
	sort.SliceStable(plan.Unassigned, func(i, j int) bool {
		if plan.Unassigned[i].Destination != plan.Unassigned[j].Destination {
			return plan.Unassigned[i].Destination < plan.Unassigned[j].Destination
		}
		return plan.Unassigned[i].TrackingID < plan.Unassigned[j].TrackingID
	})

	// Garantizar arrays vacíos (no nil) para que el JSON sea estable cliente-side
	if plan.LastMile == nil {
		plan.LastMile = []model.LastMileAssignment{}
	}
	if plan.InterBranch == nil {
		plan.InterBranch = []model.InterBranchAssignment{}
	}
	if plan.Unassigned == nil {
		plan.Unassigned = []model.UnassignedShipment{}
	}
	if plan.BlockedDrivers == nil {
		plan.BlockedDrivers = []model.BlockedDriver{}
	}
	if plan.DriverLoads == nil {
		plan.DriverLoads = []model.DriverLoad{}
	}
	if plan.VehicleLoads == nil {
		plan.VehicleLoads = []model.VehicleLoad{}
	}

	return plan, nil
}

// binPackLastMile asigna envíos a choferes de la sucursal con tope por chofer.
// Excluye choferes cuya ruta del día ya está iniciada — el chofer ya salió y
// no puede recibir más envíos hasta que finalice o reabra su ruta.
func (s *RoutingService) binPackLastMile(
	queue []model.Shipment,
	branchID string,
	cfg model.RoutingConfig,
	unassigned []model.UnassignedShipment,
	blocked []model.BlockedDriver,
) ([]model.LastMileAssignment, []model.UnassignedShipment, []model.BlockedDriver) {
	allDrivers := s.authRepo.ListByRole(model.RoleDriver, branchID)
	today := model.NewDateOnly(time.Now().UTC())

	var drivers []model.User
	for _, d := range allDrivers {
		if err := s.routeSvc.CanAssignToRoute(d.ID, today); err != nil {
			blocked = append(blocked, model.BlockedDriver{
				DriverID:   d.ID,
				DriverName: driverDisplayName(d),
				Reason:     "ruta_ya_iniciada",
			})
			continue
		}
		drivers = append(drivers, d)
	}

	if len(queue) == 0 {
		return nil, unassigned, blocked
	}

	if len(drivers) == 0 {
		reason := "sin_choferes_disponibles"
		if len(allDrivers) > 0 {
			reason = "choferes_ya_iniciaron_ruta"
		}
		for _, sh := range queue {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      reason,
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
		return nil, unassigned, blocked
	}

	sortShipmentsForRouting(queue)

	type bucket struct {
		driver            model.User
		shipments         []string
		weight            float64 // peso de los envíos NUEVOS de este plan
		existingCount     int     // envíos ya en la ruta pendiente del día
		existingWeightKg  float64
		existingShipments []string
	}
	buckets := make([]*bucket, len(drivers))
	// Orden estable de drivers por ID para load-balancing determinístico
	driversCopy := make([]model.User, len(drivers))
	copy(driversCopy, drivers)
	sort.SliceStable(driversCopy, func(i, j int) bool { return driversCopy[i].ID < driversCopy[j].ID })
	for i, d := range driversCopy {
		// Pre-cargamos cada bucket con la carga pendiente del chofer en su ruta
		// del día. Sin esto, aplicar el plan varias veces seguidas iría sumando
		// envíos al mismo chofer hasta superar el peso máximo configurado.
		count, weight := s.routeSvc.PendingLoad(d.ID, today)
		existingTIDs := s.routeSvc.PendingShipments(d.ID, today)
		buckets[i] = &bucket{
			driver:            d,
			existingCount:     count,
			existingWeightKg:  weight,
			existingShipments: existingTIDs,
		}
	}

	pickBucket := func(sh model.Shipment) *bucket {
		var chosen *bucket
		for _, b := range buckets {
			if b.existingCount+len(b.shipments) >= cfg.MaxShipmentsPerDriver {
				continue
			}
			if b.existingWeightKg+b.weight+sh.WeightKg > cfg.MaxWeightKgPerDriver {
				continue
			}
			// Load-balancing por carga total proyectada del chofer.
			if chosen == nil || (b.existingWeightKg+b.weight) < (chosen.existingWeightKg+chosen.weight) {
				chosen = b
			}
		}
		return chosen
	}

	for _, sh := range queue {
		b := pickBucket(sh)
		if b == nil {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_capacidad_en_choferes",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
			continue
		}
		b.shipments = append(b.shipments, sh.TrackingID)
		b.weight += sh.WeightKg
	}

	var out []model.LastMileAssignment
	for _, b := range buckets {
		if len(b.shipments) == 0 {
			continue
		}
		out = append(out, model.LastMileAssignment{
			DriverID:          b.driver.ID,
			DriverName:        driverDisplayName(b.driver),
			Shipments:         b.shipments,
			TotalWeightKg:     roundKg(b.weight),
			ExistingCount:     b.existingCount,
			ExistingWeightKg:  roundKg(b.existingWeightKg),
			ExistingShipments: b.existingShipments,
		})
	}
	return out, unassigned, blocked
}

// filterAvailableVehicles devuelve los vehículos elegibles para despacho desde la
// sucursal y un mapa con la carga ya asignada (sumatoria de los pesos de los
// envíos en AssignedShipments). Los vehículos en_carga pueden quedar ya cargados
// parcialmente entre planes — esa carga se descuenta de la capacidad disponible.
func (s *RoutingService) filterAvailableVehicles(branchID string) ([]model.Vehicle, map[string]float64) {
	all := s.vehicleRepo.List()
	var out []model.Vehicle
	existing := map[string]float64{}
	for _, v := range all {
		if v.AssignedBranch == nil || *v.AssignedBranch != branchID {
			continue
		}
		if v.Status != model.VehicleStatusAvailable && v.Status != model.VehicleStatusLoading {
			continue
		}
		var loaded float64
		for _, tid := range v.AssignedShipments {
			sh, err := s.shipmentRepo.GetByTrackingID(tid)
			if err != nil {
				continue
			}
			loaded += sh.WeightKg
		}
		existing[v.ID] = loaded
		out = append(out, v)
	}
	// Orden determinístico
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CapacityKg != out[j].CapacityKg {
			return out[i].CapacityKg < out[j].CapacityKg
		}
		return out[i].LicensePlate < out[j].LicensePlate
	})
	return out, existing
}

// dispatchInterBranch evalúa cada destino y arma los despachos.
// existingLoad mapea vehicle_id → kg ya asignados al vehículo en este momento;
// se descuenta de la capacidad disponible para no proponer cargas que excedan
// el cap real del vehículo cuando ya viene parcialmente cargado.
func (s *RoutingService) dispatchInterBranch(
	groups map[string][]model.Shipment,
	pool []model.Vehicle,
	existingLoad map[string]float64,
	cfg model.RoutingConfig,
	now time.Time,
	unassigned []model.UnassignedShipment,
) ([]model.InterBranchAssignment, []model.UnassignedShipment) {
	if len(groups) == 0 {
		return nil, unassigned
	}

	// Si no hay vehículos en pool del branch, todos al unassigned con motivo claro
	if len(pool) == 0 {
		for dest, group := range groups {
			for _, sh := range group {
				unassigned = append(unassigned, model.UnassignedShipment{
					TrackingID:  sh.TrackingID,
					Destination: dest,
					Reason:      "sin_vehiculos_disponibles",
					WeightKg:    sh.WeightKg,
					Priority:    sh.Priority,
				})
			}
		}
		return nil, unassigned
	}

	// Iterar destinos en orden alfabético para reproducibilidad
	destKeys := make([]string, 0, len(groups))
	for k := range groups {
		destKeys = append(destKeys, k)
	}
	sort.Strings(destKeys)

	used := map[string]bool{}
	var dispatches []model.InterBranchAssignment

	for _, dest := range destKeys {
		group := groups[dest]
		sortShipmentsForRouting(group)

		poolForDest := vehiclesAcceptingDest(pool, dest, used)
		largestAvailableCap := largestAvailableCapacity(poolForDest, existingLoad)
		totalWeight := sumWeights(group)

		forced := anyForced(group, cfg, now)
		var rule model.DispatchRule
		shouldDispatch := false
		if forced {
			rule = model.DispatchRuleSLA
			shouldDispatch = true
		} else if largestAvailableCap > 0 && totalWeight >= cfg.MinFillRate*largestAvailableCap {
			rule = model.DispatchRuleConsolidation
			shouldDispatch = true
		}

		if !shouldDispatch {
			for _, sh := range group {
				unassigned = append(unassigned, model.UnassignedShipment{
					TrackingID:  sh.TrackingID,
					Destination: dest,
					Reason:      "esperando_consolidacion",
					WeightKg:    sh.WeightKg,
					Priority:    sh.Priority,
				})
			}
			continue
		}

		if len(poolForDest) == 0 {
			for _, sh := range group {
				unassigned = append(unassigned, model.UnassignedShipment{
					TrackingID:  sh.TrackingID,
					Destination: dest,
					Reason:      "sin_vehiculos_para_destino",
					WeightKg:    sh.WeightKg,
					Priority:    sh.Priority,
				})
			}
			continue
		}

		chosen, included, excluded := selectAndPack(poolForDest, existingLoad, group)
		if chosen == nil {
			for _, sh := range group {
				unassigned = append(unassigned, model.UnassignedShipment{
					TrackingID:  sh.TrackingID,
					Destination: dest,
					Reason:      "sin_vehiculos_para_destino",
					WeightKg:    sh.WeightKg,
					Priority:    sh.Priority,
				})
			}
			continue
		}

		ids := make([]string, len(included))
		for i, sh := range included {
			ids[i] = sh.TrackingID
		}
		dispatches = append(dispatches, model.InterBranchAssignment{
			VehicleID:         chosen.ID,
			LicensePlate:      chosen.LicensePlate,
			DestinationBranch: dest,
			Rule:              rule,
			Shipments:         ids,
			TotalWeightKg:     roundKg(sumWeights(included)),
			CapacityKg:        chosen.CapacityKg,
			ExistingWeightKg:  roundKg(existingLoad[chosen.ID]),
			ExistingShipments: append([]string(nil), chosen.AssignedShipments...),
		})
		used[chosen.ID] = true

		for _, sh := range excluded {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: dest,
				Reason:      "sobrepeso_excede_vehiculo",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
	}

	return dispatches, unassigned
}

// =============================================================================
// ApplyPlan — per-item best-effort, valida drift contra estado actual
// =============================================================================

func (s *RoutingService) ApplyPlan(_ context.Context, branchID string, req model.ApplyPlanRequest, username string) (model.ApplyPlanResponse, error) {
	plan := req.Plan
	today := model.NewDateOnly(time.Now().UTC())
	// Inicializamos como empty (no nil) para que el JSON siempre serialice
	// como `[]` y no como `null` — el frontend asume array.
	items := make([]model.ApplyResultItem, 0)

	// === Última milla ===
	for _, asgmt := range plan.LastMile {
		target := "driver:" + asgmt.DriverID
		// Drift check: si el chofer arrancó la ruta entre Generate y Apply,
		// rechazamos todos los items del bucket — no podemos sumarle envíos.
		if err := s.routeSvc.CanAssignToRoute(asgmt.DriverID, today); err != nil {
			for _, tid := range asgmt.Shipments {
				items = append(items, failedItem(tid, target, "ruta_ya_iniciada"))
			}
			continue
		}
		for _, tid := range asgmt.Shipments {
			sh, err := s.shipmentRepo.GetByTrackingID(tid)
			if err != nil {
				items = append(items, failedItem(tid, target, "envio_no_encontrado"))
				continue
			}
			if sh.ReceivingBranchID != branchID {
				items = append(items, failedItem(tid, target, "envio_no_pertenece_a_sucursal"))
				continue
			}
			// Aceptamos at_hub (primer despacho) y redelivery_scheduled (reintento).
			// Ambos transicionan limpiamente a out_for_delivery.
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusRedeliveryScheduled {
				items = append(items, failedItem(tid, target, "estado_cambio:"+string(sh.Status)))
				continue
			}

			_, err = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusOutForDelivery,
				ChangedBy: username,
				DriverID:  asgmt.DriverID,
				Notes:     "Asignado vía planificador de ruteo",
			})
			if err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}

			_ = s.routeSvc.RemoveShipmentFromTodayRoute(tid)
			if err := s.routeSvc.AddShipmentToDriverRoute(asgmt.DriverID, tid, today); err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}

			items = append(items, model.ApplyResultItem{
				TrackingID: tid,
				Target:     target,
				Status:     "applied",
			})
		}
	}

	// === Inter-sucursal ===
	for _, asgmt := range plan.InterBranch {
		target := "vehicle:" + asgmt.LicensePlate
		v, ok := s.vehicleRepo.GetByID(asgmt.VehicleID)
		if !ok {
			for _, tid := range asgmt.Shipments {
				items = append(items, failedItem(tid, target, "vehiculo_no_encontrado"))
			}
			continue
		}
		if v.AssignedBranch == nil || *v.AssignedBranch != branchID {
			for _, tid := range asgmt.Shipments {
				items = append(items, failedItem(tid, target, "vehiculo_no_pertenece_a_sucursal"))
			}
			continue
		}
		if v.Status != model.VehicleStatusAvailable && v.Status != model.VehicleStatusLoading {
			for _, tid := range asgmt.Shipments {
				items = append(items, failedItem(tid, target, "vehiculo_no_disponible"))
			}
			continue
		}
		if v.DestinationBranch != nil && *v.DestinationBranch != asgmt.DestinationBranch {
			for _, tid := range asgmt.Shipments {
				items = append(items, failedItem(tid, target, "vehiculo_destino_diferente"))
			}
			continue
		}

		if v.DestinationBranch == nil {
			destCopy := asgmt.DestinationBranch
			if err := s.vehicleRepo.SetDestinationBranch(v.ID, &destCopy); err != nil {
				for _, tid := range asgmt.Shipments {
					items = append(items, failedItem(tid, target, "error_seteando_destino"))
				}
				continue
			}
		}

		// Re-leer carga actual del vehículo (puede haber cambiado entre Generate y Apply)
		currentLoad := 0.0
		for _, existingTID := range v.AssignedShipments {
			esh, err := s.shipmentRepo.GetByTrackingID(existingTID)
			if err == nil {
				currentLoad += esh.WeightKg
			}
		}

		anyApplied := false
		for _, tid := range asgmt.Shipments {
			sh, err := s.shipmentRepo.GetByTrackingID(tid)
			if err != nil {
				items = append(items, failedItem(tid, target, "envio_no_encontrado"))
				continue
			}
			if sh.ReceivingBranchID != branchID {
				items = append(items, failedItem(tid, target, "envio_no_pertenece_a_sucursal"))
				continue
			}
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub {
				items = append(items, failedItem(tid, target, "estado_cambio:"+string(sh.Status)))
				continue
			}
			if currentLoad+sh.WeightKg > v.CapacityKg {
				items = append(items, failedItem(tid, target, "capacidad_excedida"))
				continue
			}

			if err := s.vehicleRepo.AddShipment(v.ID, tid); err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}

			_, err = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusLoaded,
				ChangedBy: username,
				Location:  branchID,
				Notes:     "Cargado en " + v.LicensePlate + " vía planificador de ruteo",
			})
			if err != nil {
				_ = s.vehicleRepo.RemoveShipment(v.ID, tid) // best-effort rollback
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}

			currentLoad += sh.WeightKg
			anyApplied = true
			items = append(items, model.ApplyResultItem{
				TrackingID: tid,
				Target:     target,
				Status:     "applied",
			})
		}

		if anyApplied && v.Status == model.VehicleStatusAvailable {
			_ = s.vehicleRepo.UpdateStatusByUser(v.ID, model.VehicleStatusLoading, username)
		}
	}

	resp := model.ApplyPlanResponse{Items: items}
	for _, it := range items {
		if it.Status == "applied" {
			resp.AppliedCount++
		} else {
			resp.FailedCount++
		}
	}
	return resp, nil
}

// =============================================================================
// Helpers
// =============================================================================

// sortShipmentsForRouting ordena envíos por: priority_score DESC, time_window (morning>afternoon>flexible),
// created_at ASC, tracking_id ASC. Sort estable para reproducibilidad.
func sortShipmentsForRouting(s []model.Shipment) {
	sort.SliceStable(s, func(i, j int) bool {
		if s[i].PriorityScore != s[j].PriorityScore {
			return s[i].PriorityScore > s[j].PriorityScore
		}
		if r := timeWindowRank(s[i].TimeWindow) - timeWindowRank(s[j].TimeWindow); r != 0 {
			return r < 0
		}
		if !s[i].CreatedAt.Equal(s[j].CreatedAt) {
			return s[i].CreatedAt.Before(s[j].CreatedAt)
		}
		return s[i].TrackingID < s[j].TrackingID
	})
}

func timeWindowRank(tw model.TimeWindow) int {
	switch tw {
	case model.TimeWindowMorning:
		return 0
	case model.TimeWindowAfternoon:
		return 1
	default: // flexible o vacío
		return 2
	}
}

func anyForced(group []model.Shipment, cfg model.RoutingConfig, now time.Time) bool {
	slaHorizon := time.Duration(cfg.SLAForceHorizonHours) * time.Hour
	for _, sh := range group {
		if sh.EstimatedDeliveryAt != nil && sh.EstimatedDeliveryAt.Sub(now) < slaHorizon {
			return true
		}
		if sh.PriorityScore >= cfg.PriorityForceThreshold {
			return true
		}
	}
	return false
}

func vehiclesAcceptingDest(pool []model.Vehicle, dest string, used map[string]bool) []model.Vehicle {
	var out []model.Vehicle
	for _, v := range pool {
		if used[v.ID] {
			continue
		}
		if v.DestinationBranch != nil && *v.DestinationBranch != dest {
			continue
		}
		out = append(out, v)
	}
	return out
}

// largestAvailableCapacity devuelve la mayor capacidad libre del pool
// (CapacityKg menos lo ya cargado por planes previos al mismo destino).
func largestAvailableCapacity(pool []model.Vehicle, existingLoad map[string]float64) float64 {
	max := 0.0
	for _, v := range pool {
		avail := v.CapacityKg - existingLoad[v.ID]
		if avail > max {
			max = avail
		}
	}
	return max
}

func sumWeights(shipments []model.Shipment) float64 {
	total := 0.0
	for _, sh := range shipments {
		total += sh.WeightKg
	}
	return total
}

// selectAndPack elige el vehículo y bin-packea sobre la capacidad DISPONIBLE
// (CapacityKg menos la carga ya asignada). Esto evita que aplicar el plan
// varias veces seguidas sobrecargue al mismo vehículo.
//
// 1) si algún vehículo tiene capacidad disponible suficiente para toda la suma → el más chico que cubra
// 2) si ninguno cubre → el de mayor capacidad disponible, bin-pack por prioridad desc, sobrante a excluded.
func selectAndPack(pool []model.Vehicle, existingLoad map[string]float64, shipments []model.Shipment) (*model.Vehicle, []model.Shipment, []model.Shipment) {
	if len(pool) == 0 || len(shipments) == 0 {
		return nil, nil, nil
	}
	total := sumWeights(shipments)

	avail := func(v *model.Vehicle) float64 { return v.CapacityKg - existingLoad[v.ID] }

	// Intentar el de menor capacidad disponible que cubra todo
	var smallest *model.Vehicle
	for i := range pool {
		v := &pool[i]
		if avail(v) >= total {
			if smallest == nil || avail(v) < avail(smallest) {
				smallest = v
			}
		}
	}
	if smallest != nil {
		out := make([]model.Shipment, len(shipments))
		copy(out, shipments)
		return smallest, out, nil
	}

	// Ninguno cubre — usar el de mayor capacidad disponible y bin-pack
	largest := &pool[0]
	for i := range pool {
		if avail(&pool[i]) > avail(largest) {
			largest = &pool[i]
		}
	}
	if avail(largest) <= 0 {
		// No hay espacio en ningún vehículo
		return nil, nil, nil
	}
	used := 0.0
	cap := avail(largest)
	var included, excluded []model.Shipment
	for _, sh := range shipments {
		if used+sh.WeightKg <= cap {
			included = append(included, sh)
			used += sh.WeightKg
		} else {
			excluded = append(excluded, sh)
		}
	}
	return largest, included, excluded
}

func failedItem(trackingID, target, reason string) model.ApplyResultItem {
	return model.ApplyResultItem{
		TrackingID: trackingID,
		Target:     target,
		Status:     "failed",
		Error:      reason,
	}
}

func driverDisplayName(u model.User) string {
	full := u.FirstName
	if u.LastName != "" {
		if full != "" {
			full += " "
		}
		full += u.LastName
	}
	if full == "" {
		return u.Username
	}
	return full
}

// roundKg redondea a 2 decimales para evitar artefactos de punto flotante en JSON.
func roundKg(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

// piggybackUnassigned agrega envíos sin asignar a despachos ya armados cuando el destino
// del despacho está más cerca del final del envío que la sucursal actual. Solo se intenta
// con envíos huérfanos por motivos de ruteo (consolidación / sin vehículo / sobrepeso),
// no por motivos de última milla. La regla siempre busca la mayor mejora de distancia.
func (s *RoutingService) piggybackUnassigned(plan *model.RoutingPlan, branchID string, shipmentByTID map[string]model.Shipment) {
	if len(plan.Unassigned) == 0 || len(plan.InterBranch) == 0 {
		return
	}

	piggybackable := map[string]bool{
		"esperando_consolidacion":     true,
		"sin_vehiculos_para_destino":  true,
		"sobrepeso_excede_vehiculo":   true,
		"sin_vehiculos_disponibles":   true,
	}

	var stillUnassigned []model.UnassignedShipment
	for _, u := range plan.Unassigned {
		if !piggybackable[u.Reason] {
			stillUnassigned = append(stillUnassigned, u)
			continue
		}
		sh, ok := shipmentByTID[u.TrackingID]
		if !ok {
			stillUnassigned = append(stillUnassigned, u)
			continue
		}
		target := routingTarget(sh)
		if target == "" || target == branchID {
			stillUnassigned = append(stillUnassigned, u)
			continue
		}

		currentDist := s.branchDistance(branchID, target)
		if currentDist <= 0 {
			stillUnassigned = append(stillUnassigned, u)
			continue
		}

		bestIdx := -1
		bestImprovement := 0.0
		for i := range plan.InterBranch {
			d := &plan.InterBranch[i]
			if d.DestinationBranch == branchID {
				continue
			}
			newDist := s.branchDistance(d.DestinationBranch, target)
			if newDist < 0 {
				continue
			}
			improvement := currentDist - newDist
			if improvement <= 0 {
				continue
			}
			if d.ExistingWeightKg+d.TotalWeightKg+sh.WeightKg > d.CapacityKg {
				continue
			}
			if improvement > bestImprovement {
				bestImprovement = improvement
				bestIdx = i
			}
		}

		if bestIdx == -1 {
			stillUnassigned = append(stillUnassigned, u)
			continue
		}

		d := &plan.InterBranch[bestIdx]
		d.Shipments = append(d.Shipments, u.TrackingID)
		d.TotalWeightKg = roundKg(d.TotalWeightKg + sh.WeightKg)
	}

	plan.Unassigned = stillUnassigned
}

// routingTarget devuelve la sucursal destino del envío para fines de ruteo.
// Para envíos en retorno, es el origen (a donde tiene que volver).
// Para el resto, es el final_branch.
func routingTarget(sh model.Shipment) string {
	if sh.IsReturning {
		return sh.OriginBranchID
	}
	return sh.FinalBranchID
}

// branchDistance devuelve la distancia en km entre dos sucursales.
// Usa lat/lng si ambas las tienen; fallback a la distancia entre provincias.
// Devuelve -1 si alguna sucursal no se encuentra.
func (s *RoutingService) branchDistance(b1, b2 string) float64 {
	if b1 == b2 {
		return 0
	}
	br1, ok1 := s.branchRepo.GetByID(b1)
	br2, ok2 := s.branchRepo.GetByID(b2)
	if !ok1 || !ok2 {
		return -1
	}
	if br1.Latitude != nil && br1.Longitude != nil && br2.Latitude != nil && br2.Longitude != nil {
		return ml.HaversineKm(*br1.Latitude, *br1.Longitude, *br2.Latitude, *br2.Longitude)
	}
	return ml.ComputeDistance(br1.Province, br2.Province)
}

// =============================================================================
// VRP — última milla optimizada
// =============================================================================

// lastMileVRP es el reemplazo de binPackLastMile cuando hay coordenadas
// disponibles. Construye una matriz de tiempos (OSRM o Haversine) y resuelve
// el VRP con el solver del paquete vrp. Si el depósito no tiene coordenadas,
// si ningún envío las tiene, o si el solver falla, cae al greedy clásico.
//
// Mantiene la semántica de binPackLastMile: choferes con ruta ya iniciada
// quedan en `blocked`, envíos no asignables quedan en `unassigned`. Lo nuevo
// es que cada LastMileAssignment trae OrderedStops con la secuencia óptima
// y horas estimadas de llegada.
func (s *RoutingService) lastMileVRP(
	queue []model.Shipment,
	branchID string,
	cfg model.RoutingConfig,
	unassigned []model.UnassignedShipment,
	blocked []model.BlockedDriver,
	now time.Time,
) ([]model.LastMileAssignment, []model.UnassignedShipment, []model.BlockedDriver) {
	if len(queue) == 0 {
		return nil, unassigned, blocked
	}

	depot, ok := s.branchRepo.GetByID(branchID)
	if !ok || depot.Latitude == nil || depot.Longitude == nil {
		// Sin coords del depósito el VRP no es posible — fallback al greedy.
		return s.binPackLastMile(queue, branchID, cfg, unassigned, blocked)
	}

	// Filtro de drivers: idéntico a binPackLastMile (replicar la lógica
	// asegura que ambos paths tengan el mismo comportamiento de bloqueos).
	allDrivers := s.authRepo.ListByRole(model.RoleDriver, branchID)
	today := model.NewDateOnly(now)
	var drivers []model.User
	for _, d := range allDrivers {
		if err := s.routeSvc.CanAssignToRoute(d.ID, today); err != nil {
			blocked = append(blocked, model.BlockedDriver{
				DriverID:   d.ID,
				DriverName: driverDisplayName(d),
				Reason:     "ruta_ya_iniciada",
			})
			continue
		}
		drivers = append(drivers, d)
	}

	if len(drivers) == 0 {
		reason := "sin_choferes_disponibles"
		if len(allDrivers) > 0 {
			reason = "choferes_ya_iniciaron_ruta"
		}
		for _, sh := range queue {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      reason,
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
		return nil, unassigned, blocked
	}

	// Particionar la cola entre envíos con coords (entran al solver) y
	// envíos sin coords (se cuelgan al final de alguna ruta como unsequenced).
	var withCoords, withoutCoords []model.Shipment
	for _, sh := range queue {
		if sh.Recipient.Address.Latitude != nil && sh.Recipient.Address.Longitude != nil {
			withCoords = append(withCoords, sh)
		} else {
			withoutCoords = append(withoutCoords, sh)
		}
	}
	if len(withCoords) == 0 {
		return s.binPackLastMile(queue, branchID, cfg, unassigned, blocked)
	}

	// Construir Problem.
	depotCoord := vrp.Coord{Lat: *depot.Latitude, Lon: *depot.Longitude}
	deliveries := make([]vrp.Node, len(withCoords))
	deliveryCoords := make([]vrp.Coord, len(withCoords))
	for i, sh := range withCoords {
		c := vrp.Coord{Lat: *sh.Recipient.Address.Latitude, Lon: *sh.Recipient.Address.Longitude}
		deliveries[i] = vrp.Node{
			ID:         sh.TrackingID,
			Coord:      c,
			WeightKg:   sh.WeightKg,
			TimeWindow: sh.TimeWindow,
		}
		deliveryCoords[i] = c
	}

	vrpDrivers := make([]vrp.Driver, len(drivers))
	for i, d := range drivers {
		count, weight := s.routeSvc.PendingLoad(d.ID, today)
		vrpDrivers[i] = vrp.Driver{
			ID:               d.ID,
			MaxShipments:     cfg.MaxShipmentsPerDriver,
			MaxWeightKg:      cfg.MaxWeightKgPerDriver,
			ExistingCount:    count,
			ExistingWeightKg: weight,
		}
	}

	dur, dist := s.buildDurationMatrix(depotCoord, deliveryCoords)

	// DepartureMin: si el operador genera el plan después de las 8:00, las
	// horas estimadas tienen que partir de la hora actual, no de las 8:00.
	departureMin := float64(now.Hour()*60 + now.Minute())
	if departureMin < 8*60 {
		departureMin = 8 * 60
	}

	problem := vrp.Problem{
		Depot:          vrp.Node{ID: "depot", Coord: depotCoord},
		Deliveries:     deliveries,
		Drivers:        vrpDrivers,
		DurationMatrix: dur,
		DistanceMatrix: dist,
		DepartureMin:   departureMin,
		// 10 minutos por parada: contempla estacionar, salir del vehículo,
		// llamar al cliente, esperar que abra, entregar y hacer firmar,
		// y retomar la marcha. Para zonas con porteros/edificios suele ser
		// más alto; para zonas residenciales rápidas, menos. Promediamos.
		ServiceTimeMin: 10,
		DayEndMin:      18 * 60,
	}

	sol := vrp.Solve(problem)

	// Si el solver no produjo nada y nada quedó como unassigned, algo raro
	// pasó — caemos al greedy para no devolver un plan vacío.
	if len(sol.Routes) == 0 && len(sol.Unassigned) == 0 {
		log.Printf("[routing] VRP devolvió solución vacía, fallback a greedy (branch=%s, n=%d)", branchID, len(withCoords))
		return s.binPackLastMile(queue, branchID, cfg, unassigned, blocked)
	}

	// Mapear routes → LastMileAssignment.
	driverByID := map[string]model.User{}
	for _, d := range drivers {
		driverByID[d.ID] = d
	}
	shipByTID := map[string]model.Shipment{}
	for _, sh := range withCoords {
		shipByTID[sh.TrackingID] = sh
	}
	type existing struct {
		count     int
		weight    float64
		shipments []string
	}
	existingByDriver := map[string]existing{}
	for _, vd := range vrpDrivers {
		existingByDriver[vd.ID] = existing{
			count:     vd.ExistingCount,
			weight:    vd.ExistingWeightKg,
			shipments: s.routeSvc.PendingShipments(vd.ID, today),
		}
	}

	out := make([]model.LastMileAssignment, 0, len(sol.Routes))
	for _, r := range sol.Routes {
		stops := make([]model.RouteStop, len(r.Stops))
		shipIDs := make([]string, len(r.Stops))
		totalWeight := 0.0
		for i, st := range r.Stops {
			sh := shipByTID[st.NodeID]
			stops[i] = model.RouteStop{
				TrackingID: st.NodeID,
				Sequence:   i + 1,
				ArrivalMin: int(st.ArrivalMin + 0.5),
				TimeWindow: string(sh.TimeWindow),
				WeightKg:   sh.WeightKg,
			}
			shipIDs[i] = st.NodeID
			totalWeight += sh.WeightKg
		}
		ex := existingByDriver[r.DriverID]
		drv := driverByID[r.DriverID]
		out = append(out, model.LastMileAssignment{
			DriverID:          r.DriverID,
			DriverName:        driverDisplayName(drv),
			Shipments:         shipIDs,
			TotalWeightKg:     roundKg(totalWeight),
			ExistingCount:     ex.count,
			ExistingWeightKg:  roundKg(ex.weight),
			ExistingShipments: ex.shipments,
			OrderedStops:      stops,
			TotalDistanceKm:   roundKg(r.TotalDistanceKm),
			TotalDurationMin:  int(r.TotalDurationMin + 0.5),
			DepartureMin:      int(departureMin + 0.5),
			OptimizedBy:       "vrp",
		})
	}

	// Mapear Unassigned del solver → UnassignedShipment del plan.
	for _, u := range sol.Unassigned {
		sh := shipByTID[u.NodeID]
		unassigned = append(unassigned, model.UnassignedShipment{
			TrackingID:  u.NodeID,
			Destination: lastMileDestLabel,
			Reason:      string(u.Reason),
			WeightKg:    sh.WeightKg,
			Priority:    sh.Priority,
		})
	}

	// Distribuir envíos sin coords como paradas unsequenced en la ruta más
	// liviana que tenga capacidad. Si no hay rutas (todo quedó unassigned)
	// o todas están al tope, van al unassigned con razón de capacidad.
	for _, sh := range withoutCoords {
		best := -1
		for i := range out {
			a := &out[i]
			drv := vrpDriverByID(vrpDrivers, a.DriverID)
			projCount := len(a.Shipments) + a.ExistingCount + 1
			projWeight := a.TotalWeightKg + a.ExistingWeightKg + sh.WeightKg
			if projCount > drv.MaxShipments {
				continue
			}
			if projWeight > drv.MaxWeightKg {
				continue
			}
			if best == -1 || out[i].TotalDurationMin < out[best].TotalDurationMin {
				best = i
			}
		}
		if best == -1 {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_capacidad_en_choferes",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
			continue
		}
		a := &out[best]
		seq := len(a.OrderedStops) + 1
		a.OrderedStops = append(a.OrderedStops, model.RouteStop{
			TrackingID:  sh.TrackingID,
			Sequence:    seq,
			ArrivalMin:  -1,
			Unsequenced: true,
			TimeWindow:  string(sh.TimeWindow),
			WeightKg:    sh.WeightKg,
		})
		a.Shipments = append(a.Shipments, sh.TrackingID)
		a.TotalWeightKg = roundKg(a.TotalWeightKg + sh.WeightKg)
	}

	return out, unassigned, blocked
}

// buildDurationMatrix construye una matriz NxN (depot + entregas) con tiempos
// en segundos y distancias en metros. Intenta OSRM si hay cliente; si falla
// o no hay cliente, usa Haversine con factor de detour 1.3 y velocidad media
// urbana de 30 km/h.
func (s *RoutingService) buildDurationMatrix(depot vrp.Coord, deliveries []vrp.Coord) ([][]float64, [][]float64) {
	all := make([]vrp.Coord, 0, len(deliveries)+1)
	all = append(all, depot)
	all = append(all, deliveries...)

	if s.osrmClient != nil {
		osrmCoords := make([]osrm.Coord, len(all))
		for i, c := range all {
			osrmCoords[i] = osrm.Coord{Lat: c.Lat, Lon: c.Lon}
		}
		d, dt, err := s.osrmClient.DurationMatrix(osrmCoords)
		if err == nil {
			return d, dt
		}
		log.Printf("[routing] OSRM falló, fallback a Haversine: %v", err)
	}
	return haversineMatrix(all)
}

// haversineMatrix arma una matriz NxN con distancias Haversine (con factor
// de detour 1.3 para aproximar el desvío de calles vs línea recta) y duración
// asumiendo 30 km/h promedio. Diagonal en cero.
func haversineMatrix(coords []vrp.Coord) ([][]float64, [][]float64) {
	// detourFactor: las calles no son líneas rectas. 1.3 ≈ 30% más de recorrido
	// que la distancia Haversine en zonas urbanas argentinas típicas.
	// avgSpeedKmH: velocidad media puerta-a-puerta para vehículos urbanos en CABA
	// con tráfico moderado. Con OSRM activo este valor no se usa.
	const detourFactor = 1.3
	const avgSpeedKmH = 25.0
	n := len(coords)
	dur := make([][]float64, n)
	dist := make([][]float64, n)
	for i := 0; i < n; i++ {
		dur[i] = make([]float64, n)
		dist[i] = make([]float64, n)
		for j := 0; j < n; j++ {
			if i == j {
				continue
			}
			km := ml.HaversineKm(coords[i].Lat, coords[i].Lon, coords[j].Lat, coords[j].Lon) * detourFactor
			dist[i][j] = km * 1000
			dur[i][j] = km / avgSpeedKmH * 3600
		}
	}
	return dur, dist
}

func vrpDriverByID(drivers []vrp.Driver, id string) vrp.Driver {
	for _, d := range drivers {
		if d.ID == id {
			return d
		}
	}
	return vrp.Driver{}
}
