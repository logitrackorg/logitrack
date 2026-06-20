package service

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/ors"
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
	cfgSvc             *RoutingConfigService
	shipmentRepo       repository.ShipmentRepository
	vehicleRepo        repository.VehicleRepository
	branchRepo         repository.BranchRepository
	authRepo           repository.AuthRepository
	routeSvc           *RouteService
	shipmentSvc        *ShipmentService
	planRepo           repository.RoutingPlanRepository
	osrmClient         *osrm.Client // nullable; sin OSRM se usa Haversine para la matriz
	orsClient          *ors.Client  // nullable; usado en modo segura para evitar polígonos (avoid_polygons)
	interBranchTripSvc *InterBranchTripService
	graphSvc           *BranchGraphService    // nullable; used for stale-replan
	zoneSvc            *ZoneService           // nullable; needed for safe-route mode
	branchZoneSvc      *BranchZoneService     // nullable; auto-move entrada→salida on ApplyPlan
	notifSvc           *NotificationService   // nullable; SLA risk notifications (LOGITRACK-404)
	slaExpiredEmailSvc SLAExpiredEmailSender  // nullable; customer email on SLA expiry (LOGITRACK-124)
	slaExpiredWASvc    SLAExpiredWASender     // nullable; customer WhatsApp on SLA expiry (LOGITRACK-124)
	dispatchVolumeSvc  DispatchVolumeNotifier // nullable; LOGITRACK-409 CA-05 reset after apply
}

// SLAExpiredEmailSender is the minimal interface needed to notify the shipment recipient
// when a shipment has exceeded its ETA via email.
type SLAExpiredEmailSender interface {
	SendSLAExpiredNotification(shipment model.Shipment)
}

