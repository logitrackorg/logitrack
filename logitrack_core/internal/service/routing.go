package service

import (
	"context"
	"fmt"
	"log"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/osrm"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/vrp"
)

// uuidGen es un alias para uuid.NewRandom para facilitar mocking en tests.
var uuidGen = func() (string, error) {
	id, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

// RoutingService genera y aplica el plan de ruteo diario.
//
// GeneratePlan genera un plan en memoria para una sucursal (uso interno y legado).
// GenerateGlobalPlan genera el plan de toda la red y lo persiste en routing_plans.
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
	planRepo     repository.RoutingPlanRepository
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
	planRepo repository.RoutingPlanRepository,
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
		planRepo:     planRepo,
		osrmClient:   osrmClient,
	}
}

const lastMileDestLabel = "(última milla)"

// =============================================================================
// GeneratePlan
// =============================================================================

func (s *RoutingService) GeneratePlan(_ context.Context, branchID string) (model.RoutingPlan, error) {
	cfg := s.cfgSvc.Get()
	now := clock.Now().UTC()

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
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))

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

	sortShipmentsForLastMile(queue)

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

	maximize := cfg.LastMilePackingStrategy == model.PackingStrategyMaximizeCapacity
	pickBucket := func(sh model.Shipment) *bucket {
		var chosen *bucket
		for _, b := range buckets {
			if b.existingWeightKg+b.weight+sh.WeightKg > 150 {
				continue
			}
			currLoad := b.existingWeightKg + b.weight
			if chosen == nil {
				chosen = b
				continue
			}
			chosenLoad := chosen.existingWeightKg + chosen.weight
			if maximize {
				// Saturar el chofer con mayor carga proyectada que aún tenga
				// capacidad — completa uno antes de abrir el siguiente.
				if currLoad > chosenLoad {
					chosen = b
				}
			} else {
				// Load-balancing: el chofer con menor carga proyectada.
				if currLoad < chosenLoad {
					chosen = b
				}
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
		totalWeight := sumWeights(group)
		refCap := fillRateCapacity(poolForDest, existingLoad, totalWeight)

		forced := anyForced(group, cfg, now)
		var rule model.DispatchRule
		shouldDispatch := false
		if forced {
			rule = model.DispatchRuleSLA
			shouldDispatch = true
		} else if refCap > 0 && totalWeight >= cfg.MinFillRate*refCap {
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
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
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
		// Persistir el horario sugerido de salida para que el chofer/supervisor
		// lo vea en /driver/route. DepartureMin > 0 indica que el motor de
		// ruteo (VRP scheduler) pudo calcularlo.
		if asgmt.DepartureMin > 0 {
			suggestedAt := dateAtMinute(today, asgmt.DepartureMin)
			_ = s.routeSvc.SetSuggestedStartTime(asgmt.DriverID, today, suggestedAt)
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

// sortShipmentsForLastMile ordena envíos para última milla priorizando la ventana
// horaria contratada por el cliente. Orden: time_window (morning>afternoon>flexible),
// priority_score DESC, created_at ASC, tracking_id ASC. Sort estable para reproducibilidad.
//
// La ventana horaria es un compromiso contractual con el destinatario y puede tener
// recargo (`time_window_multiplier`); por eso queda como criterio primario por encima
// del score de prioridad. La prioridad sigue ordenando dentro de la misma ventana.
func sortShipmentsForLastMile(s []model.Shipment) {
	sort.SliceStable(s, func(i, j int) bool {
		if r := timeWindowRank(s[i].TimeWindow) - timeWindowRank(s[j].TimeWindow); r != 0 {
			return r < 0
		}
		if s[i].PriorityScore != s[j].PriorityScore {
			return s[i].PriorityScore > s[j].PriorityScore
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

// fillRateCapacity devuelve la capacidad del vehículo a usar como referencia para
// el umbral de consolidación. Usa el más chico cuya capacidad disponible alcance el
// peso total; si ninguno alcanza, devuelve el de mayor capacidad disponible.
// Esto evita que un camión grande suba el umbral artificialmente cuando hay un
// vehículo adecuado al peso del grupo.
func fillRateCapacity(pool []model.Vehicle, existingLoad map[string]float64, totalWeight float64) float64 {
	best := 0.0
	// Buscar el más chico que cubre el peso
	for _, v := range pool {
		avail := v.CapacityKg - existingLoad[v.ID]
		if avail >= totalWeight {
			if best == 0.0 || avail < best {
				best = avail
			}
		}
	}
	if best > 0 {
		return best
	}
	// Si ninguno alcanza, usar el de mayor capacidad disponible
	for _, v := range pool {
		avail := v.CapacityKg - existingLoad[v.ID]
		if avail > best {
			best = avail
		}
	}
	return best
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
			MaxWeightKg:      150,
			ExistingCount:    count,
			ExistingWeightKg: weight,
		}
	}

	dur, dist := s.buildDurationMatrix(depotCoord, deliveryCoords, cfg.AvgSpeedKmh)

	// DepartureMin: si el operador genera el plan después de morning_window_start,
	// las horas estimadas parten de la hora actual; si no, parten del inicio
	// configurado de la ventana morning. Wall-clock local del operador (no UTC).
	local := now.In(clock.LocalTZ)
	departureMin := float64(local.Hour()*60 + local.Minute())
	morningStartMin := float64(cfg.MorningWindowStartHour) * 60
	if departureMin < morningStartMin {
		departureMin = morningStartMin
	}

	problem := vrp.Problem{
		Depot:                   vrp.Node{ID: "depot", Coord: depotCoord},
		Deliveries:              deliveries,
		Drivers:                 vrpDrivers,
		DurationMatrix:          dur,
		DistanceMatrix:          dist,
		DepartureMin:            departureMin,
		ServiceTimeMin:          float64(cfg.ServiceTimeMinutes),
		DayEndMin:               float64(cfg.AfternoonWindowEndHour) * 60,
		MorningWindowStartMin:   morningStartMin,
		MorningWindowEndMin:     float64(cfg.MorningWindowEndHour) * 60,
		AfternoonWindowStartMin: float64(cfg.AfternoonWindowStartHour) * 60,
		AfternoonWindowEndMin:   float64(cfg.AfternoonWindowEndHour) * 60,
		EnforceTimeWindows:      cfg.EnforceTimeWindows,
		PackingStrategy:         cfg.LastMilePackingStrategy,
	}

	// Index para sub-problems del scheduling (Fase 3): de tracking_id al
	// índice del shipment en `deliveries` global (necesario para cortar la
	// matriz de duraciones por chofer).
	indexByTID := make(map[string]int, len(withCoords))
	for i, sh := range withCoords {
		indexByTID[sh.TrackingID] = i
	}

	// Loop "abrir choferes hasta cubrir ventanas":
	// - Estrategia maximize_capacity: arranca con 1 chofer; si no logra 100%
	//   de cobertura de ventana en alguna ruta, agrega un chofer más y vuelve
	//   a resolver. Hasta cubrir o agotar choferes.
	// - Estrategia balanced: usa todos los choferes desde el principio (un
	//   solo pase del solver).
	activeCount := len(drivers)
	if cfg.LastMilePackingStrategy == model.PackingStrategyMaximizeCapacity {
		activeCount = 1
	}

	type optimizedRoute struct {
		departure float64
		route     vrp.Route
		coverage  float64
	}

	var sol vrp.Solution
	var perDriverOpt map[string]optimizedRoute
	for {
		if activeCount > len(drivers) {
			activeCount = len(drivers)
		}

		p := problem
		p.Drivers = vrpDrivers[:activeCount]
		sol = vrp.Solve(p)

		perDriverOpt = make(map[string]optimizedRoute, len(sol.Routes))
		allCovered := true
		for _, r := range sol.Routes {
			tids := make([]string, len(r.Stops))
			for i, st := range r.Stops {
				tids[i] = st.NodeID
			}
			var maxKg float64 = 150
			for _, vd := range vrpDrivers {
				if vd.ID == r.DriverID {
					maxKg = vd.MaxWeightKg
					break
				}
			}
			bestDep, bestRoute, cov := s.findBestDepartureForRoute(
				r.DriverID, maxKg, tids,
				depotCoord, deliveries, indexByTID,
				dur, dist, cfg, departureMin,
			)
			perDriverOpt[r.DriverID] = optimizedRoute{
				departure: bestDep,
				route:     bestRoute,
				coverage:  cov,
			}
			if cov < 1.0 {
				allCovered = false
			}
		}

		if allCovered || activeCount >= len(drivers) {
			break
		}
		activeCount++
	}

	// Sustituir las routes globales con las optimizadas (mismo set de
	// shipments por chofer, pero con orden recalculado para el mejor
	// departure encontrado).
	for i, r := range sol.Routes {
		opt, ok := perDriverOpt[r.DriverID]
		if !ok || opt.coverage == 0 {
			continue
		}
		opt.route.DriverID = r.DriverID
		sol.Routes[i] = opt.route
	}

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
			dev := 0
			if st.WindowDeviationMin != 0 {
				dev = int(st.WindowDeviationMin + 0.5)
				if st.WindowDeviationMin < 0 {
					dev = int(st.WindowDeviationMin - 0.5)
				}
			}
			stops[i] = model.RouteStop{
				TrackingID:         st.NodeID,
				Sequence:           i + 1,
				ArrivalMin:         int(st.ArrivalMin + 0.5),
				TimeWindow:         string(sh.TimeWindow),
				WeightKg:           sh.WeightKg,
				WithinWindow:       !st.OutOfWindow,
				WindowDeviationMin: dev,
			}
			shipIDs[i] = st.NodeID
			totalWeight += sh.WeightKg
		}
		ex := existingByDriver[r.DriverID]
		drv := driverByID[r.DriverID]
		// El bestDeparture per chofer (Fase 3) y la coverage calculada en
		// el loop de scheduling. Si no hay (chofer sin shipments asignados
		// o solver degenerado) caemos al departureMin global del problema.
		dep := departureMin
		coverage := 0.0
		if opt, ok := perDriverOpt[r.DriverID]; ok && opt.coverage > 0 {
			dep = opt.departure
			coverage = opt.coverage
		}
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
			DepartureMin:      int(dep + 0.5),
			OptimizedBy:       "vrp",
			WindowCoverage:    coverage,
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
			projWeight := a.TotalWeightKg + a.ExistingWeightKg + sh.WeightKg
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
// o no hay cliente, usa Haversine con factor de detour 1.3 y la velocidad
// configurada (avgSpeedKmh). Si avgSpeedKmh <= 0 usa 25 como fallback.
func (s *RoutingService) buildDurationMatrix(depot vrp.Coord, deliveries []vrp.Coord, avgSpeedKmh float64) ([][]float64, [][]float64) {
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
	return haversineMatrix(all, avgSpeedKmh)
}

// haversineMatrix arma una matriz NxN con distancias Haversine (con factor
// de detour 1.3 para aproximar el desvío de calles vs línea recta) y duración
// usando la velocidad configurada. Diagonal en cero.
func haversineMatrix(coords []vrp.Coord, avgSpeedKmh float64) ([][]float64, [][]float64) {
	// detourFactor: las calles no son líneas rectas. 1.3 ≈ 30% más de recorrido
	// que la distancia Haversine en zonas urbanas argentinas típicas.
	const detourFactor = 1.3
	if avgSpeedKmh <= 0 {
		avgSpeedKmh = 25.0
	}
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
			dur[i][j] = km / avgSpeedKmh * 3600
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

// =============================================================================
// Plan global — genera y persiste el plan de toda la red
// =============================================================================

// GenerateGlobalPlan genera el plan de ruteo para todas las sucursales activas
// y lo devuelve en memoria. No persiste. Útil para preview antes de persistir.
func (s *RoutingService) GenerateGlobalPlan(ctx context.Context) (*model.GlobalRoutingPlan, error) {
	now := clock.Now().UTC()
	local := now.In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

	branches := s.branchRepo.List()

	plan := &model.GlobalRoutingPlan{
		ID:          newUUID(),
		PlanDate:    planDate,
		Status:      model.PlanStatusPending,
		BranchPlans: []model.BranchPlan{},
		GeneratedAt: now,
	}

	totalCandidates := 0
	totalAssigned := 0
	totalUnassigned := 0

	for _, br := range branches {
		if br.Status != model.BranchStatusActive {
			continue
		}
		branchPlan, err := s.GeneratePlan(ctx, br.ID)
		if err != nil {
			log.Printf("[routing-global] error generando plan para sucursal %s: %v", br.ID, err)
			continue
		}
		plan.BranchPlans = append(plan.BranchPlans, model.BranchPlan{
			BranchID: br.ID,
			Plan:     branchPlan,
		})
		// Acumular métricas
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

	return plan, nil
}

// GenerateAndPersistGlobalPlan genera y persiste el plan del día.
// Si ya existe un plan para hoy y su status es "applied", no sobreescribe.
// Llamado por el scheduler a las 08:00 y por el endpoint /routing/regenerate.
func (s *RoutingService) GenerateAndPersistGlobalPlan(ctx context.Context) (*model.GlobalRoutingPlan, error) {
	plan, err := s.GenerateGlobalPlan(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.planRepo.Upsert(plan); err != nil {
		return nil, fmt.Errorf("routing global: persistir plan: %w", err)
	}
	log.Printf("[routing-global] plan %s generado: %d asignados, %d sin asignar, %d sucursales",
		plan.PlanDate, plan.Log.TotalAssigned, plan.Log.TotalUnassigned, plan.Log.TotalBranches)
	return plan, nil
}

// GetTodayPlan devuelve el plan global del día actual, filtrado por sucursal si el
// rol del usuario es operator o supervisor. Managers y admins ven el plan completo.
//
// Adicionalmente filtra cards de choferes que ya iniciaron su ruta del día y
// vehículos que ya están en tránsito: no aportan a la operativa actual y los
// envíos pendientes (no aplicados) se mueven a "Sin asignar" para que el
// operador pueda reasignarlos vía drag-and-drop o regenerar.
func (s *RoutingService) GetTodayPlan(userRole model.Role, userBranch string) (*model.GlobalRoutingPlan, error) {
	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")
	today := model.NewDateOnly(local)

	plan, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, nil
	}

	// Operator y supervisor solo ven los items de su sucursal.
	if userRole == model.RoleOperator || userRole == model.RoleSupervisor {
		filtered := make([]model.BranchPlan, 0, 1)
		for _, bp := range plan.BranchPlans {
			if bp.BranchID == userBranch {
				filtered = append(filtered, bp)
				break
			}
		}
		plan.BranchPlans = filtered
	}

	// Marcar cards de chofer/vehículo en marcha como informativas (runtime-only).
	// Sus envíos pendientes (no aplicados) van a "Sin asignar" para que el
	// operador pueda reasignarlos. Los aplicados se quedan en la card.
	allVehicles := s.vehicleRepo.List()
	for i := range plan.BranchPlans {
		bp := &plan.BranchPlans[i]

		for j := range bp.Plan.LastMile {
			lm := &bp.Plan.LastMile[j]
			if err := s.routeSvc.CanAssignToRoute(lm.DriverID, today); err != nil {
				bp.Plan.Unassigned = append(bp.Plan.Unassigned, s.movePendingToUnassigned(lm.Shipments, lm.AppliedShipments, lastMileDestLabel, "chofer_inicio_ruta")...)
				lm.RouteStarted = true
				lm.Shipments = append([]string(nil), lm.AppliedShipments...) // solo muestra los que efectivamente lleva
			}
		}

		for j := range bp.Plan.InterBranch {
			ib := &bp.Plan.InterBranch[j]
			v, ok := s.vehicleRepo.GetByID(ib.VehicleID)
			if ok && v.Status == model.VehicleStatusInTransit {
				bp.Plan.Unassigned = append(bp.Plan.Unassigned, s.movePendingToUnassigned(ib.Shipments, ib.AppliedShipments, ib.DestinationBranch, "vehiculo_en_viaje")...)
				ib.InTransit = true
				ib.Shipments = append([]string(nil), ib.AppliedShipments...)
			}
		}

		// Vehículos entrantes: de otras sucursales en tránsito hacia esta.
		incoming := make([]model.IncomingVehicle, 0)
		for _, v := range allVehicles {
			if v.Status != model.VehicleStatusInTransit {
				continue
			}
			if v.DestinationBranch == nil || *v.DestinationBranch != bp.BranchID {
				continue
			}
			origin := ""
			if v.AssignedBranch != nil {
				origin = *v.AssignedBranch
			}
			weight := 0.0
			tids := append([]string(nil), v.AssignedShipments...)
			for _, tid := range tids {
				if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
					weight += sh.WeightKg
				}
			}
			incoming = append(incoming, model.IncomingVehicle{
				VehicleID:     v.ID,
				LicensePlate:  v.LicensePlate,
				OriginBranch:  origin,
				Shipments:     tids,
				TotalWeightKg: weight,
				CapacityKg:    v.CapacityKg,
			})
		}
		bp.Plan.IncomingVehicles = incoming
	}

	return plan, nil
}

// movePendingToUnassigned construye UnassignedShipment para los envíos que están
// en `shipments` pero no en `applied` — los aplicados ya están con el chofer/vehículo
// en marcha y no se mueven, los pendientes vuelven a la lista para reasignar.
func (s *RoutingService) movePendingToUnassigned(shipments, applied []string, destination, reason string) []model.UnassignedShipment {
	appliedSet := make(map[string]bool, len(applied))
	for _, tid := range applied {
		appliedSet[tid] = true
	}
	out := make([]model.UnassignedShipment, 0)
	for _, tid := range shipments {
		if appliedSet[tid] {
			continue
		}
		sh, err := s.shipmentRepo.GetByTrackingID(tid)
		if err != nil {
			out = append(out, model.UnassignedShipment{
				TrackingID:  tid,
				Destination: destination,
				Reason:      reason,
			})
			continue
		}
		out = append(out, model.UnassignedShipment{
			TrackingID:  tid,
			Destination: destination,
			Reason:      reason,
			WeightKg:    sh.WeightKg,
			Priority:    sh.Priority,
		})
	}
	return out
}

// RegenerateTodayPlan regenera y sobreescribe el plan global del día.
// Solo managers y admins deben llamar a esto. No sobreescribe si status == applied.
func (s *RoutingService) RegenerateTodayPlan(ctx context.Context) (*model.GlobalRoutingPlan, error) {
	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

	existing, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.PlanStatusApplied {
		return nil, fmt.Errorf("el plan de hoy ya fue aplicado y no puede regenerarse")
	}

	return s.GenerateAndPersistGlobalPlan(ctx)
}

// RegenerateBranchPlan regenera el plan solo para una sucursal y actualiza
// el BranchPlan correspondiente dentro del GlobalRoutingPlan persistido.
// Si no existe plan para hoy, crea uno nuevo con solo esa sucursal.
// Operadores y supervisores usan este método restringido a su propia sucursal.
func (s *RoutingService) RegenerateBranchPlan(ctx context.Context, branchID string) (*model.GlobalRoutingPlan, error) {
	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

	// Generar el plan fresco para esta sucursal.
	branchPlan, err := s.GeneratePlan(ctx, branchID)
	if err != nil {
		return nil, fmt.Errorf("error generando plan para sucursal %s: %w", branchID, err)
	}

	// Leer el plan global del día (puede no existir todavía).
	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return nil, err
	}

	if global == nil {
		// No hay plan global aún — crear uno con solo esta sucursal.
		global = &model.GlobalRoutingPlan{
			ID:          mustNewUUID(),
			PlanDate:    planDate,
			Status:      model.PlanStatusPending,
			BranchPlans: []model.BranchPlan{},
			GeneratedAt: clock.Now().UTC(),
		}
	}

	// Reemplazar o agregar el BranchPlan de esta sucursal.
	found := false
	for i := range global.BranchPlans {
		if global.BranchPlans[i].BranchID == branchID {
			global.BranchPlans[i].Plan = branchPlan
			found = true
			break
		}
	}
	if !found {
		global.BranchPlans = append(global.BranchPlans, model.BranchPlan{
			BranchID: branchID,
			Plan:     branchPlan,
		})
	}

	// Recalcular métricas globales.
	total, assigned, unassigned := 0, 0, 0
	for _, bp := range global.BranchPlans {
		for _, lm := range bp.Plan.LastMile {
			assigned += len(lm.Shipments)
		}
		for _, ib := range bp.Plan.InterBranch {
			assigned += len(ib.Shipments)
		}
		unassigned += len(bp.Plan.Unassigned)
	}
	total = assigned + unassigned
	global.Log = model.GlobalPlanLog{
		TotalCandidates: total,
		TotalAssigned:   assigned,
		TotalUnassigned: unassigned,
		TotalBranches:   len(global.BranchPlans),
	}

	if err := s.planRepo.Upsert(global); err != nil {
		return nil, fmt.Errorf("error persistiendo plan: %w", err)
	}

	log.Printf("[routing-global] sucursal %s regenerada: %d asignados, %d sin asignar",
		branchID, assigned-unassigned, unassigned)

	// Enriquecer branchPlan en memoria con los vehículos en tránsito hacia esta
	// sucursal — lo mismo que hace GetTodayPlan pero sin releer de DB, evitando
	// problemas con el ON CONFLICT que protege planes ya applied.
	allVehicles := s.vehicleRepo.List()
	incoming := make([]model.IncomingVehicle, 0)
	for _, v := range allVehicles {
		if v.Status != model.VehicleStatusInTransit {
			continue
		}
		if v.DestinationBranch == nil || *v.DestinationBranch != branchID {
			continue
		}
		origin := ""
		if v.AssignedBranch != nil {
			origin = *v.AssignedBranch
		}
		weight := 0.0
		tids := append([]string(nil), v.AssignedShipments...)
		for _, tid := range tids {
			if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
				weight += sh.WeightKg
			}
		}
		incoming = append(incoming, model.IncomingVehicle{
			VehicleID:     v.ID,
			LicensePlate:  v.LicensePlate,
			OriginBranch:  origin,
			Shipments:     tids,
			TotalWeightKg: weight,
			CapacityKg:    v.CapacityKg,
		})
	}
	branchPlan.IncomingVehicles = incoming

	filtered := &model.GlobalRoutingPlan{
		ID:          global.ID,
		PlanDate:    global.PlanDate,
		Status:      global.Status,
		GeneratedAt: global.GeneratedAt,
		AppliedAt:   global.AppliedAt,
		AppliedBy:   global.AppliedBy,
		Log:         global.Log,
		BranchPlans: []model.BranchPlan{{BranchID: branchID, Plan: branchPlan}},
	}
	return filtered, nil
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

// allApplied devuelve true cuando todos los envíos de `shipments` están en `applied`.
func allApplied(shipments, applied []string) bool {
	if len(shipments) == 0 {
		return false
	}
	done := make(map[string]bool, len(applied))
	for _, tid := range applied {
		done[tid] = true
	}
	for _, tid := range shipments {
		if !done[tid] {
			return false
		}
	}
	return true
}

func mustNewUUID() string {
	id, err := uuidGen()
	if err != nil {
		return fmt.Sprintf("fallback-%d", clock.Now().UnixNano())
	}
	return id
}

// SaveEditedPlanForBranch mergea un plan editado en cliente (drag-and-drop)
// sobre el plan persistido para la sucursal indicada. Preserva AppliedShipments
// del DB filtrándolos a los Shipments actuales del plan editado: si un envío
// ya estaba aplicado y sigue presente en el assignment, mantiene su flag;
// si fue movido a otro lugar, se quita de la lista de aplicados.
// El usuario no puede des-aplicar items — solo agregar nuevos pendientes.
func (s *RoutingService) SaveEditedPlanForBranch(branchID string, edited *model.RoutingPlan) error {
	if edited == nil {
		return nil
	}
	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return err
	}
	if global == nil {
		return fmt.Errorf("no hay plan generado para hoy")
	}

	bpIdx := -1
	for i := range global.BranchPlans {
		if global.BranchPlans[i].BranchID == branchID {
			bpIdx = i
			break
		}
	}
	if bpIdx == -1 {
		return fmt.Errorf("no hay plan para la sucursal %s", branchID)
	}

	// Snapshot de AppliedShipments desde DB antes de sobreescribir.
	dbAppliedByVehicle := map[string][]string{}
	for _, ib := range global.BranchPlans[bpIdx].Plan.InterBranch {
		dbAppliedByVehicle[ib.VehicleID] = ib.AppliedShipments
	}
	dbAppliedByDriver := map[string][]string{}
	for _, lm := range global.BranchPlans[bpIdx].Plan.LastMile {
		dbAppliedByDriver[lm.DriverID] = lm.AppliedShipments
	}

	// Sobreescribir el plan de la sucursal con el editado.
	global.BranchPlans[bpIdx].Plan = *edited

	// Restaurar AppliedShipments preservando solo los que siguen en Shipments.
	for i := range global.BranchPlans[bpIdx].Plan.InterBranch {
		ib := &global.BranchPlans[bpIdx].Plan.InterBranch[i]
		ib.AppliedShipments = filterToCurrent(dbAppliedByVehicle[ib.VehicleID], ib.Shipments)
		ib.Applied = allApplied(ib.Shipments, ib.AppliedShipments)
	}
	for i := range global.BranchPlans[bpIdx].Plan.LastMile {
		lm := &global.BranchPlans[bpIdx].Plan.LastMile[i]
		lm.AppliedShipments = filterToCurrent(dbAppliedByDriver[lm.DriverID], lm.Shipments)
		lm.Applied = allApplied(lm.Shipments, lm.AppliedShipments)
	}

	return s.planRepo.Upsert(global)
}

// filterToCurrent devuelve los elementos de `applied` que aún están en `current`.
func filterToCurrent(applied, current []string) []string {
	if len(applied) == 0 {
		return nil
	}
	currentSet := make(map[string]bool, len(current))
	for _, tid := range current {
		currentSet[tid] = true
	}
	out := make([]string, 0, len(applied))
	for _, tid := range applied {
		if currentSet[tid] {
			out = append(out, tid)
		}
	}
	return out
}

// ApplyPlanItems aplica ítems del plan persistido con granularidad configurable:
//   - vehicleID != "" → aplica solo ese despacho inter-sucursal
//   - driverID  != "" → aplica solo esa ruta de última milla
//   - ambos vacíos    → aplica todos los ítems pendientes de la sucursal
//
// Si edited != nil, primero mergea esos cambios en DB (preservando AppliedShipments)
// y después aplica. Esto permite que el operador modifique el plan vía drag-and-drop
// y aplique solo el ítem afectado en una sola request.
func (s *RoutingService) ApplyPlanItems(ctx context.Context, branchID string, edited *model.RoutingPlan, vehicleID, driverID, username string) (model.ApplyPlanResponse, error) {
	if edited != nil {
		if err := s.SaveEditedPlanForBranch(branchID, edited); err != nil {
			return model.ApplyPlanResponse{}, fmt.Errorf("no se pudo sincronizar el plan editado: %w", err)
		}
	}

	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return model.ApplyPlanResponse{}, fmt.Errorf("no se pudo leer el plan: %w", err)
	}
	if global == nil {
		return model.ApplyPlanResponse{}, fmt.Errorf("no hay plan generado para hoy")
	}

	// Encontrar el BranchPlan de la sucursal.
	bpIdx := -1
	for i := range global.BranchPlans {
		if global.BranchPlans[i].BranchID == branchID {
			bpIdx = i
			break
		}
	}
	if bpIdx == -1 {
		return model.ApplyPlanResponse{}, fmt.Errorf("no hay plan para la sucursal %s", branchID)
	}

	bp := &global.BranchPlans[bpIdx]
	now := clock.Now().UTC()
	items := make([]model.ApplyResultItem, 0)

	// --- Inter-sucursal ---
	for i := range bp.Plan.InterBranch {
		asgmt := &bp.Plan.InterBranch[i]
		if vehicleID != "" && asgmt.VehicleID != vehicleID {
			continue
		}
		if driverID != "" {
			continue
		}

		// Calcular qué envíos de este assignment aún no fueron aplicados.
		alreadyApplied := make(map[string]bool, len(asgmt.AppliedShipments))
		for _, tid := range asgmt.AppliedShipments {
			alreadyApplied[tid] = true
		}
		pending := make([]string, 0)
		for _, tid := range asgmt.Shipments {
			if !alreadyApplied[tid] {
				pending = append(pending, tid)
			}
		}
		if len(pending) == 0 {
			continue // todos los envíos actuales ya fueron aplicados
		}

		target := "vehicle:" + asgmt.LicensePlate
		v, ok := s.vehicleRepo.GetByID(asgmt.VehicleID)
		if !ok {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "vehiculo_no_encontrado"))
			}
			continue
		}
		if v.AssignedBranch == nil || *v.AssignedBranch != branchID {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "vehiculo_no_pertenece_a_sucursal"))
			}
			continue
		}
		if v.Status != model.VehicleStatusAvailable && v.Status != model.VehicleStatusLoading {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "vehiculo_no_disponible"))
			}
			continue
		}
		if v.DestinationBranch != nil && *v.DestinationBranch != asgmt.DestinationBranch {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "vehiculo_destino_diferente"))
			}
			continue
		}
		if v.DestinationBranch == nil {
			dest := asgmt.DestinationBranch
			if err := s.vehicleRepo.SetDestinationBranch(v.ID, &dest); err != nil {
				for _, tid := range pending {
					items = append(items, failedItem(tid, target, "error_seteando_destino"))
				}
				continue
			}
		}

		currentLoad := 0.0
		for _, tid := range v.AssignedShipments {
			if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
				currentLoad += sh.WeightKg
			}
		}

		anyApplied := false
		for _, tid := range pending {
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
			if _, err := s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusLoaded,
				ChangedBy: username,
				Location:  branchID,
				Notes:     "Cargado en " + v.LicensePlate + " vía planificador de ruteo",
			}); err != nil {
				_ = s.vehicleRepo.RemoveShipment(v.ID, tid)
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}
			currentLoad += sh.WeightKg
			anyApplied = true
			asgmt.AppliedShipments = append(asgmt.AppliedShipments, tid)
			items = append(items, model.ApplyResultItem{TrackingID: tid, Target: target, Status: "applied"})
		}

		if anyApplied {
			if v.Status == model.VehicleStatusAvailable {
				_ = s.vehicleRepo.UpdateStatusByUser(v.ID, model.VehicleStatusLoading, username)
			}
			// Applied = true solo cuando todos los envíos actuales están aplicados.
			asgmt.Applied = allApplied(asgmt.Shipments, asgmt.AppliedShipments)
			if asgmt.Applied {
				asgmt.AppliedAt = &now
				asgmt.AppliedBy = username
			}
		}
	}

	// --- Última milla ---
	today := model.NewDateOnly(now.In(clock.LocalTZ))
	for i := range bp.Plan.LastMile {
		asgmt := &bp.Plan.LastMile[i]
		if driverID != "" && asgmt.DriverID != driverID {
			continue
		}
		if vehicleID != "" {
			continue
		}

		alreadyApplied := make(map[string]bool, len(asgmt.AppliedShipments))
		for _, tid := range asgmt.AppliedShipments {
			alreadyApplied[tid] = true
		}
		pending := make([]string, 0)
		for _, tid := range asgmt.Shipments {
			if !alreadyApplied[tid] {
				pending = append(pending, tid)
			}
		}
		if len(pending) == 0 {
			continue
		}

		target := "driver:" + asgmt.DriverID
		if err := s.routeSvc.CanAssignToRoute(asgmt.DriverID, today); err != nil {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "ruta_ya_iniciada"))
			}
			continue
		}

		anyApplied := false
		for _, tid := range pending {
			sh, err := s.shipmentRepo.GetByTrackingID(tid)
			if err != nil {
				items = append(items, failedItem(tid, target, "envio_no_encontrado"))
				continue
			}
			if sh.ReceivingBranchID != branchID {
				items = append(items, failedItem(tid, target, "envio_no_pertenece_a_sucursal"))
				continue
			}
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusRedeliveryScheduled {
				items = append(items, failedItem(tid, target, "estado_cambio:"+string(sh.Status)))
				continue
			}
			if _, err := s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusOutForDelivery,
				ChangedBy: username,
				DriverID:  asgmt.DriverID,
				Notes:     "Asignado vía planificador de ruteo",
			}); err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}
			_ = s.routeSvc.RemoveShipmentFromTodayRoute(tid)
			if err := s.routeSvc.AddShipmentToDriverRoute(asgmt.DriverID, tid, today); err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}
			anyApplied = true
			asgmt.AppliedShipments = append(asgmt.AppliedShipments, tid)
			items = append(items, model.ApplyResultItem{TrackingID: tid, Target: target, Status: "applied"})
		}

		if anyApplied {
			asgmt.Applied = allApplied(asgmt.Shipments, asgmt.AppliedShipments)
			if asgmt.Applied {
				asgmt.AppliedAt = &now
				asgmt.AppliedBy = username
			}
			// Persistir el horario sugerido de salida (Fase 4): el chofer/supervisor
			// lo verá en /driver/route como recomendación para cumplir ventanas.
			if asgmt.DepartureMin > 0 {
				suggestedAt := dateAtMinute(today, asgmt.DepartureMin)
				_ = s.routeSvc.SetSuggestedStartTime(asgmt.DriverID, today, suggestedAt)
			}
		}
	}

	// Determinar si toda la sucursal quedó aplicada.
	branchFullyApplied := true
	for _, ib := range bp.Plan.InterBranch {
		if !ib.Applied {
			branchFullyApplied = false
			break
		}
	}
	if branchFullyApplied {
		for _, lm := range bp.Plan.LastMile {
			if !lm.Applied {
				branchFullyApplied = false
				break
			}
		}
	}
	if branchFullyApplied {
		alreadyInList := false
		for _, b := range global.AppliedBranches {
			if b == branchID {
				alreadyInList = true
				break
			}
		}
		if !alreadyInList {
			global.AppliedBranches = append(global.AppliedBranches, branchID)
		}
	}

	// El plan global pasa a "applied" solo cuando todas las sucursales aplicaron.
	allBranchesApplied := len(global.AppliedBranches) == len(global.BranchPlans) && len(global.BranchPlans) > 0
	if allBranchesApplied {
		global.Status = model.PlanStatusApplied
		t := now
		global.AppliedAt = &t
		global.AppliedBy = username
	}

	// Persistir el plan actualizado.
	if err := s.planRepo.Upsert(global); err != nil {
		log.Printf("[routing-global] advertencia: no se pudo persistir estado del plan: %v", err)
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

// ApplyBranchPlan aplica todos los ítems pendientes de una sucursal.
// Wrapper de conveniencia sobre ApplyPlanItems.
func (s *RoutingService) ApplyBranchPlan(ctx context.Context, branchID, username string) (model.ApplyPlanResponse, error) {
	return s.ApplyPlanItems(ctx, branchID, nil, "", "", username)
}

// SyncAppliedItems actualiza el estado Applied de los ítems del plan persistido
// cuando se usó el flujo legacy (plan editado enviado en body). Se llama en
// background después del apply — es best-effort, un fallo no afecta la operativa.
func (s *RoutingService) SyncAppliedItems(branchID string, applied *model.RoutingPlan, username string) error {
	if applied == nil {
		return nil
	}
	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

	global, err := s.planRepo.GetByDate(planDate)
	if err != nil || global == nil {
		return err
	}

	now := clock.Now().UTC()
	bpIdx := -1
	for i := range global.BranchPlans {
		if global.BranchPlans[i].BranchID == branchID {
			bpIdx = i
			break
		}
	}
	if bpIdx == -1 {
		return nil
	}

	bp := &global.BranchPlans[bpIdx]

	// Marcar como applied los envíos de vehículos que estaban en el plan aplicado.
	appliedVehicleShipments := map[string][]string{} // vehicleID → []trackingID
	for _, ib := range applied.InterBranch {
		appliedVehicleShipments[ib.VehicleID] = ib.Shipments
	}
	for i := range bp.Plan.InterBranch {
		ib := &bp.Plan.InterBranch[i]
		tids, ok := appliedVehicleShipments[ib.VehicleID]
		if !ok {
			continue
		}
		for _, tid := range tids {
			if !contains(ib.AppliedShipments, tid) {
				ib.AppliedShipments = append(ib.AppliedShipments, tid)
			}
		}
		ib.Applied = allApplied(ib.Shipments, ib.AppliedShipments)
		if ib.Applied {
			ib.AppliedAt = &now
			ib.AppliedBy = username
		}
	}

	// Marcar como applied los envíos de choferes que estaban en el plan aplicado.
	appliedDriverShipments := map[string][]string{} // driverID → []trackingID
	for _, lm := range applied.LastMile {
		appliedDriverShipments[lm.DriverID] = lm.Shipments
	}
	for i := range bp.Plan.LastMile {
		lm := &bp.Plan.LastMile[i]
		tids, ok := appliedDriverShipments[lm.DriverID]
		if !ok {
			continue
		}
		for _, tid := range tids {
			if !contains(lm.AppliedShipments, tid) {
				lm.AppliedShipments = append(lm.AppliedShipments, tid)
			}
		}
		lm.Applied = allApplied(lm.Shipments, lm.AppliedShipments)
		if lm.Applied {
			lm.AppliedAt = &now
			lm.AppliedBy = username
		}
	}

	// Verificar si la sucursal quedó completamente aplicada.
	branchDone := true
	for _, ib := range bp.Plan.InterBranch {
		if !ib.Applied {
			branchDone = false
			break
		}
	}
	if branchDone {
		for _, lm := range bp.Plan.LastMile {
			if !lm.Applied {
				branchDone = false
				break
			}
		}
	}
	if branchDone {
		alreadyIn := false
		for _, b := range global.AppliedBranches {
			if b == branchID {
				alreadyIn = true
				break
			}
		}
		if !alreadyIn {
			global.AppliedBranches = append(global.AppliedBranches, branchID)
		}
	}

	if len(global.AppliedBranches) == len(global.BranchPlans) && len(global.BranchPlans) > 0 {
		global.Status = model.PlanStatusApplied
		global.AppliedAt = &now
		global.AppliedBy = username
	}

	return s.planRepo.Upsert(global)
}

// newUUID genera un UUID v4 simple sin dependencias externas.
// Usa google/uuid que ya está en go.mod.
func newUUID() string {
	id, err := uuidGen()
	if err != nil {
		return fmt.Sprintf("fallback-%d", clock.Now().UnixNano())
	}
	return id
}

// dateAtMinute construye un time.Time absoluto combinando una fecha (DateOnly)
// con un offset en minutos desde medianoche, en zona horaria local. Útil para
// convertir el DepartureMin del solver (minutos desde medianoche) en un
// timestamp persistible como SuggestedStartTime.
func dateAtMinute(date model.DateOnly, minutesFromMidnight int) time.Time {
	d := time.Time(date)
	y, m, day := d.Date()
	h := minutesFromMidnight / 60
	min := minutesFromMidnight % 60
	return time.Date(y, m, day, h, min, 0, 0, clock.LocalTZ)
}

// candidateDepartures devuelve los horarios candidatos de salida (en minutos
// desde medianoche) para probar contra cada chofer de última milla.
//
// Una hora entera por candidato, desde el inicio de la ventana morning hasta
// una hora antes del fin de la ventana afternoon (no tiene sentido salir en
// la última hora porque no podría entregar nada).
//
// nowMin es el wall-clock actual (minutos desde medianoche). Filtra los
// candidates que ya pasaron — sugerir "salir a las 8" cuando son las 12:45
// es engañoso (el solver simularía una salida ficticia y la cobertura no
// sería real). Si nowMin no cae en una hora exacta, agrega nowMin mismo
// como candidate adicional para permitir "salir ya".
func candidateDepartures(cfg model.RoutingConfig, nowMin float64) []float64 {
	start := cfg.MorningWindowStartHour
	end := cfg.AfternoonWindowEndHour - 1
	if end <= start {
		return []float64{float64(start) * 60}
	}
	// Primer entero >= nowMin (ceil hacia arriba).
	firstHour := start
	if nowMin > float64(start)*60 {
		// Equivalente a ceil(nowMin / 60). Si nowMin == k*60, queda k.
		firstHour = int((nowMin + 59) / 60)
	}
	// Si nowMin superó el fin de la ventana operativa no hay candidatos válidos.
	if firstHour > end {
		return []float64{}
	}
	out := make([]float64, 0, end-firstHour+2)
	// Permitir "salir ya" si ahora no es hora exacta y estamos dentro del
	// horario operativo. Esto evita pedirle al chofer que espere 59 minutos
	// hasta el siguiente entero solo para respetar la grilla.
	if nowMin > float64(start)*60 && nowMin < float64(end+1)*60 && int(nowMin)%60 != 0 {
		out = append(out, nowMin)
	}
	for h := firstHour; h <= end; h++ {
		out = append(out, float64(h)*60)
	}
	return out
}

// subMatrix devuelve la sub-matriz que conserva el depot (índice 0) y los
// índices `indices` de la matriz original (que apuntan a Deliveries[i],
// donde la fila/col correspondiente en la matriz es i+1).
//
// El resultado tiene tamaño (1 + len(indices)) x (1 + len(indices)).
func subMatrix(m [][]float64, indices []int) [][]float64 {
	if len(m) == 0 {
		return nil
	}
	n := len(indices) + 1
	out := make([][]float64, n)
	for i := range out {
		out[i] = make([]float64, n)
	}
	// Mapping: pos 0 = depot, pos 1..N = indices[0..N-1]+1 en la matriz original.
	rowsCols := make([]int, n)
	rowsCols[0] = 0
	for i, idx := range indices {
		rowsCols[i+1] = idx + 1
	}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			out[i][j] = m[rowsCols[i]][rowsCols[j]]
		}
	}
	return out
}

// routeMetrics calcula la cobertura de ventana y el tiempo de espera total
// de una ruta resuelta:
//   - coverage = entregas dentro de ventana / total de entregas en la ruta.
//   - wait = suma de minutos de llegada anticipada a una ventana (cuando el
//     chofer llegaría antes del inicio de la ventana del envío). Las llegadas
//     tarde no cuentan como espera (son violaciones puras).
func routeMetrics(r vrp.Route, totalStops int) (coverage float64, wait float64) {
	if totalStops == 0 {
		return 1.0, 0
	}
	inWindow := 0
	for _, st := range r.Stops {
		if !st.OutOfWindow {
			inWindow++
			continue
		}
		// Solo "early" suma a wait (deviation negativa).
		if st.WindowDeviationMin < 0 {
			wait += -st.WindowDeviationMin
		}
	}
	coverage = float64(inWindow) / float64(totalStops)
	return
}

// findBestDepartureForRoute prueba horarios candidatos para un chofer dado
// (con sus shipments asignados) y devuelve la mejor combinación según el
// score:
//   1. mayor cobertura de ventana
//   2. menor tiempo de espera total (desempate)
//   3. salida más temprana (desempate final)
//
// Construye sub-problems con un solo chofer y los shipments de su ruta,
// reutilizando la matriz global (indexada por su posición en `deliveries`).
func (s *RoutingService) findBestDepartureForRoute(
	driverID string,
	driverMaxKg float64,
	routeShipTIDs []string,
	depotCoord vrp.Coord,
	deliveries []vrp.Node,
	indexByTID map[string]int,
	fullDur, fullDist [][]float64,
	cfg model.RoutingConfig,
	nowMin float64,
) (bestDep float64, bestRoute vrp.Route, bestCoverage float64) {
	if len(routeShipTIDs) == 0 {
		return 0, vrp.Route{}, 1.0
	}
	indices := make([]int, len(routeShipTIDs))
	subDeliveries := make([]vrp.Node, len(routeShipTIDs))
	for i, tid := range routeShipTIDs {
		idx, ok := indexByTID[tid]
		if !ok {
			return 0, vrp.Route{}, 0
		}
		indices[i] = idx
		subDeliveries[i] = deliveries[idx]
	}
	subDur := subMatrix(fullDur, indices)
	subDist := subMatrix(fullDist, indices)

	morningStartMin := float64(cfg.MorningWindowStartHour) * 60
	candidates := candidateDepartures(cfg, nowMin)

	type result struct {
		dep      float64
		route    vrp.Route
		coverage float64
		wait     float64
	}
	var best *result
	for _, dep := range candidates {
		p := vrp.Problem{
			Depot:                   vrp.Node{ID: "depot", Coord: depotCoord},
			Deliveries:              subDeliveries,
			Drivers:                 []vrp.Driver{{ID: driverID, MaxWeightKg: driverMaxKg}},
			DurationMatrix:          subDur,
			DistanceMatrix:          subDist,
			DepartureMin:            dep,
			ServiceTimeMin:          float64(cfg.ServiceTimeMinutes),
			DayEndMin:               float64(cfg.AfternoonWindowEndHour) * 60,
			MorningWindowStartMin:   morningStartMin,
			MorningWindowEndMin:     float64(cfg.MorningWindowEndHour) * 60,
			AfternoonWindowStartMin: float64(cfg.AfternoonWindowStartHour) * 60,
			AfternoonWindowEndMin:   float64(cfg.AfternoonWindowEndHour) * 60,
			EnforceTimeWindows:      false, // siempre soft acá: queremos comparar coverages
			PackingStrategy:         cfg.LastMilePackingStrategy,
		}
		sol := vrp.Solve(p)
		if len(sol.Routes) == 0 {
			continue
		}
		r := sol.Routes[0]
		cov, wait := routeMetrics(r, len(routeShipTIDs))
		c := result{dep: dep, route: r, coverage: cov, wait: wait}
		if best == nil {
			best = &c
			continue
		}
		// Score: coverage DESC, wait ASC, dep ASC.
		if c.coverage > best.coverage ||
			(c.coverage == best.coverage && c.wait < best.wait) ||
			(c.coverage == best.coverage && c.wait == best.wait && c.dep < best.dep) {
			best = &c
		}
	}
	if best == nil {
		return 0, vrp.Route{}, 0
	}
	return best.dep, best.route, best.coverage
}