// SLAExpiredWASender is the minimal interface needed to notify sender and recipient
// via WhatsApp (with email fallback) when a shipment has exceeded its ETA.
type SLAExpiredWASender interface {
	SendSLAExpiredWhatsApp(shipment model.Shipment)
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

func (s *RoutingService) SetInterBranchTripService(svc *InterBranchTripService) {
	s.interBranchTripSvc = svc
}

func (s *RoutingService) SetNotificationService(svc *NotificationService) {
	s.notifSvc = svc
}

// SetSLAExpiredEmailService wires the customer-facing SLA-expired email sender.
func (s *RoutingService) SetSLAExpiredEmailService(svc SLAExpiredEmailSender) {
	s.slaExpiredEmailSvc = svc
}

// SetSLAExpiredWAService wires the WhatsApp (+ email fallback) sender for SLA-expired notifications.
func (s *RoutingService) SetSLAExpiredWAService(svc SLAExpiredWASender) {
	s.slaExpiredWASvc = svc
}

// SetDispatchVolumeService inyecta el checker de volumen mínimo para reset post-apply (CA-05).
func (s *RoutingService) SetDispatchVolumeService(svc DispatchVolumeNotifier) {
	s.dispatchVolumeSvc = svc
}

func (s *RoutingService) SetZoneService(svc *ZoneService) {
	s.zoneSvc = svc
}

func (s *RoutingService) SetBranchZoneService(svc *BranchZoneService) {
	s.branchZoneSvc = svc
}

func (s *RoutingService) SetORSClient(c *ors.Client) {
	s.orsClient = c
}

const lastMileDestLabel = "(última milla)"

// =============================================================================
// GeneratePlan
// =============================================================================

func (s *RoutingService) GeneratePlan(ctx context.Context, branchID string) (model.RoutingPlan, error) {
	return s.generatePlan(ctx, s.liveContext(branchID, false, nil))
}

// generatePlan es la implementación interna. Recibe un planContext que abstrae
// las fuentes de vehículos y envíos — en D=0 leen repos vivos; en D>0 leen del
// projectionState para generar pronósticos sin mutar estado real.
func (s *RoutingService) generatePlan(_ context.Context, pc *planContext) (model.RoutingPlan, error) {
	branchID := pc.branchID
	forGlobal := pc.forGlobal
	existingGlobal := pc.existing
	cfg := s.cfgSvc.Get()
	now := pc.now

	plan := model.RoutingPlan{
		BranchID:       branchID,
		GeneratedAt:    now,
		LastMile:       []model.LastMileAssignment{},
		InterBranch:    []model.InterBranchAssignment{},
		Unassigned:     []model.UnassignedShipment{},
		VehicleLoads:   []model.VehicleLoad{},
		ConfigSnapshot: cfg,
	}

	// 1) Cargar candidatos en la sucursal y particionar.
	// En D=0 lee el repo vivo; en D>0 lee el estado proyectado.
	all := pc.shipmentSource(branchID)
	var err error
	_ = err // shipmentSource no devuelve error (usa valores del estado proyectado)

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
		// retiro_sucursal: solo excluir si ya está en su sucursal de retiro final.
		// Si FinalBranchID está en otra sucursal, necesita transporte inter-sucursal igual.
		if sh.DeliveryMethod == model.DeliveryMethodBranchPickup && sh.FinalBranchID == branchID {
			continue
		}
		// Si el envío está reservado por un trip multi-hop (cross-branch pickup),
		// no es candidato para otros planes hasta que el trip lo levante o se cancele.
		if sh.ReservedForTripID != nil {
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
			(sh.Status == model.StatusAtHub || sh.Status == model.StatusAtOriginHub || sh.Status == model.StatusRedeliveryScheduled) {
			// Si el destinatario solicitó explícitamente una fecha via chatbot y esa fecha
			// aún no llegó, no incluir en el plan de hoy.
			if scheduledDate := chatbotScheduledDate(sh); scheduledDate != nil && scheduledDate.After(now) {
				plan.Unassigned = append(plan.Unassigned, model.UnassignedShipment{
					TrackingID:  sh.TrackingID,
					Destination: "(última milla)",
					Reason:      "esperando_fecha_solicitada",
					WeightKg:    sh.WeightKg,
					Priority:    sh.Priority,
				})
				continue
			}
			// Si la ventana horaria del envío ya venció para HOY, diferir al día siguiente.
			// Solo aplica:
			//   - en D=0 (pc.day==0): el reloj real ya pasó la ventana. En días proyectados
			//     (D>0) el planificador asume una mañana fresca → las ventanas están abiertas;
			//     gatear por day==0 evita además el diferimiento perpetuo si la hora de despacho
			//     inter-sucursal estuviera configurada ≥ cierre de una ventana.
			//   - con EnforceTimeWindows=true: en modo blando el VRP igual los incluye con
			//     penalización, así que no tiene sentido excluirlos acá.
			if pc.day == 0 && cfg.EnforceTimeWindows {
				localHour := now.In(clock.LocalTZ).Hour()
				windowClosed := false
				switch sh.TimeWindow {
				case model.TimeWindowMorning:
					windowClosed = localHour >= cfg.MorningWindowEndHour
				case model.TimeWindowAfternoon:
					windowClosed = localHour >= cfg.AfternoonWindowEndHour
					// "flexible" o vacío: nunca diferir por ventana.
				}
				if windowClosed {
					plan.Unassigned = append(plan.Unassigned, model.UnassignedShipment{
						TrackingID:  sh.TrackingID,
						Destination: "(última milla)",
						Reason:      "ventana_horaria_vencida",
						WeightKg:    sh.WeightKg,
						Priority:    sh.Priority,
					})
					continue
				}
			}
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

	// SLA risk check: solo en D=0 (evita notificaciones falsas en días proyectados).
	if pc.runSLARisk {
		s.checkSLARisk(all, cfg, now)
	}

	// 2) Última milla — asignar a vehículos de modo ultima_milla
	plan.LastMile, plan.Unassigned = s.binPackLastMileVehiclesCtx(lastMileQ, branchID, plan.Unassigned, pc)
	// Optimizar orden de paradas y horario de salida sugerido por VRP.
	s.scheduleLastMileAssignments(plan.LastMile, branchID, shipmentByTID, cfg, now, model.RouteModeVentanas)

	// 3) Inter-sucursal — solo vehículos de modo inter_sucursal
	availableVehicles, existingVehicleLoad := pc.vehicleSource(branchID, model.VehicleModeInterBranch)
	plan.InterBranch, plan.Unassigned = s.dispatchInterBranch(interBranchQ, availableVehicles, existingVehicleLoad, cfg, now, plan.Unassigned)

	// Agregar vehículos en_carga con destino seteado que el algoritmo no incluyó
	// (p.ej. vehículos de paso en parada intermedia de un viaje multi-hop).
	// Aparecen como assignments vacíos para que el operador pueda asignarles envíos manualmente.
	assignedVehicleIDs := map[string]bool{}
	for _, a := range plan.InterBranch {
		assignedVehicleIDs[a.VehicleID] = true
	}
	for _, v := range availableVehicles {
		if assignedVehicleIDs[v.ID] {
			continue
		}
		if v.Status != model.VehicleStatusLoading || v.DestinationBranch == nil {
			continue
		}
		var existing float64
		for _, tid := range v.AssignedShipments {
			if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
				existing += sh.WeightKg
			}
		}
		plan.InterBranch = append(plan.InterBranch, model.InterBranchAssignment{
			VehicleID:         v.ID,
			LicensePlate:      v.LicensePlate,
			DestinationBranch: *v.DestinationBranch,
			Rule:              model.DispatchRuleManual,
			Shipments:         []string{},
			TotalWeightKg:     0,
			CapacityKg:        v.CapacityKg,
			ExistingWeightKg:  roundKg(existing),
			ExistingShipments: append([]string(nil), v.AssignedShipments...),
		})
	}

	// Cargas actuales de todos los vehículos disponibles del branch (con modo)
	allAvailable, allExistingLoad := pc.allVehicleSource(branchID)
	for _, v := range allAvailable {
		existingTIDs := append([]string(nil), v.AssignedShipments...)
		plan.VehicleLoads = append(plan.VehicleLoads, model.VehicleLoad{
			VehicleID:         v.ID,
			LicensePlate:      v.LicensePlate,
			Mode:              string(v.Mode),
			CapacityKg:        v.CapacityKg,
			ExistingWeightKg:  roundKg(allExistingLoad[v.ID]),
			ExistingShipments: existingTIDs,
		})
	}

	// 4) Multi-hop — agregar hasta 2 paradas adicionales a despachos cuando
	// hay envíos sin asignar cuyo destino esté en el camino (grafo de sucursales).
	s.addMultiHopStops(&plan, branchID, shipmentByTID, cfg, now, forGlobal)

	// 5) Piggyback — sumar envíos huérfanos a despachos que los acerquen a su destino final
	s.piggybackUnassigned(&plan, branchID, shipmentByTID)

	// 6) Cross-branch pickups — agregar a las paradas intermedias de multi-hop
	// envíos que esperan en at_hub en otras sucursales con destino más adelante.
	s.addCrossBranchPickupsForBranchCtx(&plan, branchID, existingGlobal, pc)

	// 7) Backhauling local — cargo adicional en hub sin dispatch propio (oportunístico).
	// El backhauling estructurado (dispatches opuestos entre sucursales) lo maneja
	// matchBackhaulPairs como pase global, DESPUÉS de que todos los branches generaron
	// sus planes. Esto evita el doble-conteo de cargo.
	// addBackhaulReturns solo corre localmente para cargo huérfano (at_hub en destino
	// sin dispatch planificado para volver).
	if cfg.BackhaulEnabled && pc.day == 0 {
		// Solo en D=0 y solo para cargo que no tiene dispatch propio desde el destino.
		// La coordinación inter-branch la hace matchBackhaulPairs en el pase global.
	}

	// 8) Schedule inter-sucursal — calcular hora de salida y arribo por parada.
	// Se ejecuta aquí porque AdditionalStops ya están definitivos (incluyendo el retorno).
	s.scheduleInterBranchAssignments(plan.InterBranch, branchID, cfg)

	// Orden determinístico de salida
	sort.SliceStable(plan.InterBranch, func(i, j int) bool {
		return plan.InterBranch[i].DestinationBranch < plan.InterBranch[j].DestinationBranch
	})
	sort.SliceStable(plan.LastMile, func(i, j int) bool {
		return plan.LastMile[i].VehicleID < plan.LastMile[j].VehicleID
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
	if plan.VehicleLoads == nil {
		plan.VehicleLoads = []model.VehicleLoad{}
	}

	return plan, nil
}

// filterAvailableVehicles devuelve todos los vehículos elegibles para despacho desde la sucursal.
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
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CapacityKg != out[j].CapacityKg {
			return out[i].CapacityKg < out[j].CapacityKg
		}
		return out[i].LicensePlate < out[j].LicensePlate
	})
	return out, existing
}

// filterAvailableVehiclesForMode is like filterAvailableVehicles but restricted to a given mode.
func (s *RoutingService) filterAvailableVehiclesForMode(branchID string, mode model.VehicleMode) ([]model.Vehicle, map[string]float64) {
	all, existing := s.filterAvailableVehicles(branchID)
	var out []model.Vehicle
	for _, v := range all {
		if v.Mode == mode {
			out = append(out, v)
		}
	}
	return out, existing
}

// scheduleLastMileAssignments optimiza el orden de paradas y calcula el horario
// de salida sugerido para cada asignación de última milla usando el VRP scheduler.
// Mutates each assignment in-place: rellena SuggestedDepartureMin, OrderedStops
// y WindowCoverage, y reordena Shipments para que coincida con el orden óptimo.
// Si el branch no tiene coordenadas o faltan coords de destinatarios, se omite
// silenciosamente y la asignación queda sin cambios.
func (s *RoutingService) scheduleLastMileAssignments(
	assignments []model.LastMileAssignment,
	branchID string,
	shipByTID map[string]model.Shipment,
	cfg model.RoutingConfig,
	now time.Time,
	mode model.RouteMode,
) {
	if len(assignments) == 0 {
		return
	}

	depot, ok := s.branchRepo.GetByID(branchID)
	if !ok || depot.Latitude == nil || depot.Longitude == nil {
		return
	}
	depotCoord := vrp.Coord{Lat: *depot.Latitude, Lon: *depot.Longitude}

	// DepartureMin base: hora actual si es después del inicio de ventana morning,
	// si no, el inicio de ventana morning configurado.
	local := now.In(clock.LocalTZ)
	departureMin := float64(local.Hour()*60 + local.Minute())
	morningStartMin := float64(cfg.MorningWindowStartHour) * 60
	if departureMin < morningStartMin {
		departureMin = morningStartMin
	}

	// Para modo segura: cargar zonas activas una sola vez (fuera del loop).
	// Si zoneSvc no está inyectado o no hay zonas, segura se comporta igual que ventanas.
	var activeZones []model.Zone
	if mode == model.RouteModeSegura && s.zoneSvc != nil {
		activeZones, _ = s.zoneSvc.List(false) // false = solo activas
	}

	for i := range assignments {
		a := &assignments[i]

		// Construir nodos VRP solo para envíos con coordenadas.
		// tidsWithCoords son los únicos que pasan al solver; los sin coords van
		// al final como unsequenced.
		var nodes []vrp.Node
		var coords []vrp.Coord
		var tidsWithCoords []string
		indexByTID := map[string]int{}
		for _, tid := range a.Shipments {
			sh, ok := shipByTID[tid]
			if !ok || sh.Recipient.Address.Latitude == nil || sh.Recipient.Address.Longitude == nil {
				continue
			}
			c := vrp.Coord{Lat: *sh.Recipient.Address.Latitude, Lon: *sh.Recipient.Address.Longitude}
			indexByTID[tid] = len(nodes)
			nodes = append(nodes, vrp.Node{
				ID:         tid,
				Coord:      c,
				WeightKg:   sh.WeightKg,
				TimeWindow: sh.TimeWindow,
			})
			coords = append(coords, c)
			tidsWithCoords = append(tidsWithCoords, tid)
		}
		if len(nodes) == 0 {
			log.Printf("[routing] vehiculo=%s sin_coords: todos los envíos (%d) carecen de coordenadas → polyline recta", a.VehicleID, len(a.Shipments))
			continue
		}

		dur, dist := s.buildDurationMatrix(depotCoord, coords, cfg.AvgSpeedKmh)

		// Para modo segura: copiar la matriz y aplicar penalizaciones por zona.
		// Las zonas se pasan ya resueltas (nil en otros modos).
		effectiveDur := dur
		if mode == model.RouteModeSegura && len(activeZones) > 0 {
			effectiveDur = copyMatrix(dur)
			// coords para la matriz: [depot] + deliveries
			allCoords := make([]vrp.Coord, 0, len(coords)+1)
			allCoords = append(allCoords, depotCoord)
			allCoords = append(allCoords, coords...)
			applyZonePenaltiesToMatrix(effectiveDur, allCoords, activeZones)
		}

		var bestDep float64
		var bestRoute vrp.Route
		var coverage float64

		if mode == model.RouteModeCosto {
			bestDep, bestRoute, coverage = s.findCostOptimalDeparture(
				a.VehicleID, a.CapacityKg, tidsWithCoords,
				depotCoord, nodes, indexByTID,
				dur, dist, cfg, departureMin,
			)
		} else {
			// ventanas y segura usan el mismo scoring; la diferencia está en la matriz.
			bestDep, bestRoute, coverage = s.findBestDepartureForRoute(
				a.VehicleID, a.CapacityKg, tidsWithCoords,
				depotCoord, nodes, indexByTID,
				effectiveDur, dist, cfg, departureMin,
			)
		}
		if coverage == 0 || len(bestRoute.Stops) == 0 {
			continue
		}

		// Reordenar Shipments y construir OrderedStops según el orden VRP.
		stops := make([]model.RouteStop, 0, len(bestRoute.Stops))
		shipIDs := make([]string, 0, len(bestRoute.Stops))
		for idx, st := range bestRoute.Stops {
			sh := shipByTID[st.NodeID]
			dev := 0
			if st.WindowDeviationMin != 0 {
				dev = int(st.WindowDeviationMin + 0.5)
				if st.WindowDeviationMin < 0 {
					dev = int(st.WindowDeviationMin - 0.5)
				}
			}
			stops = append(stops, model.RouteStop{
				TrackingID:         st.NodeID,
				Sequence:           idx + 1,
				ArrivalMin:         int(st.ArrivalMin + 0.5),
				TimeWindow:         string(sh.TimeWindow),
				WeightKg:           sh.WeightKg,
				WithinWindow:       !st.OutOfWindow,
				WindowDeviationMin: dev,
			})
			shipIDs = append(shipIDs, st.NodeID)
		}
		// Agregar envíos sin coordenadas al final (unsequenced).
		seqSet := map[string]bool{}
		for _, tid := range shipIDs {
			seqSet[tid] = true
		}
		for _, tid := range a.Shipments {
			if !seqSet[tid] {
				shipIDs = append(shipIDs, tid)
				stops = append(stops, model.RouteStop{
					TrackingID:  tid,
					Sequence:    len(stops) + 1,
					ArrivalMin:  -1,
					Unsequenced: true,
				})
			}
		}

		a.Shipments = shipIDs
		a.OrderedStops = stops
		a.SuggestedDepartureMin = int(bestDep + 0.5)
		a.WindowCoverage = coverage
		a.RouteMode = mode.Normalize()
		// Geometría real del trayecto vía OSRM (sigue calles, no líneas rectas).
		// Para segura intercala waypoints de bordeado para que OSRM rutee
		// alrededor de las zonas peligrosas en vez de cruzarlas.
		a.PolylineCoords = s.computeRoadPolyline(depotCoord, a.Shipments, shipByTID, activeZones, mode)
	}
}

// scheduleInterBranchAssignments calcula la hora de salida estimada y el arribo
// a cada parada para los despachos inter-sucursal. Muta los assignments in-place:
// rellena EstimatedDepartureMin, PrimaryEstimatedArrivalMin, EstimatedArrivalMin
// y el EstimatedArrivalMin de cada AssignmentStop.
//
// Tiempo de viaje por tramo: prioriza AvgTransitHours del grafo de sucursales
// (datos históricos reales o baseline de 60 km/h del seed). Si la arista no tiene
// dato, cae a (distKm * 1.3) / InterBranchAvgSpeedKmh * 60 — el factor 1.3 es el
// mismo detour que usa el VRP. NUNCA usa AvgSpeedKmh (esa es velocidad urbana de
// última milla, ~25 km/h, no aplica a tramos inter-sucursal de ruta).
//
// En cada parada intermedia (todas salvo la última) se suma InterBranchStopMinutes
// como dwell de descarga + carga de pallets antes de continuar al próximo destino.
// La parada primaria también suma dwell cuando es intermedia (viaje multi-hop).
// Es independiente de ServiceTimeMinutes (tiempo de entrega de última milla).
func (s *RoutingService) scheduleInterBranchAssignments(
	assignments []model.InterBranchAssignment,
	branchID string,
	cfg model.RoutingConfig,
) {
	if len(assignments) == 0 {
		return
	}

	fallbackSpeed := cfg.InterBranchAvgSpeedKmh
	if fallbackSpeed <= 0 {
		fallbackSpeed = 60
	}
	depMin := cfg.InterBranchDispatchHour * 60
	dwell := cfg.InterBranchStopMinutes
	if dwell < 0 {
		dwell = 240
	}

	// Lookup de horas de tránsito reales por arista (cargado una vez).
	transitHours := map[string]float64{}
	if s.graphSvc != nil {
		if g, err := s.graphSvc.GetGraph(); err == nil {
			for _, e := range g.Edges {
				if e.Enabled && e.AvgTransitHours > 0 {
					transitHours[e.FromBranchID+"|"+e.ToBranchID] = e.AvgTransitHours
				}
			}
		}
	}

	legTravelMin := func(from, to string) int {
		if from == to {
			return 0
		}
		if h, ok := transitHours[from+"|"+to]; ok {
			return int(h * 60)
		}
		dist := s.branchDistance(from, to)
		if dist < 0 {
			return 0
		}
		return int(dist * 1.3 / fallbackSpeed * 60)
	}

	for i := range assignments {
		a := &assignments[i]
		a.EstimatedDepartureMin = depMin

		// Secuencia completa de sucursales: primaria + adicionales.
		// stops[0] = destino primario; stops[k>0] = AdditionalStops[k-1].
		stops := []string{a.DestinationBranch}
		for _, st := range a.AdditionalStops {
			stops = append(stops, st.BranchID)
		}

		current := depMin
		prev := branchID
		for idx, dest := range stops {
			current += legTravelMin(prev, dest)
			// Registrar arribo (antes del dwell de esta parada).
			if idx == 0 {
				a.PrimaryEstimatedArrivalMin = current
			} else {
				a.AdditionalStops[idx-1].EstimatedArrivalMin = current
			}
			// Dwell en paradas intermedias: descarga + carga antes de seguir.
			// La última parada no suma dwell (el arribo es el fin del viaje).
			if idx < len(stops)-1 {
				current += dwell
			}
			prev = dest
		}
		a.EstimatedArrivalMin = current
	}
}

// tripScheduleFor calcula los timestamps de salida y llegada estimados para
// un trip al momento de Apply. Devuelve (scheduledDepartureAt, estimatedArrivalAt).
// Retorna nils si no hay datos de schedule en el assignment.
func tripScheduleFor(planDate model.DateOnly, departureMin, arrivalMin int) (*time.Time, *time.Time) {
	if departureMin == 0 && arrivalMin == 0 {
		return nil, nil
	}
	dep := dateAtMinute(planDate, departureMin)
	arr := dateAtMinute(planDate, arrivalMin)
	return &dep, &arr
}

// interBranchArrivalByBranch mapea branchID → arribo estimado (min desde medianoche)
// desde el schedule del assignment. Se usa para propagar el ETA a cada TripStop SIN
// depender del orden posicional: las paradas del trip se arman condicionalmente
// (se saltean las que no tienen envíos aplicados), así que un mapeo por índice se
// desalinearía. Los branch IDs de un viaje son distintos, así que la clave es segura.
func interBranchArrivalByBranch(a model.InterBranchAssignment) map[string]int {
	m := map[string]int{}
	if a.PrimaryEstimatedArrivalMin > 0 {
		m[a.DestinationBranch] = a.PrimaryEstimatedArrivalMin
	}
	for _, st := range a.AdditionalStops {
		if st.EstimatedArrivalMin > 0 {
			m[st.BranchID] = st.EstimatedArrivalMin
		}
	}
	return m
}

// computeRoadPolyline devuelve la geometría real del trayecto (vía calles)
// que parte del depósito, pasa por todas las paradas en orden y vuelve al
// depósito.
//
// Estrategia por modo:
//   - segura + ORS configurado: ORS Directions con avoid_polygons = zonas
//     activas → ORS rutea genuinamente alrededor de cada zona.
//   - segura + solo OSRM: OSRM con waypoints de bordeado intercalados (mejor
//     esfuerzo; OSRM puede aún cortar si hay calles que atraviesan la zona).
//   - ventanas / costo: OSRM directo entre paradas (líneas rectas → calles).
//
// Devuelve nil si no hay routing engine configurado o si la llamada falla;
// el frontend cae a líneas rectas en ese caso.
func (s *RoutingService) computeRoadPolyline(
	depotCoord vrp.Coord,
	shipmentTIDs []string,
	shipByTID map[string]model.Shipment,
	activeZones []model.Zone,
	mode model.RouteMode,
) []model.LatLng {
	// Construir la lista plana de paradas: depot → cada shipment con coords → depot.
	type latLon struct{ Lat, Lon float64 }
	var stops []latLon
	stops = append(stops, latLon{depotCoord.Lat, depotCoord.Lon})
	for _, tid := range shipmentTIDs {
		sh, ok := shipByTID[tid]
		if !ok || sh.Recipient.Address.Latitude == nil || sh.Recipient.Address.Longitude == nil {
			continue
		}
		stops = append(stops, latLon{*sh.Recipient.Address.Latitude, *sh.Recipient.Address.Longitude})
	}
	stops = append(stops, latLon{depotCoord.Lat, depotCoord.Lon})

	if len(stops) < 2 {
		return nil
	}

	// Path A: ORS con avoid_polygons para modo segura, arco por arco.
	//
	// Hacer una sola llamada con todos los stops falla si alguno cae fuera
	// de la cobertura del grafo ORS (p.ej. suburbios del GBA). Con routing
	// por arco, si ORS no puede conectar un par específico cae al fallback
	// de OSRM solo para ese arco, y el resto del recorrido sigue usando ORS.
	if mode == model.RouteModeSegura && s.orsClient != nil && len(activeZones) > 0 {
		polys := make([]ors.Polygon, 0, len(activeZones))
		for _, z := range activeZones {
			ring := make([]ors.Coord, len(z.Polygon))
			for i, p := range z.Polygon {
				ring[i] = ors.Coord{Lat: p.Lat, Lon: p.Lng}
			}
			polys = append(polys, ors.Polygon{Coords: ring})
		}

		var polyline []model.LatLng
		orsArcs, osrmArcs := 0, 0
		for i := 1; i < len(stops); i++ {
			prev, curr := stops[i-1], stops[i]
			arcCoords := []ors.Coord{
				{Lat: prev.Lat, Lon: prev.Lon},
				{Lat: curr.Lat, Lon: curr.Lon},
			}
			geom, err := s.orsClient.Route(arcCoords, polys)
			if err != nil {
				// ORS falló en este arco — usar OSRM con bypass waypoints.
				osrmArcs++
				prevVrp := vrp.Coord{Lat: prev.Lat, Lon: prev.Lon}
				currVrp := vrp.Coord{Lat: curr.Lat, Lon: curr.Lon}
				oCoords := []osrm.Coord{{Lat: prev.Lat, Lon: prev.Lon}}
				for _, wp := range computeBypassWaypoints(prevVrp, currVrp, activeZones) {
					oCoords = append(oCoords, osrm.Coord{Lat: wp.Lat, Lon: wp.Lon})
				}
				oCoords = append(oCoords, osrm.Coord{Lat: curr.Lat, Lon: curr.Lon})
				if r, e2 := s.osrmClient.Route(oCoords); e2 == nil {
					for j, c := range r {
						if j == 0 && len(polyline) > 0 {
							continue
						}
						polyline = append(polyline, model.LatLng{Lat: c.Lat, Lng: c.Lon})
					}
				}
				continue
			}
			orsArcs++
			for j, c := range geom {
				if j == 0 && len(polyline) > 0 {
					continue // evitar duplicar el punto de unión entre arcos
				}
				polyline = append(polyline, model.LatLng{Lat: c.Lat, Lng: c.Lon})
			}
		}
		if len(polyline) > 0 {
			log.Printf("[routing] mode=segura engine=ORS+OSRM arcos_ors=%d arcos_osrm_fallback=%d puntos_polyline=%d",
				orsArcs, osrmArcs, len(polyline))
			return polyline
		}
	}

	// Path B: OSRM Route. Para segura intercalamos los waypoints de bordeado
	// (mejor esfuerzo, fallback cuando ORS no está disponible).
	if s.osrmClient == nil {
		return nil
	}
	coords := []osrm.Coord{{Lat: stops[0].Lat, Lon: stops[0].Lon}}
	for i := 1; i < len(stops); i++ {
		prev := vrp.Coord{Lat: stops[i-1].Lat, Lon: stops[i-1].Lon}
		curr := vrp.Coord{Lat: stops[i].Lat, Lon: stops[i].Lon}
		if mode == model.RouteModeSegura && len(activeZones) > 0 {
			for _, wp := range computeBypassWaypoints(prev, curr, activeZones) {
				coords = append(coords, osrm.Coord{Lat: wp.Lat, Lon: wp.Lon})
			}
		}
		coords = append(coords, osrm.Coord{Lat: curr.Lat, Lon: curr.Lon})
	}
	routeCoords, err := s.osrmClient.Route(coords)
	if err != nil {
		log.Printf("[routing] OSRM Route falló (cayendo a líneas rectas en cliente): %v", err)
		return nil
	}
	if len(routeCoords) <= len(coords) {
		log.Printf("[routing] mode=%s engine=OSRM waypoints_enviados=%d puntos_polyline=%d (DEGENERADA — OSRM devolvió <= N waypoints, posibles coords coincidentes)", mode, len(coords), len(routeCoords))
	} else {
		log.Printf("[routing] mode=%s engine=OSRM waypoints_enviados=%d puntos_polyline=%d", mode, len(coords), len(routeCoords))
	}
	out := make([]model.LatLng, len(routeCoords))
	for i, c := range routeCoords {
		out[i] = model.LatLng{Lat: c.Lat, Lng: c.Lon}
	}
	return out
}

// binPackLastMileVehicles assigns last-mile shipments to ultima_milla vehicles.
// Drivers self-assign by scanning the vehicle QR at trip start.
func (s *RoutingService) binPackLastMileVehicles(
	queue []model.Shipment,
	branchID string,
	unassigned []model.UnassignedShipment,
) ([]model.LastMileAssignment, []model.UnassignedShipment) {
	if len(queue) == 0 {
		return nil, unassigned
	}

	// Vehicles available for last-mile in this branch, no active trip
	all := s.vehicleRepo.List()
	var vehicles []model.Vehicle
	for _, v := range all {
		if v.AssignedBranch == nil || *v.AssignedBranch != branchID {
			continue
		}
		if v.Mode != model.VehicleModeLastMile {
			continue
		}
		if v.Status == model.VehicleStatusInTransit || v.Status == model.VehicleStatusInMaintenance || v.Status == model.VehicleStatusInactive {
			continue
		}
		if s.interBranchTripSvc != nil {
			if _, hasTrip := s.interBranchTripSvc.repo.GetActiveByVehicle(v.ID); hasTrip {
				continue
			}
		}
		vehicles = append(vehicles, v)
	}

	if len(vehicles) == 0 {
		for _, sh := range queue {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_vehiculos_ultima_milla_disponibles",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
		return nil, unassigned
	}

	sortShipmentsForLastMile(queue)
	sort.SliceStable(vehicles, func(i, j int) bool {
		return vehicles[i].CapacityKg < vehicles[j].CapacityKg
	})

	type bucket struct {
		vehicle   model.Vehicle
		shipments []string
		weight    float64
	}
	buckets := make([]*bucket, len(vehicles))
	for i, v := range vehicles {
		buckets[i] = &bucket{vehicle: v}
	}

	for _, sh := range queue {
		assigned := false
		for _, b := range buckets {
			if b.weight+sh.WeightKg <= b.vehicle.CapacityKg {
				b.shipments = append(b.shipments, sh.TrackingID)
				b.weight += sh.WeightKg
				assigned = true
				break
			}
		}
		if !assigned {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_capacidad_en_vehiculos",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
	}

	var out []model.LastMileAssignment
	for _, b := range buckets {
		if len(b.shipments) == 0 {
			continue
		}
		out = append(out, model.LastMileAssignment{
			VehicleID:     b.vehicle.ID,
			LicensePlate:  b.vehicle.LicensePlate,
			CapacityKg:    b.vehicle.CapacityKg,
			Shipments:     b.shipments,
			TotalWeightKg: roundKg(b.weight),
		})
	}
	return out, unassigned
}

// binPackLastMileVehiclesCtx es la variante de binPackLastMileVehicles que usa
// el vehicleSource del planContext (para días proyectados).
func (s *RoutingService) binPackLastMileVehiclesCtx(
	queue []model.Shipment,
	branchID string,
	unassigned []model.UnassignedShipment,
	pc *planContext,
) ([]model.LastMileAssignment, []model.UnassignedShipment) {
	if pc == nil || pc.day == 0 {
		return s.binPackLastMileVehicles(queue, branchID, unassigned)
	}
	if len(queue) == 0 {
		return nil, unassigned
	}
	// En días proyectados: obtener vehículos de última milla del estado proyectado.
	projVehicles, _ := pc.vehicleSource(branchID, model.VehicleModeLastMile)
	if len(projVehicles) == 0 {
		for _, sh := range queue {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_vehiculos_ultima_milla_disponibles",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
		return nil, unassigned
	}
	// Reusar binPackLastMileVehicles pasando los vehículos proyectados como pool.
	// Esto requiere un pequeño workaround ya que la función original lee el repo.
	// Para D>0, delegamos a una versión inline simplificada (un vehículo = una ruta).
	return s.binPackWithPool(queue, projVehicles, branchID, unassigned)
}

// binPackWithPool es un bin-packing simplificado para días proyectados.
func (s *RoutingService) binPackWithPool(
	queue []model.Shipment,
	vehicles []model.Vehicle,
	branchID string,
	unassigned []model.UnassignedShipment,
) ([]model.LastMileAssignment, []model.UnassignedShipment) {
	if len(vehicles) == 0 {
		for _, sh := range queue {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_vehiculos_ultima_milla_disponibles",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
		return nil, unassigned
	}
	// Distribuir envíos en el primer vehículo que quepa (greedy).
	assignments := make([]model.LastMileAssignment, 0, len(vehicles))
	vehicleIdx := 0
	var current *model.LastMileAssignment
	var currentLoad float64

	for _, sh := range queue {
		for vehicleIdx < len(vehicles) {
			v := vehicles[vehicleIdx]
			if current == nil {
				assignments = append(assignments, model.LastMileAssignment{
					VehicleID:    v.ID,
					LicensePlate: v.LicensePlate,
					CapacityKg:   v.CapacityKg,
				})
				current = &assignments[len(assignments)-1]
				currentLoad = 0
			}
			if currentLoad+sh.WeightKg <= v.CapacityKg {
				current.Shipments = append(current.Shipments, sh.TrackingID)
				current.TotalWeightKg = roundKg(currentLoad + sh.WeightKg)
				currentLoad += sh.WeightKg
				break
			}
			// Vehículo lleno: siguiente.
			vehicleIdx++
			current = nil
			currentLoad = 0
		}
		if vehicleIdx >= len(vehicles) {
			unassigned = append(unassigned, model.UnassignedShipment{
				TrackingID:  sh.TrackingID,
				Destination: lastMileDestLabel,
				Reason:      "sin_vehiculos_ultima_milla_disponibles",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
	}
	// Filtrar assignments vacíos (si algún vehículo no recibió nada).
	var out []model.LastMileAssignment
	for _, a := range assignments {
		if len(a.Shipments) > 0 {
			out = append(out, a)
		}
	}
	_ = branchID
	return out, unassigned
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

	// Si no hay vehículos en pool del branch, todos al unassigned con motivo claro.
	// Propagamos SLAForced y PriorityScore para que tryProjectedDispatch pueda
	// evaluar viabilidad contra la capacidad del vehículo entrante.
	if len(pool) == 0 {
		for dest, group := range groups {
			forced := anyForced(group, cfg, now)
			for _, sh := range group {
				unassigned = append(unassigned, model.UnassignedShipment{
					TrackingID:    sh.TrackingID,
					Destination:   dest,
					Reason:        "sin_vehiculos_disponibles",
					WeightKg:      sh.WeightKg,
					Priority:      sh.Priority,
					SLAForced:     forced,
					PriorityScore: sh.PriorityScore,
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
		refCap := fillRateCapacity(poolForDest, existingLoad, totalWeight, cfg.MinFillRate)

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
					TrackingID:    sh.TrackingID,
					Destination:   dest,
					Reason:        "sin_vehiculos_para_destino",
					WeightKg:      sh.WeightKg,
					Priority:      sh.Priority,
					SLAForced:     forced,
					PriorityScore: sh.PriorityScore,
				})
			}
			continue
		}

		chosen, included, excluded := selectAndPack(poolForDest, existingLoad, group, cfg.MinFillRate)
		if chosen == nil {
			for _, sh := range group {
				unassigned = append(unassigned, model.UnassignedShipment{
					TrackingID:    sh.TrackingID,
					Destination:   dest,
					Reason:        "sin_vehiculos_para_destino",
					WeightKg:      sh.WeightKg,
					Priority:      sh.Priority,
					SLAForced:     forced,
					PriorityScore: sh.PriorityScore,
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
	// Inicializamos como empty (no nil) para que el JSON siempre serialice
	// como `[]` y no como `null` — el frontend asume array.
	items := make([]model.ApplyResultItem, 0)
	local := clock.Now().In(clock.LocalTZ)
	var planDate model.DateOnly
	if plan.PlanDate != "" {
		if t, err := time.ParseInLocation("2006-01-02", plan.PlanDate, clock.LocalTZ); err == nil {
			planDate = model.NewDateOnly(t)
		} else {
			planDate = model.NewDateOnly(local)
		}
	} else {
		planDate = model.NewDateOnly(local)
	}
	cfg := s.cfgSvc.Get()

	// === Última milla ===
	for _, asgmt := range plan.LastMile {
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
		// Check no active trip already exists for this vehicle
		if s.interBranchTripSvc != nil {
			if _, hasTrip := s.interBranchTripSvc.repo.GetActiveByVehicle(v.ID); hasTrip {
				for _, tid := range asgmt.Shipments {
					items = append(items, failedItem(tid, target, "vehiculo_con_viaje_activo"))
				}
				continue
			}
		}

		var currentLoad float64
		for _, existingTID := range v.AssignedShipments {
			if esh, err := s.shipmentRepo.GetByTrackingID(existingTID); err == nil {
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
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub && sh.Status != model.StatusRedeliveryScheduled {
				items = append(items, failedItem(tid, target, "estado_cambio:"+string(sh.Status)))
				continue
			}
			if currentLoad+sh.WeightKg > v.CapacityKg {
				items = append(items, failedItem(tid, target, "capacidad_excedida"))
				continue
			}

			// Auto-move from Entrada to Salida if needed (US-05 CA-02)
			if s.branchZoneSvc != nil && sh.CurrentZone != nil && *sh.CurrentZone == string(model.ZoneEntrada) {
				if err := s.branchZoneSvc.MoveShipment(tid, username, branchID, "", model.ZoneSalida, model.RoleSupervisor); err != nil {
					items = append(items, failedItem(tid, target, "error_auto_mover_a_salida"))
					continue
				}
			}

			if err := s.vehicleRepo.AddShipment(v.ID, tid); err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}
			_, err = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusLoaded,
				ChangedBy: username,
				Notes:     "Carga automática al aplicar plan de ruteo (última milla)",
			})
			if err != nil {
				_ = s.vehicleRepo.RemoveShipment(v.ID, tid)
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}
			currentLoad += sh.WeightKg
			anyApplied = true
			items = append(items, model.ApplyResultItem{TrackingID: tid, Target: target, Status: "applied"})
		}

		if anyApplied {
			if v.Status == model.VehicleStatusAvailable {
				_ = s.vehicleRepo.UpdateStatusByUser(v.ID, model.VehicleStatusLoading, username)
			}
			// Create last_mile trip — driver will self-assign via QR
			if s.interBranchTripSvc != nil {
				appliedIDs := make([]string, 0)
				var totalWeight float64
				for _, it := range items {
					if it.Status == "applied" && it.Target == target {
						appliedIDs = append(appliedIDs, it.TrackingID)
						if sh, err := s.shipmentRepo.GetByTrackingID(it.TrackingID); err == nil {
							totalWeight += sh.WeightKg
						}
					}
				}
				if len(appliedIDs) > 0 {
					// Calcular timestamps para última milla usando el schedule del VRP
					var lastMileArrivalMin int
					if len(asgmt.OrderedStops) > 0 {
						last := asgmt.OrderedStops[len(asgmt.OrderedStops)-1]
						if last.ArrivalMin >= 0 {
							lastMileArrivalMin = asgmt.SuggestedDepartureMin + last.ArrivalMin + cfg.ServiceTimeMinutes
						}
					}
					schedDep, estArr := tripScheduleFor(planDate, asgmt.SuggestedDepartureMin, lastMileArrivalMin)
					_, _ = s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
						Kind:                 model.TripKindLastMile,
						DriverID:             asgmt.DriverID,
						VehicleID:            v.ID,
						LicensePlate:         v.LicensePlate,
						OriginBranchID:       branchID,
						DestinationBranchID:  nil,
						ShipmentIDs:          appliedIDs,
						TotalWeightKg:        totalWeight,
						CreatedBy:            username,
						ScheduledDepartureAt: schedDep,
						EstimatedArrivalAt:   estArr,
					})
				}
			}
		}
	}

	// === Inter-sucursal ===
	for _, asgmt := range plan.InterBranch {
		target := "vehicle:" + asgmt.LicensePlate
		// Despachos proyectados: el vehículo aún no llegó — no se pueden aplicar.
		if asgmt.Projected {
			for _, tid := range asgmt.Shipments {
				items = append(items, failedItem(tid, target, "despacho_proyectado_vehiculo_en_transito"))
			}
			continue
		}
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

		// Set de pickup TIDs: envíos cross-branch que se levantan en paradas
		// intermedias. NO se cargan al origen — solo se marcan como "aplicados"
		// para que el trip los registre como pickups. La reserva (ReserveForTrip)
		// la hace el bloque que crea el Trip.
		pickupSet := map[string]bool{}
		for _, tid := range asgmt.PrimaryPickupShipments {
			pickupSet[tid] = true
		}
		for _, st := range asgmt.AdditionalStops {
			for _, tid := range st.PickupShipments {
				pickupSet[tid] = true
			}
		}

		anyApplied := false
		for _, tid := range asgmt.Shipments {
			// Cross-branch pickup: marcamos applied sin cargar al vehículo ni cambiar
			// estado. Físicamente el envío se levantará al pasar por su sucursal.
			if pickupSet[tid] {
				items = append(items, model.ApplyResultItem{TrackingID: tid, Target: target, Status: "applied"})
				anyApplied = true
				continue
			}
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

			// Auto-move from Entrada to Salida if needed (US-05 CA-02)
			if s.branchZoneSvc != nil && sh.CurrentZone != nil && *sh.CurrentZone == string(model.ZoneEntrada) {
				if err := s.branchZoneSvc.MoveShipment(tid, username, branchID, "", model.ZoneSalida, model.RoleSupervisor); err != nil {
					items = append(items, failedItem(tid, target, "error_auto_mover_a_salida"))
					continue
				}
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

		// Create InterBranchTrip — driver self-assigns via QR. Multi-hop aware.
		if anyApplied && s.interBranchTripSvc != nil {
			appliedSet := map[string]bool{}
			for _, it := range items {
				if it.Status == "applied" && it.Target == target {
					appliedSet[it.TrackingID] = true
				}
			}
			weight := func(tid string) float64 {
				if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
					return sh.WeightKg
				}
				return 0
			}

			// Construir paradas: primera = destino primario, luego AdditionalStops.
			// Solo incluimos shipments que efectivamente fueron aplicados.
			var stops []model.TripStop
			var allShipments []string
			var totalWeight float64

			// Parada primaria: shipments del asgmt que no estén en AdditionalStops
			additionalSet := map[string]bool{}
			for _, st := range asgmt.AdditionalStops {
				for _, tid := range st.Shipments {
					additionalSet[tid] = true
				}
			}
			primaryShipments := []string{}
			var primaryWeight float64
			for _, tid := range asgmt.Shipments {
				if !appliedSet[tid] || additionalSet[tid] {
					continue
				}
				primaryShipments = append(primaryShipments, tid)
				primaryWeight += weight(tid)
			}
			if len(primaryShipments) > 0 || len(asgmt.PrimaryPickupShipments) > 0 {
				stops = append(stops, model.TripStop{
					BranchID:          asgmt.DestinationBranch,
					ShipmentIDs:       primaryShipments,
					TotalWeightKg:     roundKg(primaryWeight),
					PickupShipmentIDs: append([]string(nil), asgmt.PrimaryPickupShipments...),
					PickupWeightKg:    asgmt.PrimaryPickupWeightKg,
				})
				allShipments = append(allShipments, primaryShipments...)
				totalWeight += primaryWeight
			}

			for _, st := range asgmt.AdditionalStops {
				stopShipments := []string{}
				var stopWeight float64
				for _, tid := range st.Shipments {
					if !appliedSet[tid] {
						continue
					}
					stopShipments = append(stopShipments, tid)
					stopWeight += weight(tid)
				}
				if len(stopShipments) > 0 || len(st.PickupShipments) > 0 {
					stops = append(stops, model.TripStop{
						BranchID:          st.BranchID,
						ShipmentIDs:       stopShipments,
						TotalWeightKg:     roundKg(stopWeight),
						PickupShipmentIDs: append([]string(nil), st.PickupShipments...),
						PickupWeightKg:    st.PickupWeightKg,
					})
					allShipments = append(allShipments, stopShipments...)
					totalWeight += stopWeight
				}
			}

			if len(allShipments) > 0 {
				// El destino persistido es la última parada (final)
				finalDest := asgmt.DestinationBranch
				if len(stops) > 0 {
					finalDest = stops[len(stops)-1].BranchID
				}
				// Determinar la fecha del viaje: scheduled_date del operador o planDate.
				tripDate := planDate
				if asgmt.ScheduledDate != "" {
					if parsed, err := time.ParseInLocation("2006-01-02", asgmt.ScheduledDate, clock.LocalTZ); err == nil {
						tripDate = model.NewDateOnly(parsed)
					}
				}
				// Propagar estimated_arrival_at a cada TripStop por branch ID
				// (las paradas se arman condicionalmente; no usar índice posicional).
				arrivalByBranch := interBranchArrivalByBranch(asgmt)
				for idx := range stops {
					if arrMin, ok := arrivalByBranch[stops[idx].BranchID]; ok {
						t := dateAtMinute(tripDate, arrMin)
						stops[idx].EstimatedArrivalAt = &t
					}
				}
				schedDep, estArr := tripScheduleFor(tripDate, asgmt.EstimatedDepartureMin, asgmt.EstimatedArrivalMin)
				createdTrip, err := s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
					Kind:                 model.TripKindInterBranch,
					DriverID:             nil,
					VehicleID:            v.ID,
					LicensePlate:         v.LicensePlate,
					OriginBranchID:       branchID,
					DestinationBranchID:  &finalDest,
					ShipmentIDs:          allShipments,
					TotalWeightKg:        roundKg(totalWeight),
					Stops:                stops,
					CreatedBy:            username,
					ScheduledDepartureAt: schedDep,
					EstimatedArrivalAt:   estArr,
				})
				// Reservar pickups: para cada stop con PickupShipmentIDs,
				// marcar los envíos como reservados por este trip.
				if err == nil {
					for _, st := range stops {
						for _, tid := range st.PickupShipmentIDs {
							_ = s.shipmentRepo.ReserveForTrip(tid, createdTrip.ID)
						}
					}
				}
			}
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
//
// Excepción: envíos con ScheduledDeliveryDate == hoy (solicitado explícitamente via
// chatbot) se tratan como si tuvieran ventana "afternoon" en caso de ser flexible,
// ya que representan un compromiso con el destinatario.
func sortShipmentsForLastMile(s []model.Shipment) {
	now := clock.Now().UTC()
	sort.SliceStable(s, func(i, j int) bool {
		if r := effectiveTimeWindowRank(s[i], now) - effectiveTimeWindowRank(s[j], now); r != 0 {
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

// effectiveTimeWindowRank devuelve el rank de ordenación considerando la fecha
// solicitada via chatbot: si el envío es flexible pero el destinatario pidió entrega
// hoy explícitamente, se eleva al mismo nivel que "afternoon".
func effectiveTimeWindowRank(sh model.Shipment, now time.Time) int {
	base := timeWindowRank(sh.TimeWindow)
	// Solo aplica el boost a flexible; morning y afternoon ya tienen compromiso contractual.
	if base == 2 {
		if d := chatbotScheduledDate(sh); d != nil && isSameDay(*d, now) {
			return 1 // equipara con afternoon
		}
	}
	return base
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

// chatbotScheduledDate devuelve la fecha solicitada por el destinatario via chatbot,
// truncada a medianoche UTC, o nil si no hay solicitud explícita.
func chatbotScheduledDate(sh model.Shipment) *time.Time {
	if sh.ChatbotMetadata == nil || sh.ChatbotMetadata.ScheduledDeliveryDate == nil {
		return nil
	}
	d := sh.ChatbotMetadata.ScheduledDeliveryDate.UTC().Truncate(24 * time.Hour)
	return &d
}

// isSameDay reporta si dos instantes pertenecen al mismo día calendario UTC.
func isSameDay(a, b time.Time) bool {
	ay, am, ad := a.UTC().Date()
	by, bm, bd := b.UTC().Date()
	return ay == by && am == bm && ad == bd
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

// isSLAActive returns true if the shipment is in an active (non-terminal) state.
func isSLAActive(sh model.Shipment) bool {
	if model.IsTerminalStatus(sh.Status) {
		return false
	}
	if sh.Status == model.StatusExpired || sh.Status == model.StatusRechazado {
		return false
	}
	return sh.EstimatedDeliveryAt != nil
}

// isSLAExpired returns true when the shipment's ETA has already passed and it's still active.
func isSLAExpired(sh model.Shipment, now time.Time) bool {
	return isSLAActive(sh) && now.After(*sh.EstimatedDeliveryAt)
}

// isSLACriticalETA returns true if the shipment is within the SLA forced horizon
// but has NOT yet expired.
func isSLACriticalETA(sh model.Shipment, cfg model.RoutingConfig, now time.Time) bool {
	if !isSLAActive(sh) {
		return false
	}
	slaHorizon := time.Duration(cfg.SLAForceHorizonHours) * time.Hour
	remaining := sh.EstimatedDeliveryAt.Sub(now)
	return remaining >= 0 && remaining < slaHorizon
}

// RunSLARiskCheck fetches all shipments and runs the SLA risk state machine
// immediately using the current system clock. Called by the admin clock handler
// so that advancing the clock triggers notifications without waiting for the
// next scheduled plan regeneration.
func (s *RoutingService) RunSLARiskCheck() {
	if s.notifSvc == nil {
		return
	}
	cfg := s.cfgSvc.Get()
	all, err := s.shipmentRepo.List(model.ShipmentFilter{})
	if err != nil {
		log.Printf("[RoutingService] RunSLARiskCheck: list shipments error: %v", err)
		return
	}
	s.checkSLARisk(all, cfg, clock.Now().UTC())
}

// checkSLARisk evaluates SLA state for each shipment and fires/resets notifications.
//
// State machine per shipment:
//
//	inactive  → nothing
//	active, remaining >= horizon → reset both flags (exited risk window)
//	active, 0 <= remaining < horizon → sla_risk once (CA-04); reset expired flag if set
//	active, remaining < 0 (expired) → sla_expired once; sla_risk flag stays
func (s *RoutingService) checkSLARisk(shipments []model.Shipment, cfg model.RoutingConfig, now time.Time) {
	for _, sh := range shipments {
		if !isSLAActive(sh) {
			continue
		}

		expired := isSLAExpired(sh, now)
		critical := !expired && isSLACriticalETA(sh, cfg, now)

		branchID := sh.CurrentLocation
		if branchID == "" {
			branchID = sh.ReceivingBranchID
		}

		if expired {
			// Send expired notification once
			if sh.SLAExpiredNotifiedAt == nil {
				t := now
				if err := s.shipmentRepo.SetSLAExpiredNotified(sh.TrackingID, &t); err != nil {
					log.Printf("[RoutingService] SetSLAExpiredNotified error for %s: %v", sh.TrackingID, err)
					continue
				}
				shCopy := sh
				// Notificaciones al cliente: ambos canales se disparan de forma independiente — LOGITRACK-124
				if s.slaExpiredWASvc != nil {
					go s.slaExpiredWASvc.SendSLAExpiredWhatsApp(shCopy)
				}
				if s.slaExpiredEmailSvc != nil {
					go s.slaExpiredEmailSvc.SendSLAExpiredNotification(shCopy)
				}
				// Notificación interna a operadores/supervisores — LOGITRACK-404
				if s.notifSvc != nil {
					go s.notifSvc.NotifySLAExpired(shCopy, branchID)
				}
			}
		} else if critical {
			// Send at-risk notification once per entry into risk window (CA-04)
			if sh.SLANotifiedAt == nil {
				t := now
				if err := s.shipmentRepo.SetSLANotified(sh.TrackingID, &t); err != nil {
					log.Printf("[RoutingService] SetSLANotified error for %s: %v", sh.TrackingID, err)
					continue
				}
				// Reset expired flag in case ETA was extended and re-entered risk window
				if sh.SLAExpiredNotifiedAt != nil {
					_ = s.shipmentRepo.SetSLAExpiredNotified(sh.TrackingID, nil)
				}
				shCopy := sh
				go s.notifSvc.NotifySLARisk(shCopy, branchID)
			}
		} else {
			// Outside risk window — reset both flags so re-entry re-notifies (CA-04)
			if sh.SLANotifiedAt != nil {
				if err := s.shipmentRepo.SetSLANotified(sh.TrackingID, nil); err != nil {
					log.Printf("[RoutingService] SetSLANotified reset error for %s: %v", sh.TrackingID, err)
				}
			}
			if sh.SLAExpiredNotifiedAt != nil {
				if err := s.shipmentRepo.SetSLAExpiredNotified(sh.TrackingID, nil); err != nil {
					log.Printf("[RoutingService] SetSLAExpiredNotified reset error for %s: %v", sh.TrackingID, err)
				}
			}
		}
	}
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
// el umbral de consolidación.
//
//  1. Si hay vehículo que cubre todo el load y alcanza min_fill_rate de
//     utilización, devuelve el más chico (preferimos despachar todo junto).
//  2. Si ningún vehículo que cubre alcanza el fill rate (caso de camión
//     sobredimensionado), cae al de mayor utilización efectiva (load capado a
//     su capacidad / capacidad), con desempate por mayor capacidad disponible.
//
// Ejemplo (1): 250 kg con pool [100, 600, 2000] @ 10% → 600 cubre y rinde 42%
// → devuelve 600.
// Ejemplo (2): 1051 kg con pool [500, 800, 5000] @ 40% → solo 5000 cubre pero
// rinde 21% (< 40%) → fallback max-util → 800 (mismo 100% que 500, más grande).
func fillRateCapacity(pool []model.Vehicle, existingLoad map[string]float64, totalWeight, minFillRate float64) float64 {
	if totalWeight <= 0 {
		return 0
	}
	bestCap := 0.0
	for _, v := range pool {
		avail := v.CapacityKg - existingLoad[v.ID]
		if avail <= 0 || avail < totalWeight {
			continue
		}
		if totalWeight/avail < minFillRate {
			continue
		}
		if bestCap == 0 || avail < bestCap {
			bestCap = avail
		}
	}
	if bestCap > 0 {
		return bestCap
	}
	bestUtil := -1.0
	for _, v := range pool {
		avail := v.CapacityKg - existingLoad[v.ID]
		if avail <= 0 {
			continue
		}
		load := totalWeight
		if load > avail {
			load = avail
		}
		util := load / avail
		if util > bestUtil || (util == bestUtil && avail > bestCap) {
			bestUtil = util
			bestCap = avail
		}
	}
	return bestCap
}

func sumWeights(shipments []model.Shipment) float64 {
	total := 0.0
	for _, sh := range shipments {
		total += sh.WeightKg
	}
	return total
}

// selectAndPack elige el vehículo y bin-packea sobre la capacidad DISPONIBLE.
// Usa el mismo criterio que fillRateCapacity para mantenerse coherente con la
// referencia del umbral de consolidación:
//
//  1. Más chico que cubre todo el load y alcanza min_fill_rate.
//  2. Fallback: mayor utilización efectiva, desempate por mayor capacidad.
//
// Si el vehículo elegido no cubre el total, bin-pack por prioridad desc y el
// excedente queda en excluded (`sobrepeso_excede_vehiculo`).
func selectAndPack(pool []model.Vehicle, existingLoad map[string]float64, shipments []model.Shipment, minFillRate float64) (*model.Vehicle, []model.Shipment, []model.Shipment) {
	if len(pool) == 0 || len(shipments) == 0 {
		return nil, nil, nil
	}
	total := sumWeights(shipments)
	avail := func(v *model.Vehicle) float64 { return v.CapacityKg - existingLoad[v.ID] }

	var chosen *model.Vehicle
	for i := range pool {
		v := &pool[i]
		a := avail(v)
		if a < total {
			continue
		}
		if total/a < minFillRate {
			continue
		}
		if chosen == nil || a < avail(chosen) {
			chosen = v
		}
	}
	if chosen != nil {
		out := make([]model.Shipment, len(shipments))
		copy(out, shipments)
		return chosen, out, nil
	}

	chosenUtil := -1.0
	for i := range pool {
		v := &pool[i]
		a := avail(v)
		if a <= 0 {
			continue
		}
		load := total
		if load > a {
			load = a
		}
		util := load / a
		if chosen == nil || util > chosenUtil || (util == chosenUtil && a > avail(chosen)) {
			chosen = v
			chosenUtil = util
		}
	}
	if chosen == nil {
		return nil, nil, nil
	}

	cap := avail(chosen)
	if cap >= total {
		out := make([]model.Shipment, len(shipments))
		copy(out, shipments)
		return chosen, out, nil
	}

	used := 0.0
	var included, excluded []model.Shipment
	for _, sh := range shipments {
		if used+sh.WeightKg <= cap {
			included = append(included, sh)
			used += sh.WeightKg
		} else {
			excluded = append(excluded, sh)
		}
	}
	return chosen, included, excluded
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

// addMultiHopStops agrega paradas adicionales (hop 2 y opcional hop 3) a los
// despachos ya armados cuando hay envíos sin asignar cuyo path pasa por el
// destino primario del despacho. Tope: model.MaxTripStops paradas en total
// (incluyendo la primaria). El grafo de sucursales (s.graphSvc) provee el
// shortest-path; si no está configurado, la función no hace nada.
func (s *RoutingService) addMultiHopStops(plan *model.RoutingPlan, branchID string, shipmentByTID map[string]model.Shipment, cfg model.RoutingConfig, now time.Time, skipFillRateCheck bool) {
	if s.graphSvc == nil {
		return
	}

	// Index de unassigned por tracking_id para poder removerlos cuando los reasignamos
	unassignedIdx := map[string]int{}
	for i, u := range plan.Unassigned {
		unassignedIdx[u.TrackingID] = i
	}
	removed := map[string]bool{}

	for di := range plan.InterBranch {
		dispatch := &plan.InterBranch[di]
		// Reservamos capacidad para los envíos ya cargados (existing) + los primarios
		// nuevos. Tope efectivo del vehículo (no del fill-rate).
		usedKg := dispatch.ExistingWeightKg + dispatch.TotalWeightKg

		// Construir la lista de paradas actuales: empezamos con el destino primario
		stopBranches := []string{dispatch.DestinationBranch}
		for _, s := range dispatch.AdditionalStops {
			stopBranches = append(stopBranches, s.BranchID)
		}

		// Iteramos agregando hops mientras quepa
		for len(stopBranches) < model.MaxTripStops {
			fromBranch := stopBranches[len(stopBranches)-1]

			// Buscar el mejor siguiente hop: agrupamos los envíos sin asignar por
			// el "next branch" en su camino desde fromBranch.
			candidatesByNext := map[string][]model.Shipment{} // next_branch → shipments
			for _, u := range plan.Unassigned {
				if removed[u.TrackingID] {
					continue
				}
				sh, ok := shipmentByTID[u.TrackingID]
				if !ok || sh.IsReturning {
					continue
				}
				// Solo inter-sucursal — última milla se maneja aparte
				if sh.FinalBranchID == "" || sh.FinalBranchID == branchID {
					continue
				}
				path := s.graphSvc.ShortestPath(fromBranch, sh.FinalBranchID)
				if len(path) < 2 {
					continue
				}
				nextBranch := path[1]
				// Evitar volver a una parada ya hecha
				visited := false
				for _, b := range stopBranches {
					if b == nextBranch {
						visited = true
						break
					}
				}
				if visited {
					continue
				}
				candidatesByNext[nextBranch] = append(candidatesByNext[nextBranch], sh)
			}

			// Elegir el siguiente hop con más peso (mejor utilización del vehículo)
			var bestNext string
			var bestShipments []model.Shipment
			var bestWeight float64
			for next, ships := range candidatesByNext {
				totalW := 0.0
				for _, sh := range ships {
					totalW += sh.WeightKg
				}
				if totalW > bestWeight {
					bestWeight = totalW
					bestNext = next
					bestShipments = ships
				}
			}
			if bestNext == "" {
				break // no hay más hops posibles
			}

			// Bin-pack: agregar envíos hasta llenar capacidad
			available := dispatch.CapacityKg - usedKg
			if available <= 0 {
				break
			}
			sortShipmentsForRouting(bestShipments) // priority desc
			var included []string
			var includedWeight float64
			for _, sh := range bestShipments {
				if includedWeight+sh.WeightKg > available {
					continue
				}
				included = append(included, sh.TrackingID)
				includedWeight += sh.WeightKg
			}
			if len(included) == 0 {
				break
			}

			// Consolidación del nuevo segmento: el tramo desde `fromBranch` hasta
			// `bestNext` lleva `includedWeight` kg (los envíos recién agregados;
			// todavía no hay hops posteriores que podrían sumar carga). Si esa
			// carga no llega al umbral `MinFillRate × capacidad`, no extendemos
			// la ruta — salvo que algún envío incluido esté SLA-forzado.
			includedSet := map[string]bool{}
			for _, tid := range included {
				includedSet[tid] = true
			}
			includedShipments := make([]model.Shipment, 0, len(included))
			for _, sh := range bestShipments {
				if includedSet[sh.TrackingID] {
					includedShipments = append(includedShipments, sh)
				}
			}
			// En plan global el check se omite porque addCrossBranchPickups
			// puede agregar carga suficiente DESPUÉS de este paso; en ese caso
			// enforceMinSegmentUtilization es quien poda el tramo si sigue bajo.
			if !skipFillRateCheck {
				threshold := cfg.MinFillRate * dispatch.CapacityKg
				if includedWeight < threshold && !anyForced(includedShipments, cfg, now) {
					break // tramo subutilizado y sin SLA forzado → no extender
				}
			}

			// Agregar parada adicional al despacho
			dispatch.AdditionalStops = append(dispatch.AdditionalStops, model.AssignmentStop{
				BranchID:      bestNext,
				Shipments:     included,
				TotalWeightKg: roundKg(includedWeight),
			})
			dispatch.Shipments = append(dispatch.Shipments, included...)
			dispatch.TotalWeightKg = roundKg(dispatch.TotalWeightKg + includedWeight)
			usedKg += includedWeight
			stopBranches = append(stopBranches, bestNext)

			for _, tid := range included {
				removed[tid] = true
			}
		}
	}

	// Limpiar unassigned: quitamos los envíos que ahora están en paradas multi-hop
	if len(removed) > 0 {
		filtered := plan.Unassigned[:0]
		for _, u := range plan.Unassigned {
			if !removed[u.TrackingID] {
				filtered = append(filtered, u)
			}
		}
		plan.Unassigned = filtered
	}
}

// =============================================================================
// Global-only passes
// =============================================================================

// consolidateCrossBranchDispatches absorbe dispatches single-hop (B) dentro de
// dispatches multi-hop (A) cuando A ya pasa por el origen de B y el destino de
// B está en el path remanente de A. Solo opción C: B debe quedar completamente
// vacío (todos sus envíos se mueven a A). B debe ser single-hop.
//
// SLA safety: si algún envío de B está dentro del horizonte SLA-forzado
// (isSLACriticalETA), la absorción solo procede si el ETA del envío vía la
// ruta de A no supera su EstimatedDeliveryAt. Esto evita que la espera por la
// llegada de A al origen de B rompa un SLA crítico.
func (s *RoutingService) consolidateCrossBranchDispatches(plan *model.GlobalRoutingPlan, cfg model.RoutingConfig) {
	if s.graphSvc == nil {
		return
	}
	now := clock.Now()
	avgSpeed := cfg.AvgSpeedKmh
	if avgSpeed <= 0 {
		avgSpeed = 25.0
	}

	// Índice global (branchPlanIdx, dispatchIdx) para encontrar dispatches por vehicleID
	type dispatchRef struct {
		bpIdx int
		dIdx  int
	}

	// Set de vehicleIDs que ya fueron consumidos (B absorbido)
	consumed := map[string]bool{}

	for bpA := range plan.BranchPlans {
		for dA := range plan.BranchPlans[bpA].Plan.InterBranch {
			A := &plan.BranchPlans[bpA].Plan.InterBranch[dA]
			if len(A.AdditionalStops) == 0 || consumed[A.VehicleID] {
				continue
			}
			// Path completo de A: [primary, additional[0], additional[1], ...]
			pathA := []string{A.DestinationBranch}
			for _, st := range A.AdditionalStops {
				pathA = append(pathA, st.BranchID)
			}

			// Peso por tramo de A: peso_vivo al entrar en cada segmento.
			// Empezamos con el peso completo; restamos dropoffs, sumamos pickups.
			type tramo struct {
				from      string
				to        string
				liveKgIn  float64 // peso al entrar en este tramo
				liveKgOut float64 // peso al salir (= in - dropoffs + pickups)
			}

			// Calcular pesos dropoff/pickup por parada
			additionalSet := map[string]bool{}
			for _, st := range A.AdditionalStops {
				for _, tid := range st.Shipments {
					additionalSet[tid] = true
				}
			}
			var primaryWeight float64
			for _, tid := range A.Shipments {
				if !additionalSet[tid] {
					if sh, ok := s.lookupShipment(tid); ok {
						primaryWeight += sh.WeightKg
					}
				}
			}

			tramos := make([]tramo, len(pathA))
			// Carga total al salir del origen: existing + todos los nuevos dropoffs.
			liveKg := A.ExistingWeightKg + A.TotalWeightKg
			// Tramo 0: origen → pathA[0] (primary)
			tramos[0] = tramo{from: plan.BranchPlans[bpA].BranchID, to: pathA[0], liveKgIn: liveKg}
			// Al salir de primary: drop existing + primary new + pickup primary
			liveKg = liveKg - A.ExistingWeightKg - primaryWeight + A.PrimaryPickupWeightKg
			tramos[0].liveKgOut = liveKg

			for i, st := range A.AdditionalStops {
				to := ""
				if i+1 < len(pathA) {
					to = pathA[i+1]
				}
				tramos[i+1] = tramo{from: pathA[i], to: to, liveKgIn: liveKg}
				liveKg = liveKg - st.TotalWeightKg + st.PickupWeightKg
				tramos[i+1].liveKgOut = liveKg
			}

			// Buscar B en otros BranchPlans que sean single-hop y no consumidos
			for bpB := range plan.BranchPlans {
				for dB := range plan.BranchPlans[bpB].Plan.InterBranch {
					B := plan.BranchPlans[bpB].Plan.InterBranch[dB]
					if consumed[B.VehicleID] || B.VehicleID == A.VehicleID {
						continue
					}
					if len(B.AdditionalStops) > 0 {
						continue // B debe ser single-hop
					}

					// ¿El origen de B está en alguna parada k de A?
					kMatch := -1
					for k, branchID := range pathA {
						if branchID == plan.BranchPlans[bpB].BranchID {
							kMatch = k
							break
						}
					}
					if kMatch == -1 {
						continue
					}

					// ¿El destino de B está en el path remanente de A?
					destMatch := -1
					for k := kMatch + 1; k < len(pathA); k++ {
						if pathA[k] == B.DestinationBranch {
							destMatch = k
							break
						}
					}
					if destMatch == -1 {
						continue
					}

					// ¿Cabe el peso de B en los tramos donde estará a bordo?
					// B se recoge en stop kMatch y se descarga en destMatch.
					// Está a bordo durante los tramos kMatch..destMatch-1 (peso en cada
					// tramo = tramos[t].liveKgOut).
					fits := true
					for t := kMatch; t < destMatch && t < len(tramos); t++ {
						if tramos[t].liveKgOut+B.TotalWeightKg > A.CapacityKg {
							fits = false
							break
						}
					}
					if !fits {
						continue
					}

					// SLA safety: si algún envío de B es SLA-crítico, no consolidar
					// salvo que el ETA estimado vía la ruta de A respete su deadline.
					// El envío esperaría a que A llegue al origen de B antes de salir,
					// y esa espera puede romper el SLA.
					shipmentsB := make([]model.Shipment, 0, len(B.Shipments))
					hasSLACritical := false
					for _, tid := range B.Shipments {
						sh, ok := s.lookupShipment(tid)
						if !ok {
							continue
						}
						shipmentsB = append(shipmentsB, sh)
						if isSLACriticalETA(sh, cfg, now) {
							hasSLACritical = true
						}
					}
					if hasSLACritical {
						// Distancia total desde el origen de A hasta el destino de B
						// recorriendo el path: origen → pathA[0] → ... → pathA[destMatch].
						aOrigin := plan.BranchPlans[bpA].BranchID
						totalDistKm := 0.0
						prev := aOrigin
						for k := 0; k <= destMatch; k++ {
							d := s.branchDistance(prev, pathA[k])
							if d > 0 {
								totalDistKm += d
							}
							prev = pathA[k]
						}
						// Mismo factor de detour 1.3 que usa buildDurationMatrix.
						travelHours := (totalDistKm * 1.3) / avgSpeed
						etaAtDest := now.Add(time.Duration(travelHours * float64(time.Hour)))

						slaBreaches := false
						for _, sh := range shipmentsB {
							if sh.EstimatedDeliveryAt == nil {
								continue
							}
							if etaAtDest.After(*sh.EstimatedDeliveryAt) {
								slaBreaches = true
								break
							}
						}
						if slaBreaches {
							continue
						}
					}

					// Match: mover envíos de B a A
					// Pickup en la parada kMatch (la que coincide con origen de B)
					if kMatch == 0 {
						// Primary stop: usar PrimaryPickup
						A.PrimaryPickupShipments = append(A.PrimaryPickupShipments, B.Shipments...)
						A.PrimaryPickupWeightKg = roundKg(A.PrimaryPickupWeightKg + B.TotalWeightKg)
					} else {
						// Additional stop kMatch-1 (porque AdditionalStops[0] = pathA[1])
						stIdx := kMatch - 1
						A.AdditionalStops[stIdx].PickupShipments = append(A.AdditionalStops[stIdx].PickupShipments, B.Shipments...)
						A.AdditionalStops[stIdx].PickupWeightKg = roundKg(A.AdditionalStops[stIdx].PickupWeightKg + B.TotalWeightKg)
					}
					// Dropoff en la parada destMatch (destMatch >= 1 siempre, así que
					// AdditionalStops[destMatch-1])
					stDropIdx := destMatch - 1
					A.AdditionalStops[stDropIdx].Shipments = append(A.AdditionalStops[stDropIdx].Shipments, B.Shipments...)
					A.AdditionalStops[stDropIdx].TotalWeightKg = roundKg(A.AdditionalStops[stDropIdx].TotalWeightKg + B.TotalWeightKg)
					A.Shipments = append(A.Shipments, B.Shipments...)
					A.TotalWeightKg = roundKg(A.TotalWeightKg + B.TotalWeightKg)

					// Actualizar tramos para siguiente B (peso aumenta entre kMatch y destMatch-1)
					for t := kMatch; t < destMatch && t < len(tramos); t++ {
						tramos[t].liveKgOut += B.TotalWeightKg
					}

					// Marcar B como consumido — se eliminará al final
					consumed[B.VehicleID] = true
				}
			}
		}
	}

	// Eliminar dispatches consumidos
	if len(consumed) == 0 {
		return
	}
	for bpIdx := range plan.BranchPlans {
		newDispatches := plan.BranchPlans[bpIdx].Plan.InterBranch[:0]
		for _, d := range plan.BranchPlans[bpIdx].Plan.InterBranch {
			if consumed[d.VehicleID] {
				// Devolver los envíos de B al unassigned de su branch
				for _, tid := range d.Shipments {
					sh, err := s.shipmentRepo.GetByTrackingID(tid)
					if err != nil {
						continue
					}
					dest := sh.FinalBranchID
					if sh.IsReturning {
						dest = sh.OriginBranchID
					}
					plan.BranchPlans[bpIdx].Plan.Unassigned = append(
						plan.BranchPlans[bpIdx].Plan.Unassigned,
						model.UnassignedShipment{
							TrackingID:  tid,
							Destination: dest,
							Reason:      "consolidado_en_viaje_multi_hop",
							WeightKg:    sh.WeightKg,
							Priority:    sh.Priority,
						},
					)
				}
			} else {
				newDispatches = append(newDispatches, d)
			}
		}
		plan.BranchPlans[bpIdx].Plan.InterBranch = newDispatches
	}
}

// enforceMinSegmentUtilization recorre los dispatches multi-hop del plan global
// y elimina las paradas adicionales cuyo tramo final tiene utilización <
// cfg.MinFillRate, salvo que algún envío de esa parada tenga SLA forzado.
// Los envíos de las paradas eliminadas vuelven a unassigned con motivo
// "tramo_subutilizado".
func (s *RoutingService) enforceMinSegmentUtilization(plan *model.GlobalRoutingPlan, cfg model.RoutingConfig) {
	now := clock.Now()
	for bpIdx := range plan.BranchPlans {
		for dIdx := range plan.BranchPlans[bpIdx].Plan.InterBranch {
			dispatch := &plan.BranchPlans[bpIdx].Plan.InterBranch[dIdx]
			if len(dispatch.AdditionalStops) == 0 {
				continue
			}
			if dispatch.CapacityKg <= 0 {
				continue
			}

			// Calcular peso vivo por tramo
			// Reconstruir peso primario
			additionalSet := map[string]bool{}
			for _, st := range dispatch.AdditionalStops {
				for _, tid := range st.Shipments {
					additionalSet[tid] = true
				}
			}
			var primaryWeight float64
			for _, tid := range dispatch.Shipments {
				if !additionalSet[tid] {
					if sh, ok := s.lookupShipment(tid); ok {
						primaryWeight += sh.WeightKg
					}
				}
			}

			// liveKg = peso a bordo DURANTE el tramo desde primary hacia additional[0].
			// Después de primary: drop existing + drop primary new + pickup primary.
			// Initial load = ExistingWeightKg + TotalWeightKg.
			// Después de primary: initial - ExistingWeightKg - primaryWeight + PrimaryPickupWeightKg
			//                    = TotalWeightKg - primaryWeight + PrimaryPickupWeightKg.
			liveKg := dispatch.TotalWeightKg - primaryWeight + dispatch.PrimaryPickupWeightKg

			keepUntil := len(dispatch.AdditionalStops) // mantener todo por defecto
			for i, st := range dispatch.AdditionalStops {
				// El tramo "previo a esta parada" (i.e. el segmento que va desde la
				// parada anterior HASTA esta) lleva `liveKg` (pickups en esta parada
				// no afectan al segmento previo, sino al siguiente).
				segmentLoad := liveKg
				util := segmentLoad / dispatch.CapacityKg

				if util >= cfg.MinFillRate {
					// Tramo válido: avanzar con los pesos para el siguiente segmento
					liveKg = liveKg - st.TotalWeightKg + st.PickupWeightKg
					continue
				}

				// Tramo bajo el umbral — verificar si hay SLA forzado en esta parada
				slaForced := false
				combined := append([]string(nil), st.Shipments...)
				combined = append(combined, st.PickupShipments...)
				for _, tid := range combined {
					sh, err := s.shipmentRepo.GetByTrackingID(tid)
					if err != nil {
						continue
					}
					if anyForced([]model.Shipment{sh}, cfg, now) {
						slaForced = true
						break
					}
				}
				if slaForced {
					liveKg = liveKg - st.TotalWeightKg + st.PickupWeightKg
					continue
				}

				// Eliminar desde esta parada en adelante
				keepUntil = i
				break
			}

			if keepUntil == len(dispatch.AdditionalStops) {
				continue // nada que eliminar
			}

			// Mover envíos de las paradas eliminadas a unassigned
			for i := keepUntil; i < len(dispatch.AdditionalStops); i++ {
				st := dispatch.AdditionalStops[i]
				droppedSet := map[string]bool{}
				for _, tid := range st.Shipments {
					droppedSet[tid] = true
					sh, err := s.shipmentRepo.GetByTrackingID(tid)
					if err != nil {
						continue
					}
					dest := sh.FinalBranchID
					if sh.IsReturning {
						dest = sh.OriginBranchID
					}
					plan.BranchPlans[bpIdx].Plan.Unassigned = append(
						plan.BranchPlans[bpIdx].Plan.Unassigned,
						model.UnassignedShipment{
							TrackingID:  tid,
							Destination: dest,
							Reason:      "tramo_subutilizado",
							WeightKg:    sh.WeightKg,
							Priority:    sh.Priority,
						},
					)
				}
				// Pickups (cross-branch) cancelados: vuelven a estar libres,
				// pero NO los marcamos como unassigned del branch actual — son envíos
				// de OTROS branches. Simplemente no se persisten al apply.
				dispatch.TotalWeightKg = roundKg(dispatch.TotalWeightKg - st.TotalWeightKg)
				// Limpiar shipments de dispatch.Shipments
				if len(droppedSet) > 0 {
					filtered := dispatch.Shipments[:0]
					for _, tid := range dispatch.Shipments {
						if !droppedSet[tid] {
							filtered = append(filtered, tid)
						}
					}
					dispatch.Shipments = filtered
				}
			}

			// Cortar las paradas — DestinationBranch (primary) NO cambia.
			dispatch.AdditionalStops = dispatch.AdditionalStops[:keepUntil]
		}
	}
}

// snapshotAtHubInventory devuelve los envíos disponibles para cross-branch pickup
// agrupados por sucursal (branch_id). Incluye tanto `at_hub` (envíos llegados
// desde otra sucursal) como `at_origin_hub` (recién registrados en su origen):
// para un camión multi-hop que pasa, ambos casos son levantables.
// Excluye reservados, returns, retiro_sucursal, y los que están en su sucursal final.
func (s *RoutingService) snapshotAtHubInventory() map[string][]model.Shipment {
	inventory := map[string][]model.Shipment{}
	all, err := s.shipmentRepo.List(model.ShipmentFilter{})
	if err != nil {
		return inventory
	}
	for _, sh := range all {
		if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub {
			continue
		}
		if sh.ReservedForTripID != nil {
			continue
		}
		if sh.IsReturning {
			continue
		}
		// retiro_sucursal ya en destino final: no necesita más transporte.
		// retiro_sucursal con destino en otra sucursal: sí es levantable por un multi-hop.
		if sh.FinalBranchID == "" || sh.FinalBranchID == sh.ReceivingBranchID {
			continue
		}
		inventory[sh.ReceivingBranchID] = append(inventory[sh.ReceivingBranchID], sh)
	}
	return inventory
}

// enrichDispatchesWithPickups recorre los dispatches multi-hop del BranchPlan dado
// y agrega pickups (cross-branch) en las paradas intermedias, respetando capacidad
// y un set de envíos ya "tomados" por otros dispatches durante esta misma pasada.
func (s *RoutingService) enrichDispatchesWithPickups(
	branchPlan *model.RoutingPlan,
	inventory map[string][]model.Shipment,
	taken map[string]bool,
) {
	if s.graphSvc == nil {
		return
	}
	for di := range branchPlan.InterBranch {
		dispatch := &branchPlan.InterBranch[di]
		// Solo dispatches multi-hop (con al menos una additional stop) tienen
		// "paradas intermedias" donde podemos hacer pickup. Conservador: no
		// extendemos rutas solo por pickup.
		if len(dispatch.AdditionalStops) == 0 {
			continue
		}
		// Path completo del trip: [primary, additional[0], additional[1], ...]
		fullPath := []string{dispatch.DestinationBranch}
		for _, st := range dispatch.AdditionalStops {
			fullPath = append(fullPath, st.BranchID)
		}
		// Peso ya cargado al salir del origen (existing + primary + additional dropoffs)
		usedKg := dispatch.ExistingWeightKg + dispatch.TotalWeightKg
		// Peso dropped en cada parada (para calcular capacidad disponible al pasar)
		dropoffByStop := []float64{0} // primary dropoff
		// Calcular peso del primary stop (shipments que no están en additional stops)
		additionalSet := map[string]bool{}
		for _, st := range dispatch.AdditionalStops {
			for _, tid := range st.Shipments {
				additionalSet[tid] = true
			}
		}
		var primaryWeight float64
		for _, tid := range dispatch.Shipments {
			if !additionalSet[tid] {
				if sh, ok := s.lookupShipment(tid); ok {
					primaryWeight += sh.WeightKg
				}
			}
		}
		dropoffByStop[0] = primaryWeight
		for _, st := range dispatch.AdditionalStops {
			dropoffByStop = append(dropoffByStop, st.TotalWeightKg)
		}

		// En cada parada intermedia (todas excepto la última), evaluar pickups
		// para llevar a cualquier parada posterior.
		// El "peso vivo" al llegar a la parada i es: usedKg - sum(dropoffs[0..i-1]).
		// Al salir de la parada i (después de dropoffs Y pickups): peso anterior - dropoffs[i] + pickups[i].
		liveKgAtStop := usedKg
		for i := 0; i < len(fullPath)-1; i++ {
			branchID := fullPath[i]
			// Al llegar a la parada i, descargamos dropoffs[i]
			liveKgAtStop -= dropoffByStop[i]
			// Capacidad disponible para pickup en esta parada
			available := dispatch.CapacityKg - liveKgAtStop
			if available <= 0 {
				continue
			}
			// Candidatos: envíos en branchID con destino en fullPath[i+1..]
			candidates := []model.Shipment{}
			remainingPath := map[string]bool{}
			for j := i + 1; j < len(fullPath); j++ {
				remainingPath[fullPath[j]] = true
			}
			for _, sh := range inventory[branchID] {
				if taken[sh.TrackingID] {
					continue
				}
				if !remainingPath[sh.FinalBranchID] {
					continue
				}
				candidates = append(candidates, sh)
			}
			if len(candidates) == 0 {
				continue
			}
			// Ordenar por prioridad desc y bin-pack
			sortShipmentsForRouting(candidates)
			var pickedIDs []string
			var pickedWeight float64
			for _, sh := range candidates {
				if pickedWeight+sh.WeightKg > available {
					continue
				}
				pickedIDs = append(pickedIDs, sh.TrackingID)
				pickedWeight += sh.WeightKg
				taken[sh.TrackingID] = true
			}
			if len(pickedIDs) == 0 {
				continue
			}
			// Asignar al stop correcto. Si i == 0, es el primary (no hay AdditionalStops[i-1]).
			// El "stop intermedio" donde se hace pickup es la parada i del path,
			// que es additional_stops[i-1] (porque primary está en i==0).
			if i == 0 {
				// Pickup en el primary stop: no podemos agregarlo al AssignmentStop
				// porque el primary no es uno. Saltamos (solo intermediate stops).
				// (En la práctica, primary no es "intermediate" — la mejora es pickup
				// en stop 2 con destino stop 3.)
				continue
			}
			st := &dispatch.AdditionalStops[i-1]
			st.PickupShipments = append(st.PickupShipments, pickedIDs...)
			st.PickupWeightKg = roundKg(st.PickupWeightKg + pickedWeight)
			// Sumamos al peso total del dispatch (capacidad que ocupa al salir de esta parada)
			liveKgAtStop += pickedWeight
		}
	}
}

// lookupShipment helper: busca en projection por tracking ID.
func (s *RoutingService) lookupShipment(tid string) (model.Shipment, bool) {
	sh, err := s.shipmentRepo.GetByTrackingID(tid)
	if err != nil {
		return model.Shipment{}, false
	}
	return sh, true
}

// addCrossBranchPickups (global) — recorre TODOS los branch plans y enriquece
// los dispatches multi-hop con pickups cross-branch. Usa un snapshot global y un
// lock compartido para que un envío solo sea reservado por un dispatch.
func (s *RoutingService) addCrossBranchPickups(plan *model.GlobalRoutingPlan) {
	inventory := s.snapshotAtHubInventory()
	taken := map[string]bool{}
	for bi := range plan.BranchPlans {
		s.enrichDispatchesWithPickups(&plan.BranchPlans[bi].Plan, inventory, taken)
	}
}

// addCrossBranchPickupsForBranch (local) — enriquece solo el plan de UNA sucursal
// tomando inventario de todas las demás. Útil cuando el operator regenera local.
// existingGlobal, si no es nil, pre-marca como taken los shipments que otras
// sucursales del plan del día ya tienen asignados como cross-branch pickups,
// evitando que una regeneración local sobrescriba coordinaciones inter-sucursal.
func (s *RoutingService) addCrossBranchPickupsForBranch(plan *model.RoutingPlan, branchID string, existingGlobal *model.GlobalRoutingPlan) {
	s.addCrossBranchPickupsForBranchCtx(plan, branchID, existingGlobal, nil)
}

// addCrossBranchPickupsForBranchCtx es la variante que acepta un planContext para
// obtener el inventario proyectado en días futuros.
func (s *RoutingService) addCrossBranchPickupsForBranchCtx(plan *model.RoutingPlan, branchID string, existingGlobal *model.GlobalRoutingPlan, pc *planContext) {
	var inventory map[string][]model.Shipment
	if pc != nil && pc.hubInventory != nil {
		inventory = pc.hubInventory()
	} else {
		inventory = s.snapshotAtHubInventory()
	}
	taken := map[string]bool{}
	if existingGlobal != nil {
		for _, bp := range existingGlobal.BranchPlans {
			if bp.BranchID == branchID {
				continue
			}
			for _, dispatch := range bp.Plan.InterBranch {
				for _, stop := range dispatch.AdditionalStops {
					for _, tid := range stop.Shipments {
						taken[tid] = true
					}
				}
			}
		}
	}
	s.enrichDispatchesWithPickups(plan, inventory, taken)
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
		"esperando_consolidacion":    true,
		"sin_vehiculos_para_destino": true,
		"sobrepeso_excede_vehiculo":  true,
		"sin_vehiculos_disponibles":  true,
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
	cfg := s.cfgSvc.Get()

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
		branchPlan, err := s.generatePlan(ctx, s.liveContext(br.ID, true, nil))
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

	// Cross-branch pickups: enriquecer paradas de multi-hop con envíos de
	// sucursales intermedias cuyo destino esté más adelante en el path.
	s.addCrossBranchPickups(plan)

	// Consolidación cross-branch: absorber dispatches single-hop dentro de
	// multi-hops que ya pasan por su sucursal de origen (opción C: solo si B
	// queda completamente vacío y se puede cancelar).
	s.consolidateCrossBranchDispatches(plan, cfg)

	// Utilización mínima del tramo: eliminar paradas adicionales cuyo tramo
	// no alcanza el fill_rate configurado, salvo que haya SLA forzado.
	s.enforceMinSegmentUtilization(plan, cfg)

	// Backhauling global: detectar pares de dispatches opuestos (A→B y B→A) y
	// consolidarlos en el round-trip más eficiente (mayor fill rate combinado).
	// Luego, addBackhaulReturns maneja cargo huérfano restante (sin dispatch propio).
	if cfg.BackhaulEnabled {
		now := clock.Now().UTC()
		s.matchBackhaulPairs(plan, cfg, now)
		// Backhaul oportunístico: cargo en hub sin dispatch propio desde el destino.
		inv := s.snapshotAtHubInventory()
		taken := s.takenFromBackhauls(plan)
		for bi := range plan.BranchPlans {
			bp := &plan.BranchPlans[bi]
			s.addBackhaulReturnsFiltered(&bp.Plan, bp.BranchID, inv, cfg, now, taken)
		}
	}

	// Balanceo de flota blando: evitar dejar sucursales sin vehículo.
	if cfg.KeepOneVehiclePerBranch {
		now := clock.Now().UTC()
		s.enforceFleetBalance(plan, cfg, now)
	}

	// Re-calcular el schedule inter-sucursal: los pases globales anteriores
	// (cross-branch pickups, consolidación, poda de tramos, backhaul) mutan las paradas,
	// así que el schedule calculado dentro de generatePlan quedó obsoleto.
	for i := range plan.BranchPlans {
		bp := &plan.BranchPlans[i]
		s.scheduleInterBranchAssignments(bp.Plan.InterBranch, bp.BranchID, cfg)
	}

	return plan, nil
}

// GenerateAndPersistGlobalPlan — movido a routing_projection.go como shim de GenerateAndPersistMultiDay.

// GetTodayPlan devuelve el plan global del día actual, filtrado por sucursal si el
// rol del usuario es operator o supervisor. Managers y admins ven el plan completo.
//
// Adicionalmente filtra cards de choferes que ya iniciaron su ruta del día y
// vehículos que ya están en tránsito: no aportan a la operativa actual y los
// envíos pendientes (no aplicados) se mueven a "Sin asignar" para que el
// operador pueda reasignarlos vía drag-and-drop o regenerar.
// GetHorizonPlans devuelve el horizonte de planes: hoy (con overrides runtime de GetTodayPlan)
// + N-1 pronósticos read-only, filtrados por sucursal según rol.
func (s *RoutingService) GetHorizonPlans(userRole model.Role, userBranch string) ([]*model.GlobalRoutingPlan, error) {
	local := clock.Now().In(clock.LocalTZ)
	baseDate := local.Format("2006-01-02")
	cfg := s.cfgSvc.Get()
	days := cfg.PlanningHorizonDays
	if days <= 0 {
		days = 1
	}

	raw, err := s.planRepo.GetHorizon(baseDate, days)
	if err != nil {
		return nil, err
	}

	// D=0: aplicar overrides runtime (como GetTodayPlan).
	todayPlan, err := s.GetTodayPlan(userRole, userBranch)
	if err != nil {
		return nil, err
	}

	// Reconstruir la lista con D=0 enriquecido + forecasts (sin overrides).
	result := make([]*model.GlobalRoutingPlan, 0, len(raw))
	for _, p := range raw {
		if p.HorizonOffset == 0 {
			if todayPlan != nil {
				result = append(result, todayPlan)
			}
			continue
		}
		// Pronóstico: propagar plan_date a cada BranchPlan.Plan y aplicar filtro.
		for i := range p.BranchPlans {
			p.BranchPlans[i].Plan.PlanDate = p.PlanDate
		}
		if userRole == model.RoleOperator || userRole == model.RoleSupervisor {
			if userBranch != "" {
				filtered := filterBranchPlan(p, userBranch)
				result = append(result, filtered)
			} else {
				result = append(result, p)
			}
		} else {
			result = append(result, p)
		}
	}
	return result, nil
}

// filterBranchPlan devuelve una copia del plan filtrado a una sola sucursal.
func filterBranchPlan(plan *model.GlobalRoutingPlan, branchID string) *model.GlobalRoutingPlan {
	copy := *plan
	copy.BranchPlans = nil
	for _, bp := range plan.BranchPlans {
		if bp.BranchID == branchID {
			copy.BranchPlans = []model.BranchPlan{bp}
			break
		}
	}
	return &copy
}

func (s *RoutingService) GetTodayPlan(userRole model.Role, userBranch string) (*model.GlobalRoutingPlan, error) {
	local := clock.Now().In(clock.LocalTZ)
	planDate := local.Format("2006-01-02")

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

	// Propagar plan_date a cada BranchPlan.Plan para que el frontend pueda
	// incluirla en el apply request y el backend use la fecha correcta.
	for i := range plan.BranchPlans {
		plan.BranchPlans[i].Plan.PlanDate = plan.PlanDate
	}

	// Marcar cards de chofer/vehículo en marcha como informativas (runtime-only).
	// Sus envíos pendientes (no aplicados) van a "Sin asignar" para que el
	// operador pueda reasignarlos. Los aplicados se quedan en la card.
	allVehicles := s.vehicleRepo.List()
	for i := range plan.BranchPlans {
		bp := &plan.BranchPlans[i]

		for j := range bp.Plan.LastMile {
			lm := &bp.Plan.LastMile[j]
			v, ok := s.vehicleRepo.GetByID(lm.VehicleID)
			if ok && v.Status == model.VehicleStatusInTransit {
				bp.Plan.Unassigned = append(bp.Plan.Unassigned, s.movePendingToUnassigned(lm.Shipments, lm.AppliedShipments, lastMileDestLabel, "vehiculo_en_viaje")...)
				lm.InTransit = true
				lm.Shipments = append([]string(nil), lm.AppliedShipments...)
			}
			// Enriquecer con el chofer del trip activo si existe
			if s.interBranchTripSvc != nil {
				if trip, hasTrip := s.interBranchTripSvc.repo.GetActiveByVehicle(lm.VehicleID); hasTrip && trip.DriverID != nil {
					dID := *trip.DriverID
					lm.DriverID = &dID
					if driver, err := s.authRepo.GetUserByID(dID); err == nil {
						name := driver.FirstName + " " + driver.LastName
						if name == " " {
							name = driver.Username
						}
						lm.DriverName = name
					}
				}
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
			// Usar slice no-nil para que serialice como [] y no como null en JSON.
			tids := make([]string, 0, len(v.AssignedShipments))
			tids = append(tids, v.AssignedShipments...)
			for _, tid := range tids {
				if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
					weight += sh.WeightKg
				}
			}
			cfg := s.cfgSvc.Get()
			eta := s.incomingVehicleETA(v.ID, origin, bp.BranchID, cfg, clock.Now().UTC())
			incoming = append(incoming, model.IncomingVehicle{
				VehicleID:          v.ID,
				LicensePlate:       v.LicensePlate,
				OriginBranch:       origin,
				Shipments:          tids,
				TotalWeightKg:      weight,
				CapacityKg:         v.CapacityKg,
				EstimatedArrivalAt: eta,
			})
		}
		bp.Plan.IncomingVehicles = incoming

		// Despacho proyectado: rescatar envíos varados usando vehículos en tránsito.
		cfg := s.cfgSvc.Get()
		s.tryProjectedDispatch(&bp.Plan, bp.BranchID, cfg, clock.Now().UTC())
	}

	// Recalcular insights sobre el plan con overrides runtime ya aplicados.
	// Los insights no se persisten en DB, por lo que hay que recomputarlos al leer.
	s.analyzeNetwork(plan)

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

	// Leer el plan global del día antes de generar: lo pasamos a generatePlan para
	// que los cross-branch pickups ya asignados a otras sucursales queden marcados
	// como taken y no sean reasignados por este plan local.
	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return nil, err
	}

	// Generar el plan fresco para esta sucursal con contexto del plan global existente.
	// forGlobal=true: activa el multi-hop sin restricción de fill-rate por tramo
	// (enforceMinSegmentUtilization poda los tramos subutilizados en el pase global).
	branchPlan, err := s.generatePlan(ctx, s.liveContext(branchID, true, global))
	if err != nil {
		return nil, fmt.Errorf("error generando plan para sucursal %s: %w", branchID, err)
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
	} else {
		// Si la sucursal ya había aplicado, sacarla de AppliedBranches: los envíos
		// aplicados ya transicionaron de estado, el plan regenerado trae solo los
		// envíos nuevos elegibles (bulk imports, drafts confirmados, etc.) y debe
		// poder aplicarse de nuevo.
		filtered := global.AppliedBranches[:0]
		for _, b := range global.AppliedBranches {
			if b != branchID {
				filtered = append(filtered, b)
			}
		}
		global.AppliedBranches = filtered
		// Si el plan global había quedado en applied porque todas las sucursales
		// del plan ya aplicaron, revertir a pending: ahora hay algo nuevo para aplicar.
		if global.Status == model.PlanStatusApplied {
			global.Status = model.PlanStatusPending
			global.AppliedAt = nil
			global.AppliedBy = ""
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
		tids := make([]string, 0, len(v.AssignedShipments))
		tids = append(tids, v.AssignedShipments...)
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

	// Despacho proyectado: rescatar envíos varados usando vehículos en tránsito.
	regenCfg := s.cfgSvc.Get()
	s.tryProjectedDispatch(&branchPlan, branchID, regenCfg, clock.Now().UTC())

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
	if edited.PlanDate != "" {
		planDate = edited.PlanDate
	}

	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return err
	}
	if global == nil {
		return fmt.Errorf("no hay plan generado para el %s", planDate)
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
	dbAppliedByLMVehicle := map[string][]string{}
	for _, lm := range global.BranchPlans[bpIdx].Plan.LastMile {
		dbAppliedByLMVehicle[lm.VehicleID] = lm.AppliedShipments
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
		lm.AppliedShipments = filterToCurrent(dbAppliedByLMVehicle[lm.VehicleID], lm.Shipments)
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
	// Si se envía un plan con fecha explícita, usar esa fecha para persistir timestamps.
	// Esto permite pre-aplicar el plan de mañana hoy (ej. operador a las 22hs).
	planDate := local.Format("2006-01-02")
	if edited != nil && edited.PlanDate != "" {
		planDate = edited.PlanDate
	}

	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return model.ApplyPlanResponse{}, fmt.Errorf("no se pudo leer el plan: %w", err)
	}
	if global == nil {
		return model.ApplyPlanResponse{}, fmt.Errorf("no hay plan generado para el %s", planDate)
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
	parsedPlanDate, _ := time.ParseInLocation("2006-01-02", planDate, clock.LocalTZ)
	applyPlanDate := model.NewDateOnly(parsedPlanDate)
	applyPlanCfg := s.cfgSvc.Get()

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

		// Set de pickup TIDs (cross-branch) — no se cargan al origen
		pickupSet := map[string]bool{}
		for _, tid := range asgmt.PrimaryPickupShipments {
			pickupSet[tid] = true
		}
		for _, st := range asgmt.AdditionalStops {
			for _, tid := range st.PickupShipments {
				pickupSet[tid] = true
			}
		}

		anyApplied := false
		for _, tid := range pending {
			if pickupSet[tid] {
				// Cross-branch pickup: marcamos applied sin cargar al vehículo.
				// La reserva ocurre al crear el Trip más abajo.
				items = append(items, model.ApplyResultItem{TrackingID: tid, Target: target, Status: "applied"})
				asgmt.AppliedShipments = append(asgmt.AppliedShipments, tid)
				anyApplied = true
				continue
			}
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

			// Crear Trip inter-sucursal con stops (multi-hop) si no existe ya
			// para este vehículo. Reserva los pickups cross-branch.
			if s.interBranchTripSvc != nil {
				if _, hasTrip := s.interBranchTripSvc.repo.GetActiveByVehicle(v.ID); !hasTrip {
					weight := func(tid string) float64 {
						if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
							return sh.WeightKg
						}
						return 0
					}
					appliedSet := map[string]bool{}
					for _, tid := range asgmt.AppliedShipments {
						appliedSet[tid] = true
					}
					additionalSet := map[string]bool{}
					for _, st := range asgmt.AdditionalStops {
						for _, tid := range st.Shipments {
							additionalSet[tid] = true
						}
					}
					// Primary stop
					var stops []model.TripStop
					var allShipments []string
					var totalWeight float64
					primaryShipments := []string{}
					var primaryWeight float64
					for _, tid := range asgmt.Shipments {
						if !appliedSet[tid] || additionalSet[tid] || pickupSet[tid] {
							continue
						}
						primaryShipments = append(primaryShipments, tid)
						primaryWeight += weight(tid)
					}
					if len(primaryShipments) > 0 || len(asgmt.PrimaryPickupShipments) > 0 {
						stops = append(stops, model.TripStop{
							BranchID:          asgmt.DestinationBranch,
							ShipmentIDs:       primaryShipments,
							TotalWeightKg:     roundKg(primaryWeight),
							PickupShipmentIDs: append([]string(nil), asgmt.PrimaryPickupShipments...),
							PickupWeightKg:    asgmt.PrimaryPickupWeightKg,
						})
						allShipments = append(allShipments, primaryShipments...)
						totalWeight += primaryWeight
					}
					// Additional stops
					for _, st := range asgmt.AdditionalStops {
						stopShipments := []string{}
						var stopWeight float64
						for _, tid := range st.Shipments {
							if !appliedSet[tid] || pickupSet[tid] {
								continue
							}
							stopShipments = append(stopShipments, tid)
							stopWeight += weight(tid)
						}
						if len(stopShipments) > 0 || len(st.PickupShipments) > 0 {
							stops = append(stops, model.TripStop{
								BranchID:          st.BranchID,
								ShipmentIDs:       stopShipments,
								TotalWeightKg:     roundKg(stopWeight),
								PickupShipmentIDs: append([]string(nil), st.PickupShipments...),
								PickupWeightKg:    st.PickupWeightKg,
							})
							allShipments = append(allShipments, stopShipments...)
							totalWeight += stopWeight
						}
					}
					if len(allShipments) > 0 {
						finalDest := asgmt.DestinationBranch
						if len(stops) > 0 {
							finalDest = stops[len(stops)-1].BranchID
						}
						// Propagar estimated_arrival_at a cada TripStop por branch ID
						// (las paradas se arman condicionalmente; no usar índice posicional).
						arrivalByBranch := interBranchArrivalByBranch(*asgmt)
						for idx := range stops {
							if arrMin, ok := arrivalByBranch[stops[idx].BranchID]; ok {
								t := dateAtMinute(applyPlanDate, arrMin)
								stops[idx].EstimatedArrivalAt = &t
							}
						}
						schedDep, estArr := tripScheduleFor(applyPlanDate, asgmt.EstimatedDepartureMin, asgmt.EstimatedArrivalMin)
						createdTrip, err := s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
							Kind:                 model.TripKindInterBranch,
							DriverID:             nil,
							VehicleID:            v.ID,
							LicensePlate:         v.LicensePlate,
							OriginBranchID:       branchID,
							DestinationBranchID:  &finalDest,
							ShipmentIDs:          allShipments,
							TotalWeightKg:        roundKg(totalWeight),
							Stops:                stops,
							CreatedBy:            username,
							ScheduledDepartureAt: schedDep,
							EstimatedArrivalAt:   estArr,
						})
						// Reservar pickups cross-branch
						if err == nil {
							for _, st := range stops {
								for _, tid := range st.PickupShipmentIDs {
									_ = s.shipmentRepo.ReserveForTrip(tid, createdTrip.ID)
								}
							}
						}
					}
				}
			}
		}
	}

	// --- Última milla (vehicle-centric) ---
	for i := range bp.Plan.LastMile {
		asgmt := &bp.Plan.LastMile[i]
		if vehicleID != "" && asgmt.VehicleID != vehicleID {
			continue
		}
		if driverID != "" {
			continue // last-mile no se filtra por driver (driver se auto-asigna vía QR)
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

		target := "vehicle:" + asgmt.LicensePlate
		v, ok := s.vehicleRepo.GetByID(asgmt.VehicleID)
		if !ok {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "vehiculo_no_encontrado"))
			}
			continue
		}
		if v.Status != model.VehicleStatusAvailable && v.Status != model.VehicleStatusLoading {
			for _, tid := range pending {
				items = append(items, failedItem(tid, target, "vehiculo_no_disponible"))
			}
			continue
		}

		var currentLoad float64
		for _, existingTID := range v.AssignedShipments {
			if esh, err := s.shipmentRepo.GetByTrackingID(existingTID); err == nil {
				currentLoad += esh.WeightKg
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
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub && sh.Status != model.StatusRedeliveryScheduled {
				items = append(items, failedItem(tid, target, "estado_cambio:"+string(sh.Status)))
				continue
			}
			if currentLoad+sh.WeightKg > v.CapacityKg {
				items = append(items, failedItem(tid, target, "capacidad_excedida"))
				continue
			}
			// Auto-move from Entrada to Salida if needed (US-05 CA-02)
			if s.branchZoneSvc != nil && sh.CurrentZone != nil && *sh.CurrentZone == string(model.ZoneEntrada) {
				if err := s.branchZoneSvc.MoveShipment(tid, username, branchID, "", model.ZoneSalida, model.RoleSupervisor); err != nil {
					items = append(items, failedItem(tid, target, "error_auto_mover_a_salida"))
					continue
				}
			}
			if err := s.vehicleRepo.AddShipment(v.ID, tid); err != nil {
				items = append(items, failedItem(tid, target, err.Error()))
				continue
			}
			if _, err := s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusLoaded,
				ChangedBy: username,
				Location:  branchID,
				Notes:     "Cargado en " + v.LicensePlate + " vía planificador (última milla)",
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
			asgmt.Applied = allApplied(asgmt.Shipments, asgmt.AppliedShipments)
			if asgmt.Applied {
				asgmt.AppliedAt = &now
				asgmt.AppliedBy = username
			}
			if s.interBranchTripSvc != nil {
				if _, hasTrip := s.interBranchTripSvc.repo.GetActiveByVehicle(v.ID); !hasTrip {
					appliedIDs := make([]string, 0)
					var totalWeight float64
					for _, tid := range asgmt.AppliedShipments {
						appliedIDs = append(appliedIDs, tid)
						if sh, err := s.shipmentRepo.GetByTrackingID(tid); err == nil {
							totalWeight += sh.WeightKg
						}
					}
					if len(appliedIDs) > 0 {
						var lastMileArrivalMin int
						if len(asgmt.OrderedStops) > 0 {
							last := asgmt.OrderedStops[len(asgmt.OrderedStops)-1]
							if last.ArrivalMin >= 0 {
								lastMileArrivalMin = asgmt.SuggestedDepartureMin + last.ArrivalMin + applyPlanCfg.ServiceTimeMinutes
							}
						}
						schedDep, estArr := tripScheduleFor(applyPlanDate, asgmt.SuggestedDepartureMin, lastMileArrivalMin)
						_, _ = s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
							Kind:                 model.TripKindLastMile,
							DriverID:             asgmt.DriverID,
							VehicleID:            v.ID,
							LicensePlate:         v.LicensePlate,
							OriginBranchID:       branchID,
							ShipmentIDs:          appliedIDs,
							TotalWeightKg:        totalWeight,
							CreatedBy:            username,
							ScheduledDepartureAt: schedDep,
							EstimatedArrivalAt:   estArr,
						})
					}
				}
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

	// LOGITRACK-409 CA-05: después de aplicar el plan, re-evaluar el volumen pendiente
	// de despacho para resetear pares cuyo volumen cayó por debajo del umbral.
	if s.dispatchVolumeSvc != nil && resp.AppliedCount > 0 {
		go s.dispatchVolumeSvc.CheckAfterDispatch(branchID)
	}

	return resp, nil
}

// ApplyBranchPlan aplica todos los ítems pendientes de una sucursal.
// Wrapper de conveniencia sobre ApplyPlanItems.
func (s *RoutingService) ApplyBranchPlan(ctx context.Context, branchID, username string) (model.ApplyPlanResponse, error) {
	return s.ApplyPlanItems(ctx, branchID, nil, "", "", username)
}

// RecomputeLastMileAssignment recalcula el orden de paradas y el horario de
// salida sugerido para una asignación de última milla según el modo indicado.
// No muta el plan persistido — solo devuelve la asignación recalculada para
// que el operador la revise en el modal antes de aplicar.
func (s *RoutingService) RecomputeLastMileAssignment(ctx context.Context, branchID string, req model.RecomputeLastMileRequest) (model.LastMileAssignment, error) {
	mode := req.Mode.Normalize()
	if !req.Mode.IsValid() {
		return model.LastMileAssignment{}, fmt.Errorf("modo de ruta inválido: %q", req.Mode)
	}

	vehicle, ok := s.vehicleRepo.GetByID(req.VehicleID)
	if !ok {
		return model.LastMileAssignment{}, fmt.Errorf("vehículo no encontrado: %s", req.VehicleID)
	}
	if vehicle.AssignedBranch == nil || *vehicle.AssignedBranch != branchID {
		return model.LastMileAssignment{}, fmt.Errorf("el vehículo no pertenece a la sucursal")
	}

	// Cargar los envíos solicitados.
	shipByTID := make(map[string]model.Shipment, len(req.ShipmentIDs))
	for _, tid := range req.ShipmentIDs {
		sh, err := s.shipmentRepo.GetByTrackingID(tid)
		if err != nil {
			return model.LastMileAssignment{}, fmt.Errorf("envío no encontrado: %s", tid)
		}
		shipByTID[tid] = sh
	}

	a := model.LastMileAssignment{
		VehicleID:    req.VehicleID,
		LicensePlate: vehicle.LicensePlate,
		CapacityKg:   vehicle.CapacityKg,
		Shipments:    append([]string(nil), req.ShipmentIDs...),
	}

	cfg := s.cfgSvc.Get()
	// Usar la fecha del plan para calcular el horario correcto.
	// Permite pre-calcular rutas de días futuros con ventanas horarias correctas.
	schedNow := clock.Now().UTC()
	if req.PlanDate != "" {
		if t, err := time.ParseInLocation("2006-01-02", req.PlanDate, clock.LocalTZ); err == nil {
			schedNow = t.UTC()
		}
	}
	assignments := []model.LastMileAssignment{a}
	s.scheduleLastMileAssignments(assignments, branchID, shipByTID, cfg, schedNow, mode)

	return assignments[0], nil
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

	// Marcar como applied los envíos de vehículos de última milla que estaban en el plan aplicado.
	appliedLMVehicleShipments := map[string][]string{} // vehicleID → []trackingID
	for _, lm := range applied.LastMile {
		appliedLMVehicleShipments[lm.VehicleID] = lm.Shipments
	}
	for i := range bp.Plan.LastMile {
		lm := &bp.Plan.LastMile[i]
		tids, ok := appliedLMVehicleShipments[lm.VehicleID]
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
	capHint := end - firstHour + 2
	if capHint < 0 {
		capHint = 0
	}
	out := make([]float64, 0, capHint)
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

// copyMatrix returns a deep copy of a square float64 matrix.
func copyMatrix(m [][]float64) [][]float64 {
	out := make([][]float64, len(m))
	for i, row := range m {
		out[i] = make([]float64, len(row))
		copy(out[i], row)
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
//  1. mayor cobertura de ventana
//  2. menor tiempo de espera total (desempate)
//  3. salida más temprana (desempate final)
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

// findCostOptimalDeparture implements the "costo" routing mode:
//  1. Runs VRP once with EnforceTimeWindows=false to get the min-distance stop order.
//  2. Keeps that order fixed and probes candidate departure hours, recomputing
//     per-stop window compliance. Picks the departure that maximises in-window coverage
//     (ties broken by least early-arrival wait, then earliest departure).
//
// Unlike findBestDepartureForRoute, the stop order does NOT change between probes.
// Stops that end up outside their window are included with WithinWindow=false so the
// operator can review them in the modal.
func (s *RoutingService) findCostOptimalDeparture(
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

	// NN+2-opt es heurístico — no encuentra el óptimo global. Diferentes
	// "starting contexts" (departure, restricciones de ventana) llevan a
	// diferentes óptimos locales. Para encontrar la ruta de mínima distancia
	// real, exploramos varios candidatos y nos quedamos con el de menor
	// distancia. Como costo NO impone ventanas, cualquier ruta válida en otro
	// contexto sigue siendo válida para costo.
	flexDeliveries := make([]vrp.Node, len(subDeliveries))
	for i, d := range subDeliveries {
		flexDeliveries[i] = d
		flexDeliveries[i].TimeWindow = model.TimeWindowFlexible
	}

	makeProblem := func(deps []vrp.Node, dep float64) vrp.Problem {
		return vrp.Problem{
			Depot:                   vrp.Node{ID: "depot", Coord: depotCoord},
			Deliveries:              deps,
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
			EnforceTimeWindows:      false,
			PackingStrategy:         cfg.LastMilePackingStrategy,
		}
	}

	// Candidatos a evaluar:
	//   - 1 con ventanas flexibles a morningStart (NN+2-opt sin restricciones)
	//   - N con ventanas reales en cada hora candidata (mismo set que ventanas)
	var fixedRoute vrp.Route
	bestDistance := -1.0
	tryRoute := func(p vrp.Problem) {
		sol := vrp.Solve(p)
		if len(sol.Routes) == 0 || len(sol.Routes[0].Stops) == 0 {
			return
		}
		r := sol.Routes[0]
		if bestDistance < 0 || r.TotalDistanceKm < bestDistance {
			bestDistance = r.TotalDistanceKm
			fixedRoute = r
		}
	}

	tryRoute(makeProblem(flexDeliveries, morningStartMin))
	for _, dep := range candidateDepartures(cfg, nowMin) {
		tryRoute(makeProblem(subDeliveries, dep))
	}

	if bestDistance < 0 {
		return 0, vrp.Route{}, 0
	}

	// Build NodeID → TimeWindow lookup.
	twByID := make(map[string]model.TimeWindow, len(subDeliveries))
	for _, d := range subDeliveries {
		twByID[d.ID] = d.TimeWindow
	}

	morningEndMin := float64(cfg.MorningWindowEndHour) * 60
	afternoonStartMin := float64(cfg.AfternoonWindowStartHour) * 60
	afternoonEndMin := float64(cfg.AfternoonWindowEndHour) * 60

	type result struct {
		dep      float64
		route    vrp.Route
		coverage float64
		wait     float64
	}
	var best *result

	candidates := candidateDepartures(cfg, nowMin)
	for _, dep := range candidates {
		inWindow := 0
		totalWait := 0.0
		updatedStops := make([]vrp.Stop, len(fixedRoute.Stops))
		for i, st := range fixedRoute.Stops {
			tw := twByID[st.NodeID]
			abs := dep + st.ArrivalMin
			outside, dev := costWindowCheck(tw, abs, morningStartMin, morningEndMin, afternoonStartMin, afternoonEndMin)
			if !outside {
				inWindow++
			} else if dev < 0 { // arrived early → real wait until window opens
				totalWait += -dev
			}
			updatedStops[i] = vrp.Stop{
				NodeID:             st.NodeID,
				ArrivalMin:         st.ArrivalMin,
				OutOfWindow:        outside,
				WindowDeviationMin: dev,
			}
		}
		cov := float64(inWindow) / float64(len(fixedRoute.Stops))
		r := vrp.Route{
			DriverID:         fixedRoute.DriverID,
			Stops:            updatedStops,
			TotalDurationMin: fixedRoute.TotalDurationMin,
			TotalDistanceKm:  fixedRoute.TotalDistanceKm,
		}
		c := &result{dep: dep, route: r, coverage: cov, wait: totalWait}
		if best == nil ||
			c.coverage > best.coverage ||
			(c.coverage == best.coverage && c.wait < best.wait) ||
			(c.coverage == best.coverage && c.wait == best.wait && c.dep < best.dep) {
			best = c
		}
	}
	if best == nil {
		return 0, vrp.Route{}, 0
	}
	return best.dep, best.route, best.coverage
}

// costWindowCheck returns (outside, deviationMin) for the cost-mode window simulation.
// deviationMin > 0 = late, < 0 = early. Flexible windows are always in-window.
func costWindowCheck(tw model.TimeWindow, absArrMin, mStart, mEnd, aStart, aEnd float64) (outside bool, devMin float64) {
	switch tw {
	case model.TimeWindowMorning:
		if absArrMin < mStart {
			return true, absArrMin - mStart
		}
		if absArrMin > mEnd {
			return true, absArrMin - mEnd
		}
	case model.TimeWindowAfternoon:
		if absArrMin < aStart {
			return true, absArrMin - aStart
		}
		if absArrMin > aEnd {
			return true, absArrMin - aEnd
		}
	}
	return false, 0
}

// runStaleReplan re-evaluates shipments stuck at a branch beyond staleHours.
// Returns (replanned, stuck) counts. WIP — graphSvc must be set via SetBranchGraphService.
func (s *RoutingService) runStaleReplan(branchID string, staleHours int) (int, int) {
	if staleHours <= 0 || s.graphSvc == nil || s.shipmentRepo == nil {
		return 0, 0
	}
	cutoff := clock.Now().UTC().Add(-time.Duration(staleHours) * time.Hour)
	all, err := s.shipmentRepo.List(model.ShipmentFilter{ReceivingBranchID: branchID})
	if err != nil {
		return 0, 0
	}
	replanned, stuck := 0, 0
	for _, sh := range all {
		if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub {
			continue
		}
		if !sh.UpdatedAt.Before(cutoff) {
			continue
		}
		if sh.NextHopBranchID == "" {
			continue
		}
		path := s.graphSvc.ShortestPath(branchID, sh.FinalBranchID)
		if len(path) < 2 {
			stuck++
			continue
		}
		revision := sh.PathRevision + 1
		_ = s.shipmentRepo.RecordPathPlanned(repository.PathPlannedCmd{
			TrackingID:      sh.TrackingID,
			PlannedPath:     path,
			NextHopBranchID: path[1],
			HopIndex:        0,
			PathRevision:    revision,
			Reason:          "stale_replan",
		})
		replanned++
	}
	return replanned, stuck
}

// SetBranchGraphService injects the graph service (needed for stale-replan).
func (s *RoutingService) SetBranchGraphService(g *BranchGraphService) {
	s.graphSvc = g
}

// matchBackhaulPairs detecta pares de dispatches opuestos (A→B y B→A) en el plan
// global y los consolida en el round-trip más eficiente: el vehiculo del branch con
// mayor fill rate combinado (outbound + return / 2×capacity) hace el round-trip; el
// dispatch del otro branch se disuelve y su carga queda como backhaul stop del ganador.
//
// Esto resuelve el problema de doble-conteo: dos dispatches que comparten la misma
// carga en direcciones opuestas → un solo vehículo cubre ambas.
func (s *RoutingService) matchBackhaulPairs(plan *model.GlobalRoutingPlan, cfg model.RoutingConfig, now time.Time) {
	// Índice: (branchID, destBranch) → lista de dispatch índices en el BranchPlan.
	type dispatchKey struct{ origin, dest string }
	type planIdx struct{ bpIdx, ibIdx int }
	index := map[dispatchKey][]planIdx{}

	for bpIdx, bp := range plan.BranchPlans {
		for ibIdx, ib := range bp.Plan.InterBranch {
			if ib.Applied || ib.InTransit {
				continue
			}
			// Última parada = destino efectivo del viaje.
			lastStop := ib.DestinationBranch
			if len(ib.AdditionalStops) > 0 {
				lastStop = ib.AdditionalStops[len(ib.AdditionalStops)-1].BranchID
			}
			if lastStop == bp.BranchID {
				continue // ya es round-trip
			}
			index[dispatchKey{bp.BranchID, lastStop}] = append(
				index[dispatchKey{bp.BranchID, lastStop}],
				planIdx{bpIdx, ibIdx},
			)
		}
	}

	dissolved := map[string]bool{} // vehicleID de dispatches ya disueltos

	for bpIdx, bp := range plan.BranchPlans {
		for ibIdx, ib := range bp.Plan.InterBranch {
			if dissolved[ib.VehicleID] || ib.Applied || ib.InTransit {
				continue
			}
			if ib.Backhaul != nil {
				continue // ya tiene backhaul
			}
			lastStop := ib.DestinationBranch
			if len(ib.AdditionalStops) > 0 {
				lastStop = ib.AdditionalStops[len(ib.AdditionalStops)-1].BranchID
			}
			if lastStop == bp.BranchID {
				continue
			}

			// Buscar dispatch opuesto: lastStop → bp.BranchID
			opposites := index[dispatchKey{lastStop, bp.BranchID}]
			if len(opposites) == 0 {
				continue
			}

			// Tomar el primero válido del opuesto.
			var opp *planIdx
			for i := range opposites {
				o := &opposites[i]
				oppIB := plan.BranchPlans[o.bpIdx].Plan.InterBranch[o.ibIdx]
				if dissolved[oppIB.VehicleID] || oppIB.Applied || oppIB.InTransit || oppIB.Backhaul != nil {
					continue
				}
				opp = o
				break
			}
			if opp == nil {
				continue
			}

			oppBP := &plan.BranchPlans[opp.bpIdx]
			oppIB := &oppBP.Plan.InterBranch[opp.ibIdx]

			// Evaluar eficiencia combinada de cada opción.
			// Score = (outbound_kg + return_kg) / (2 × vehicle_capacity)
			scoreA := (ib.TotalWeightKg + oppIB.TotalWeightKg) / (2 * ib.CapacityKg)
			scoreB := (oppIB.TotalWeightKg + ib.TotalWeightKg) / (2 * oppIB.CapacityKg)

			var winner, loser *model.InterBranchAssignment
			var winnerBP, loserBP *model.BranchPlan
			var loserIdx int

			if scoreA >= scoreB {
				// Ganador: el dispatch actual (A→B); Perdedor: el opuesto (B→A)
				winnerBP = &plan.BranchPlans[bpIdx]
				winner = &winnerBP.Plan.InterBranch[ibIdx]
				loserBP = oppBP
				loserIdx = opp.ibIdx
				loser = oppIB
			} else {
				// Ganador: el opuesto (B→A); Perdedor: el actual (A→B)
				winnerBP = oppBP
				winner = oppIB
				loserBP = &plan.BranchPlans[bpIdx]
				loserIdx = ibIdx
				loser = &loserBP.Plan.InterBranch[ibIdx]
			}

			// Verificar que el ganador tiene capacidad para el retorno.
			if winner.CapacityKg < loser.TotalWeightKg {
				continue // no cabe, no se puede hacer el round-trip
			}

			// Verificar que el MaxTripStops no se excede.
			if len(winner.AdditionalStops) >= model.MaxTripStops-1 {
				continue
			}

			// Obtener los TIDs de la carga del perdedor (serán backhaul del ganador).
			backhaulTIDs := append([]string(nil), loser.Shipments...)
			backhaulKg := loser.TotalWeightKg

			// Estructura de paradas para el round-trip A→lastStop→A:
			//
			//   - En lastStop (Posadas): la carga se LEVANTA (PickupShipments).
			//     Si el winner es un viaje simple A→B, los pickups van en
			//     PrimaryPickupShipments. Si ya tiene additional stops, los pickups
			//     van en el PickupShipments del último additional stop.
			//
			//   - Nueva parada final (winnerBP.BranchID = Mendoza): la carga
			//     se ENTREGA (Shipments / dropoff). Sin PickupShipments.
			//
			// Esto corrige el bug "por recoger en MEND-01": antes poníamos
			// PickupShipments en la parada de entrega (Mendoza) cuando debían
			// estar en la parada de recogida (Posadas).

			if len(winner.AdditionalStops) == 0 {
				// Viaje simple A→B: los pickups de backhaul se levantan en B (primary).
				winner.PrimaryPickupShipments = append(winner.PrimaryPickupShipments, backhaulTIDs...)
				winner.PrimaryPickupWeightKg = roundKg(winner.PrimaryPickupWeightKg + backhaulKg)
			} else {
				// Multi-hop A→…→C: los pickups se levantan en C (última parada).
				lastIdx := len(winner.AdditionalStops) - 1
				winner.AdditionalStops[lastIdx].PickupShipments = append(
					winner.AdditionalStops[lastIdx].PickupShipments, backhaulTIDs...)
				winner.AdditionalStops[lastIdx].PickupWeightKg = roundKg(
					winner.AdditionalStops[lastIdx].PickupWeightKg + backhaulKg)
			}

			// Nueva parada final = origen del ganador: solo dropoffs, sin pickups.
			winner.AdditionalStops = append(winner.AdditionalStops, model.AssignmentStop{
				BranchID:      winnerBP.BranchID,
				Shipments:     backhaulTIDs,
				TotalWeightKg: roundKg(backhaulKg),
			})
			winner.Shipments = append(winner.Shipments, backhaulTIDs...)
			winner.TotalWeightKg = roundKg(winner.TotalWeightKg + backhaulKg)
			winner.Backhaul = &model.BackhaulPlan{
				Shipments:     backhaulTIDs,
				TotalWeightKg: roundKg(backhaulKg),
				FillRatePct:   roundKg(backhaulKg / winner.CapacityKg * 100),
			}

			// Disolver el dispatch del perdedor: sus envíos ya están en el round-trip.
			// Los marcamos como taken; se elimina el dispatch del plan del perdedor.
			dissolved[loser.VehicleID] = true
			loserBP.Plan.InterBranch = append(
				loserBP.Plan.InterBranch[:loserIdx],
				loserBP.Plan.InterBranch[loserIdx+1:]...,
			)

			log.Printf("[backhaul] round-trip consolidado: %s→%s→%s (%.0fkg+%.0fkg, score=%.2f)",
				winnerBP.BranchID, lastStop, winnerBP.BranchID,
				winner.TotalWeightKg-backhaulKg, backhaulKg, max64(scoreA, scoreB))
		}
	}
}

// takenFromBackhauls devuelve el set de TIDs ya asignados como backhaul en el plan.
func (s *RoutingService) takenFromBackhauls(plan *model.GlobalRoutingPlan) map[string]bool {
	taken := map[string]bool{}
	for _, bp := range plan.BranchPlans {
		for _, ib := range bp.Plan.InterBranch {
			if ib.Backhaul != nil {
				for _, tid := range ib.Backhaul.Shipments {
					taken[tid] = true
				}
			}
		}
	}
	return taken
}

// addBackhaulReturnsFiltered es la variante de addBackhaulReturns que excluye TIDs
// ya asignados como backhaul en otros dispatches (evita doble-conteo).
func (s *RoutingService) addBackhaulReturnsFiltered(
	plan *model.RoutingPlan,
	originBranch string,
	inventory map[string][]model.Shipment,
	cfg model.RoutingConfig,
	now time.Time,
	taken map[string]bool,
) {
	if s.graphSvc == nil {
		return
	}

	pool, _ := s.filterAvailableVehiclesForMode(originBranch, model.VehicleModeInterBranch)
	refCap := largestCapacity(pool)

	for i := range plan.InterBranch {
		ib := &plan.InterBranch[i]
		if ib.Backhaul != nil {
			continue // ya tiene backhaul (matchBackhaulPairs lo armó)
		}

		lastStop := ib.DestinationBranch
		if len(ib.AdditionalStops) > 0 {
			lastStop = ib.AdditionalStops[len(ib.AdditionalStops)-1].BranchID
		}
		if lastStop == originBranch {
			continue
		}
		if len(ib.AdditionalStops) >= model.MaxTripStops-1 {
			continue
		}

		candidates := []model.Shipment{}
		for _, sh := range inventory[lastStop] {
			if taken[sh.TrackingID] {
				continue // ya asignado como backhaul en otro dispatch
			}
			if sh.ReservedForTripID != nil || sh.IsReturning {
				continue
			}
			if sh.FinalBranchID == originBranch {
				candidates = append(candidates, sh)
				continue
			}
			path := s.graphSvc.ShortestPath(lastStop, sh.FinalBranchID)
			for _, hop := range path {
				if hop == originBranch {
					candidates = append(candidates, sh)
					break
				}
			}
		}

		if len(candidates) == 0 {
			continue
		}

		sortShipmentsForRouting(candidates)
		var picked []model.Shipment
		var totalKg float64
		for _, sh := range candidates {
			if totalKg+sh.WeightKg <= ib.CapacityKg {
				picked = append(picked, sh)
				totalKg += sh.WeightKg
			}
		}
		if len(picked) == 0 {
			continue
		}

		forced := anyForced(picked, cfg, now)
		meetsMinFill := refCap > 0 && totalKg >= cfg.MinFillInterBranchRate*refCap
		if !forced && !meetsMinFill {
			continue
		}

		tids := make([]string, len(picked))
		for j, sh := range picked {
			tids[j] = sh.TrackingID
			taken[sh.TrackingID] = true
		}
		// Pickups: se levantan en la última parada del viaje (lastStop).
		if len(ib.AdditionalStops) == 0 {
			ib.PrimaryPickupShipments = append(ib.PrimaryPickupShipments, tids...)
			ib.PrimaryPickupWeightKg = roundKg(ib.PrimaryPickupWeightKg + totalKg)
		} else {
			lastIdx := len(ib.AdditionalStops) - 1
			ib.AdditionalStops[lastIdx].PickupShipments = append(ib.AdditionalStops[lastIdx].PickupShipments, tids...)
			ib.AdditionalStops[lastIdx].PickupWeightKg = roundKg(ib.AdditionalStops[lastIdx].PickupWeightKg + totalKg)
		}
		// Nueva parada final = origen: solo dropoffs.
		ib.AdditionalStops = append(ib.AdditionalStops, model.AssignmentStop{
			BranchID:      originBranch,
			Shipments:     tids,
			TotalWeightKg: roundKg(totalKg),
		})
		ib.Shipments = append(ib.Shipments, tids...)
		ib.TotalWeightKg = roundKg(ib.TotalWeightKg + totalKg)
		ib.Backhaul = &model.BackhaulPlan{
			Shipments:     tids,
			TotalWeightKg: roundKg(totalKg),
			FillRatePct:   roundKg(totalKg / ib.CapacityKg * 100),
		}
	}
}

func max64(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// addBackhaulReturns evalúa cada despacho inter-sucursal del plan y, si en su destino
// final (la última parada) hay carga que debe volver hacia el origen (branchID) y esa
// carga justifica el retorno (min_fill o SLA), agrega el origen como stop final y la
// carga como pickup en el destino + dropoff en el origen.
// El dispatch pasa de A→…→B a A→…→B→A (round-trip).
// Reutiliza la maquinaria de AdditionalStops + PickupShipmentIDs de cross-branch.
func (s *RoutingService) addBackhaulReturns(
	plan *model.RoutingPlan,
	originBranch string,
	inventory map[string][]model.Shipment, // inventario at_hub por sucursal
	cfg model.RoutingConfig,
	now time.Time,
) {
	if s.graphSvc == nil {
		return
	}

	// Capacidad del pool inter-sucursal para calcular el fill-rate del retorno.
	pool, _ := s.filterAvailableVehiclesForMode(originBranch, model.VehicleModeInterBranch)
	refCap := largestCapacity(pool)

	for i := range plan.InterBranch {
		ib := &plan.InterBranch[i]

		// Última parada del dispatch (destino final del viaje de ida).
		lastStop := ib.DestinationBranch
		if len(ib.AdditionalStops) > 0 {
			lastStop = ib.AdditionalStops[len(ib.AdditionalStops)-1].BranchID
		}

		// No armar retorno si la última parada ya es el origen (ya es round-trip),
		// si coincide con el origen (dispatch degenerado), o si el máx de paradas está lleno.
		if lastStop == originBranch {
			continue
		}
		if len(ib.AdditionalStops) >= model.MaxTripStops-1 {
			// Ya tiene el máximo de paradas adicionales posibles; agregar el retorno
			// excedería MaxTripStops. Saltar.
			continue
		}

		// Candidatos de retorno: envíos en la última parada (lastStop) cuyo camino
		// más corto hacia su destino final pasa por el origen (A).
		candidates := []model.Shipment{}
		for _, sh := range inventory[lastStop] {
			if sh.ReservedForTripID != nil {
				continue
			}
			if sh.IsReturning {
				continue
			}
			// El envío debe "volver hacia" originBranch: A está en su shortest-path.
			if sh.FinalBranchID == originBranch {
				candidates = append(candidates, sh)
				continue
			}
			path := s.graphSvc.ShortestPath(lastStop, sh.FinalBranchID)
			for _, hop := range path {
				if hop == originBranch {
					candidates = append(candidates, sh)
					break
				}
			}
		}

		if len(candidates) == 0 {
			continue
		}

		// Bin-pack por prioridad hasta la capacidad del vehículo.
		sortShipmentsForRouting(candidates)
		var picked []model.Shipment
		var totalKg float64
		for _, sh := range candidates {
			if totalKg+sh.WeightKg <= ib.CapacityKg {
				picked = append(picked, sh)
				totalKg += sh.WeightKg
			}
		}
		if len(picked) == 0 {
			continue
		}

		// Verificar si el retorno se justifica: min_fill_inter_branch_rate o SLA.
		forced := anyForced(picked, cfg, now)
		meetsMinFill := refCap > 0 && totalKg >= cfg.MinFillInterBranchRate*refCap
		if !forced && !meetsMinFill {
			continue
		}

		// Armar el stop de retorno: el origen (A) es la nueva última parada.
		// Los envíos son dropoffs en A (ShipmentIDs) y pickups en lastStop (PickupShipmentIDs).
		tids := make([]string, len(picked))
		for j, sh := range picked {
			tids[j] = sh.TrackingID
		}
		ib.AdditionalStops = append(ib.AdditionalStops, model.AssignmentStop{
			BranchID:        originBranch,
			Shipments:       tids,
			TotalWeightKg:   roundKg(totalKg),
			PickupShipments: tids, // se levantan en lastStop y se entregan/transfieren en A
			PickupWeightKg:  roundKg(totalKg),
		})

		// Agregar los tracking IDs al listado global de envíos del dispatch.
		ib.Shipments = append(ib.Shipments, tids...)
		ib.TotalWeightKg = roundKg(ib.TotalWeightKg + totalKg)

		// Registrar en Backhaul (metadata visible en frontend).
		ib.Backhaul = &model.BackhaulPlan{
			Shipments:     tids,
			TotalWeightKg: roundKg(totalKg),
			FillRatePct:   roundKg(totalKg / ib.CapacityKg * 100),
		}
	}
}

// largestCapacity devuelve la capacidad del vehículo más grande del pool.
func largestCapacity(pool []model.Vehicle) float64 {
	var max float64
	for _, v := range pool {
		if v.CapacityKg > max {
			max = v.CapacityKg
		}
	}
	return max
}

// enforceFleetBalance implementa el balanceo de flota blando: si un dispatch one-way
// vaciaría una sucursal de vehículos (presentes + inbound) y no está forzado por SLA,
// retiene el despacho de menor prioridad y lo mueve a unassigned con motivo específico.
func (s *RoutingService) enforceFleetBalance(plan *model.GlobalRoutingPlan, cfg model.RoutingConfig, now time.Time) {
	// Construir mapa: sucursal → conteo de vehículos presentes + inbound después del plan.
	// Se cuentan: vehículos disponibles ahora en la sucursal menos los que salen en despachos
	// one-way, más los que retornan vía round-trip + los en tránsito inbound.
	type branchVehicleCount struct {
		present   int // vehículos en la sucursal ahora mismo
		outgoing  int // despachos one-way que salen de la sucursal
		returning int // round-trips + inbound
	}
	counts := map[string]*branchVehicleCount{}

	ensureBranch := func(b string) {
		if _, ok := counts[b]; !ok {
			counts[b] = &branchVehicleCount{}
		}
	}

	// Contar vehículos presentes por sucursal (disponibles + en_carga).
	allVehicles := s.vehicleRepo.List()
	for _, v := range allVehicles {
		if v.Status == model.VehicleStatusInactive || v.Status == model.VehicleStatusInMaintenance {
			continue
		}
		if v.AssignedBranch == nil {
			continue
		}
		ensureBranch(*v.AssignedBranch)
		if v.Status == model.VehicleStatusAvailable || v.Status == model.VehicleStatusLoading {
			counts[*v.AssignedBranch].present++
		} else if v.Status == model.VehicleStatusInTransit && v.DestinationBranch != nil {
			ensureBranch(*v.DestinationBranch)
			counts[*v.DestinationBranch].returning++
		}
	}

	// Recorrer los dispatches: one-way → outgoing del origen; round-trip → returning al origen.
	for _, bp := range plan.BranchPlans {
		for _, ib := range bp.Plan.InterBranch {
			lastStop := ib.DestinationBranch
			if len(ib.AdditionalStops) > 0 {
				lastStop = ib.AdditionalStops[len(ib.AdditionalStops)-1].BranchID
			}
			ensureBranch(bp.BranchID)
			if lastStop == bp.BranchID {
				// Round-trip: el vehículo vuelve al origen → no reduce la flota del origen.
				counts[bp.BranchID].returning++
			} else {
				// One-way: el vehículo sale y no vuelve → reduce la flota del origen.
				counts[bp.BranchID].outgoing++
			}
		}
	}

	// Para cada sucursal que quedaría con 0 vehículos, retener el dispatch one-way
	// de menor prioridad (sin SLA).
	for _, bp := range plan.BranchPlans {
		cnt := counts[bp.BranchID]
		if cnt == nil {
			continue
		}
		// Vehículos efectivos tras el plan: present - outgoing + returning.
		effective := cnt.present - cnt.outgoing + cnt.returning
		if effective > 0 {
			continue
		}

		// Sucursal quedaría sin vehículos. Buscar el dispatch one-way de menor prioridad
		// (el que no sea SLA-forzado y que sea one-way).
		retainIdx := -1
		for i, ib := range bp.Plan.InterBranch {
			lastStop := ib.DestinationBranch
			if len(ib.AdditionalStops) > 0 {
				lastStop = ib.AdditionalStops[len(ib.AdditionalStops)-1].BranchID
			}
			if lastStop == bp.BranchID {
				continue // es round-trip, no retener
			}
			if ib.Rule == model.DispatchRuleSLA {
				continue // SLA-forzado, no retener
			}
			// Elegir el de menor prioridad (consolidacion < manual)
			if retainIdx == -1 || (ib.Rule == model.DispatchRuleConsolidation &&
				bp.Plan.InterBranch[retainIdx].Rule != model.DispatchRuleConsolidation) {
				retainIdx = i
			}
		}

		if retainIdx == -1 {
			continue // todos son SLA o round-trips, no podemos retener nada
		}

		// Mover los envíos del dispatch retenido a unassigned.
		retained := &bp.Plan.InterBranch[retainIdx]
		for _, tid := range retained.Shipments {
			sh, err := s.shipmentRepo.GetByTrackingID(tid)
			if err != nil {
				continue
			}
			bp.Plan.Unassigned = append(bp.Plan.Unassigned, model.UnassignedShipment{
				TrackingID:  tid,
				Destination: sh.FinalBranchID,
				Reason:      "reteniendo_ultimo_vehiculo_sucursal",
				WeightKg:    sh.WeightKg,
				Priority:    sh.Priority,
			})
		}
		// Eliminar el dispatch retenido.
		plan.BranchPlans[func() int {
			for i := range plan.BranchPlans {
				if plan.BranchPlans[i].BranchID == bp.BranchID {
					return i
				}
			}
			return 0
		}()].Plan.InterBranch = append(
			bp.Plan.InterBranch[:retainIdx],
			bp.Plan.InterBranch[retainIdx+1:]...,
		)
		// Actualizar el conteo para que iteraciones siguientes sean consistentes.
		counts[bp.BranchID].outgoing--
	}
}

// matchBackhauls is a WIP feature: attempts to fill empty return capacity with backhaul shipments.
func (s *RoutingService) matchBackhauls(plan *model.RoutingPlan, branchID string) {
	for i := range plan.InterBranch {
		ib := &plan.InterBranch[i]
		available := ib.CapacityKg
		if available <= 0 {
			continue
		}
		candidates, _ := s.shipmentRepo.List(model.ShipmentFilter{ReceivingBranchID: ib.DestinationBranch})
		var picked []string
		var total float64
		for _, sh := range candidates {
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusAtOriginHub {
				continue
			}
			if sh.NextHopBranchID != branchID {
				continue
			}
			if total+sh.WeightKg > available {
				continue
			}
			picked = append(picked, sh.TrackingID)
			total += sh.WeightKg
		}
		if len(picked) > 0 {
			ib.Backhaul = &model.BackhaulPlan{
				Shipments:     picked,
				TotalWeightKg: total,
				FillRatePct:   (total / available) * 100,
			}
		}
	}
}

// incomingVehicleETA devuelve la ETA estimada de un vehículo en tránsito hacia branchID.
// Prioriza el EstimatedArrivalAt del viaje activo; si no existe, estima con distancia/velocidad.
func (s *RoutingService) incomingVehicleETA(vehicleID, originBranch, destBranch string, cfg model.RoutingConfig, now time.Time) *time.Time {
	// 1) Viaje activo con ETA ya calculada
	if s.interBranchTripSvc != nil {
		if trip, ok := s.interBranchTripSvc.repo.GetActiveByVehicle(vehicleID); ok {
			if trip.EstimatedArrivalAt != nil {
				return trip.EstimatedArrivalAt
			}
			// El trip existe pero sin ETA: verificar paradas
			for _, stop := range trip.Stops {
				if stop.BranchID == destBranch && stop.EstimatedArrivalAt != nil {
					return stop.EstimatedArrivalAt
				}
			}
		}
	}
	// 2) Fallback: estimar por distancia origen→destino
	distKm := s.branchDistance(originBranch, destBranch)
	if distKm <= 0 {
		return nil
	}
	speed := cfg.InterBranchAvgSpeedKmh
	if speed <= 0 {
		speed = 60
	}
	hours := (distKm * 1.3) / speed
	eta := now.Add(time.Duration(hours * float64(time.Hour)))
	return &eta
}

// tryProjectedDispatch usa vehículos en tránsito hacia la sucursal para rescatar
// envíos varados por motivos sin_vehiculos_*. Solo actúa cuando FleetProjectionHorizonHours > 0
// y la ETA del vehículo entrante cae dentro de ese horizonte.
// Debe llamarse DESPUÉS de poblar plan.IncomingVehicles.
func (s *RoutingService) tryProjectedDispatch(plan *model.RoutingPlan, branchID string, cfg model.RoutingConfig, now time.Time) {
	if cfg.FleetProjectionHorizonHours <= 0 || len(plan.IncomingVehicles) == 0 {
		return
	}
	horizon := now.Add(time.Duration(cfg.FleetProjectionHorizonHours) * time.Hour)

	rescuableReasons := map[string]bool{
		"sin_vehiculos_disponibles":  true,
		"sin_vehiculos_para_destino": true,
	}

	// Agrupar envíos varados por destino (re-leer desde el plan actual)
	varadosByDest := map[string][]model.UnassignedShipment{}
	for _, u := range plan.Unassigned {
		if rescuableReasons[u.Reason] {
			varadosByDest[u.Destination] = append(varadosByDest[u.Destination], u)
		}
	}
	if len(varadosByDest) == 0 {
		log.Printf("[projected-dispatch] no rescuable unassigned items")
		return
	}

	usedVehicles := map[string]bool{}
	for _, incoming := range plan.IncomingVehicles {
		// Usar ETA ya calculada si está disponible (ej. tests o trips con ETA known).
		var eta *time.Time
		if incoming.EstimatedArrivalAt != nil {
			eta = incoming.EstimatedArrivalAt
		} else {
			eta = s.incomingVehicleETA(incoming.VehicleID, incoming.OriginBranch, branchID, cfg, now)
		}
		if eta == nil || eta.After(horizon) {
			continue
		}
		// Capacidad libre: total - ya cargado en el vehículo
		freeKg := incoming.CapacityKg - incoming.TotalWeightKg
		if freeKg <= 0 || usedVehicles[incoming.VehicleID] {
			continue
		}

		// Iterar destinos en orden determinístico
		dests := make([]string, 0, len(varadosByDest))
		for d := range varadosByDest {
			dests = append(dests, d)
		}
		sort.Strings(dests)

		for _, dest := range dests {
			group := varadosByDest[dest]
			if len(group) == 0 {
				continue
			}

			// Verificar viabilidad: el grupo debe cumplir las mismas condiciones que
			// dispatchInterBranch habría exigido si hubiera habido vehículos disponibles.
			groupWeight := 0.0
			groupForced := false
			for _, u := range group {
				groupWeight += u.WeightKg
				if u.SLAForced || u.PriorityScore >= cfg.PriorityForceThreshold {
					groupForced = true
				}
			}
			if !groupForced && groupWeight < cfg.MinFillRate*freeKg {
				continue
			}

			// Bin-pack por peso disponible, ordenando por prioridad
			sortUnassignedByPriority(group)
			var ids []string
			var totalKg float64
			var rescuedIdx []int
			for i, u := range group {
				if totalKg+u.WeightKg > freeKg {
					continue
				}
				ids = append(ids, u.TrackingID)
				totalKg += u.WeightKg
				rescuedIdx = append(rescuedIdx, i)
			}
			if len(ids) == 0 {
				continue
			}

			plan.InterBranch = append(plan.InterBranch, model.InterBranchAssignment{
				VehicleID:          incoming.VehicleID,
				LicensePlate:       incoming.LicensePlate,
				DestinationBranch:  dest,
				Rule:               model.DispatchRuleProjected,
				Shipments:          ids,
				TotalWeightKg:      roundKg(totalKg),
				CapacityKg:         incoming.CapacityKg,
				Projected:          true,
				ProjectedArrivalAt: eta,
			})
			usedVehicles[incoming.VehicleID] = true
			freeKg -= totalKg

			// Quitar rescatados de varadosByDest y de plan.Unassigned
			rescuedSet := map[string]bool{}
			for _, id := range ids {
				rescuedSet[id] = true
			}
			remaining := group[:0]
			for _, u := range group {
				if !rescuedSet[u.TrackingID] {
					remaining = append(remaining, u)
				}
			}
			varadosByDest[dest] = remaining

			filtered := plan.Unassigned[:0]
			for _, u := range plan.Unassigned {
				if !rescuedSet[u.TrackingID] {
					filtered = append(filtered, u)
				}
			}
			plan.Unassigned = filtered
		}
	}
}

// GetActiveRouteETA deriva un ETA dinámico "relativo a ahora" para un envío
// out_for_delivery, en lugar del ETA comercial estático calculado al crearlo.
//
// Algoritmo de sobreescritura (estrictamente en horas relativas desde la
// hora actual — así el banner "dentro de las próximas N horas" y la fecha
// de la grilla SIEMPRE coinciden):
//
//  1. minutosRestantes := tiempo restante real extraído del viaje/ruta activa
//  2. horasASumar      := math.Ceil(minutosRestantes / 60)
//  3. límite de seguridad: if horasASumar < 1 { horasASumar = 1 }
//  4. nuevaFechaEstimada := ahora.Add(horasASumar * time.Hour)
//
// El envío no conoce su viaje directamente (Shipment no tiene TripID), así
// que la búsqueda intenta dos estrategias en orden, de la más precisa a la
// más resiliente:
//
//  1. lookupETAFromPersistedPlan: cruce directo contra el plan VRP persistido
//     de hoy (datos de arribo de OrderedStops — preciso, pero solo existe
//     cuando el despacho se generó/aplicó vía el motor de ruteo).
//  2. lookupETAFromActiveRoutes (reverse lookup): cuando el plan no tiene
//     datos VRP para este envío (despacho manual, plan regenerado después de
//     iniciar el viaje, etc.), se itera sobre los viajes en curso de TODOS
//     los choferes (Route.Status == en_curso), se ubica la parada de este
//     envío dentro de las paradas pendientes, y se estima el tiempo restante
//     a partir de la configuración de ruteo (service_time_minutes × paradas
//     pendientes hasta llegar a la suya, inclusive).
//
// Devuelve (nuevaFechaEstimada, horasASumar). (nil, nil) cuando ninguna
// estrategia logra ubicar el envío en un viaje activo — el caller debe
// conservar el EstimatedDeliveryAt comercial original.
func (s *RoutingService) GetActiveRouteETA(trackingID string) (*time.Time, *int) {
	now := clock.Now().In(clock.LocalTZ)

	if eta, hours := s.lookupETAFromPersistedPlan(trackingID, now); eta != nil {
		return eta, hours
	}
	if eta, hours := s.lookupETAFromActiveRoutes(trackingID, now); eta != nil {
		return eta, hours
	}

	log.Printf("[PublicTracking] ETA dinámico: shipment=%s NO encontrado en ningún viaje activo (ni plan VRP ni reverse lookup de rutas en_curso) — se usará ETA comercial estático", trackingID)
	return nil, nil
}

// lookupETAFromPersistedPlan cruza el envío contra el plan de ruteo VRP
// persistido del día (OrderedStops, con horarios de arribo precisos).
// Devuelve (nil, nil) si no hay plan para hoy o el envío no aparece en
// ninguna asignación de última milla.
func (s *RoutingService) lookupETAFromPersistedPlan(trackingID string, now time.Time) (*time.Time, *int) {
	today := now.Format("2006-01-02")
	plan, err := s.planRepo.GetByDate(today)
	if err != nil || plan == nil {
		log.Printf("[PublicTracking] ETA dinámico (plan VRP): sin plan persistido para la fecha %s (shipment=%s, err=%v)", today, trackingID, err)
		return nil, nil
	}

	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, clock.LocalTZ)

	for _, bp := range plan.BranchPlans {
		for _, lma := range bp.Plan.LastMile {
			for _, stop := range lma.OrderedStops {
				// Comparación exacta de TrackingID — éste es el cruce
				// Shipment↔LastMileAssignment que alimenta el algoritmo.
				if stop.TrackingID != trackingID || stop.Unsequenced {
					continue
				}
				arrivalMin := lma.SuggestedDepartureMin + stop.ArrivalMin
				stopETA := midnight.Add(time.Duration(arrivalMin) * time.Minute)
				minutosRestantes := stopETA.Sub(now).Minutes()
				nuevaFechaEstimada, horasASumar := deriveOverwriteETA(now, minutosRestantes)

				driverID := "(sin asignar)"
				if lma.DriverID != nil {
					driverID = *lma.DriverID
				}
				log.Printf("[PublicTracking] ETA dinámico (plan VRP): MATCH shipment=%s sucursal=%s vehiculo=%s chofer=%s | horaActual=%s minutosRestantesRuta=%.1f horasASumar=%d → nuevaFechaEstimada=%s",
					trackingID, bp.BranchID, lma.VehicleID, driverID, now.Format(time.RFC3339), minutosRestantes, *horasASumar, nuevaFechaEstimada.Format(time.RFC3339))
				return nuevaFechaEstimada, horasASumar
			}
		}
	}
	log.Printf("[PublicTracking] ETA dinámico (plan VRP): shipment=%s NO encontrado en OrderedStops del plan %s — se intenta reverse lookup sobre viajes activos", trackingID, plan.PlanDate)
	return nil, nil
}

// lookupETAFromActiveRoutes es la búsqueda inversa (Trip Iteration): como el
// envío no referencia su viaje, se recorren los viajes en curso de todos los
// choferes (Route.Status == en_curso para la fecha de hoy) y, dentro de cada
// uno, sus paradas pendientes (envíos out_for_delivery aún no resueltos), en
// busca del TrackingID solicitado.
//
// Al no contar con horarios VRP por parada en este camino (Route no persiste
// arribos por stop), el tiempo restante se estima como
// service_time_minutes × cantidad de paradas pendientes hasta la propia
// (inclusive) — un piso conservador que respeta el orden real de entrega del
// chofer sin inventar datos de distancia/tránsito que no existen para rutas
// despachadas fuera del motor VRP.
func (s *RoutingService) lookupETAFromActiveRoutes(trackingID string, now time.Time) (*time.Time, *int) {
	serviceTimeMin := s.cfgSvc.Get().ServiceTimeMinutes

	for _, driver := range s.authRepo.ListByRole(model.RoleDriver, "") {
		route, shipments, err := s.routeSvc.GetTodayRoute(driver.ID)
		if err != nil || route.Status != model.RouteStatusActive || !route.HasShipment(trackingID) {
			continue
		}

		// Cuenta las paradas pendientes (out_for_delivery, en orden de ruta)
		// hasta llegar a la del envío buscado, inclusive.
		pendingStopsAhead := 0
		found := false
		for _, sh := range shipments {
			if sh.Status != model.StatusOutForDelivery {
				continue
			}
			pendingStopsAhead++
			if sh.TrackingID == trackingID {
				found = true
				break
			}
		}
		if !found {
			continue
		}

		minutosRestantes := float64(pendingStopsAhead * serviceTimeMin)
		nuevaFechaEstimada, horasASumar := deriveOverwriteETA(now, minutosRestantes)

		log.Printf("[PublicTracking] ETA dinámico (reverse lookup): MATCH shipment=%s ruta=%s chofer=%s | paradasPendientesHastaLaSuya=%d serviceTimeMin=%d minutosRestantesEstimados=%.1f horasASumar=%d → nuevaFechaEstimada=%s",
			trackingID, route.ID, driver.ID, pendingStopsAhead, serviceTimeMin, minutosRestantes, *horasASumar, nuevaFechaEstimada.Format(time.RFC3339))
		return nuevaFechaEstimada, horasASumar
	}

	log.Printf("[PublicTracking] ETA dinámico (reverse lookup): shipment=%s NO encontrado en ningún viaje en_curso", trackingID)
	return nil, nil
}

// deriveOverwriteETA aplica la fórmula de sobreescritura sobre minutos
// restantes ya extraídos (de cualquiera de las dos estrategias de búsqueda):
// redondeo hacia arriba a horas + piso de seguridad de 1 hora, y la nueva
// fecha estimada como ahora + esas horas.
func deriveOverwriteETA(now time.Time, minutosRestantes float64) (*time.Time, *int) {
	horasASumar := int(math.Ceil(minutosRestantes / 60))
	if horasASumar < 1 {
		horasASumar = 1
	}
	nuevaFechaEstimada := now.Add(time.Duration(horasASumar) * time.Hour)
	return &nuevaFechaEstimada, &horasASumar
}

// sortUnassignedByPriority ordena envíos varados: alta > media > baja, luego WeightKg ASC.
func sortUnassignedByPriority(items []model.UnassignedShipment) {
	priOrder := map[string]int{"alta": 0, "media": 1, "baja": 2}
	sort.SliceStable(items, func(i, j int) bool {
		pi, pj := priOrder[items[i].Priority], priOrder[items[j].Priority]
		if pi != pj {
			return pi < pj
		}
		return items[i].WeightKg < items[j].WeightKg
	})
}
