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
	cfgSvc          *RoutingConfigService
	shipmentRepo    repository.ShipmentRepository
	vehicleRepo     repository.VehicleRepository
	branchRepo      repository.BranchRepository
	authRepo        repository.AuthRepository
	routeSvc        *RouteService
	shipmentSvc     *ShipmentService
	planRepo        repository.RoutingPlanRepository
	osrmClient      *osrm.Client // nullable; sin OSRM se usa Haversine para la matriz
	orsClient       *ors.Client  // nullable; usado en modo segura para evitar polígonos (avoid_polygons)
	interBranchTripSvc *InterBranchTripService
	graphSvc        *BranchGraphService  // nullable; used for stale-replan
	zoneSvc         *ZoneService         // nullable; needed for safe-route mode
	notifSvc        *NotificationService // nullable; SLA risk notifications (LOGITRACK-404)
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

func (s *RoutingService) SetZoneService(svc *ZoneService) {
	s.zoneSvc = svc
}

func (s *RoutingService) SetORSClient(c *ors.Client) {
	s.orsClient = c
}

const lastMileDestLabel = "(última milla)"

// =============================================================================
// GeneratePlan
// =============================================================================

func (s *RoutingService) GeneratePlan(ctx context.Context, branchID string) (model.RoutingPlan, error) {
	return s.generatePlan(ctx, branchID, false, nil)
}

// generatePlan es la implementación interna. forGlobal=true desactiva el
// check de fill-rate en addMultiHopStops: el plan global corre
// enforceMinSegmentUtilization después de sumar los pickups cross-branch,
// por lo que el check prematuro bloquearía hops que sí consolidan en red.
// existingGlobal, cuando no es nil, se usa para pre-marcar como "taken" los
// shipments que otras sucursales del plan actual ya reservaron como cross-branch
// pickups, evitando conflictos en regeneraciones locales.
func (s *RoutingService) generatePlan(_ context.Context, branchID string, forGlobal bool, existingGlobal *model.GlobalRoutingPlan) (model.RoutingPlan, error) {
	cfg := s.cfgSvc.Get()
	now := clock.Now().UTC()

	plan := model.RoutingPlan{
		BranchID:       branchID,
		GeneratedAt:    now,
		LastMile:       []model.LastMileAssignment{},
		InterBranch:    []model.InterBranchAssignment{},
		Unassigned:     []model.UnassignedShipment{},
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

	// SLA risk check: evalúa todos los envíos activos de la sucursal y dispara/resetea
	// notificaciones según CA-01 a CA-04 (LOGITRACK-404).
	s.checkSLARisk(all, cfg, now)

	// 2) Última milla — asignar a vehículos de modo ultima_milla
	plan.LastMile, plan.Unassigned = s.binPackLastMileVehicles(lastMileQ, branchID, plan.Unassigned)
	// Optimizar orden de paradas y horario de salida sugerido por VRP.
	s.scheduleLastMileAssignments(plan.LastMile, branchID, shipmentByTID, cfg, now, model.RouteModeVentanas)

	// 3) Inter-sucursal — solo vehículos de modo inter_sucursal
	availableVehicles, existingVehicleLoad := s.filterAvailableVehiclesForMode(branchID, model.VehicleModeInterBranch)
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
	allAvailable, allExistingLoad := s.filterAvailableVehicles(branchID)
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
	s.addCrossBranchPickupsForBranch(&plan, branchID, existingGlobal)

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
		// Para segura y costo el horario no influye en el orden (el orden lo
		// determina la matriz de penalty/distancia). Por defecto sugerimos 8am
		// — el operador puede ajustar manual si quiere ganar cobertura de
		// ventana. Para ventanas el horario SÍ es la métrica clave, así que
		// usamos el horario óptimo que devolvió el solver.
		if mode == model.RouteModeSegura || mode == model.RouteModeCosto {
			a.SuggestedDepartureMin = int(morningStartMin)
		} else {
			a.SuggestedDepartureMin = int(bestDep + 0.5)
		}
		a.WindowCoverage = coverage
		a.RouteMode = mode.Normalize()
		// Geometría real del trayecto vía OSRM (sigue calles, no líneas rectas).
		// Para segura intercala waypoints de bordeado para que OSRM rutee
		// alrededor de las zonas peligrosas en vez de cruzarlas.
		a.PolylineCoords = s.computeRoadPolyline(depotCoord, a.Shipments, shipByTID, activeZones, mode)
	}
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
	log.Printf("[routing] mode=%s engine=OSRM waypoints_enviados=%d puntos_polyline=%d", mode, len(coords), len(routeCoords))
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
		vehicle  model.Vehicle
		shipments []string
		weight   float64
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
			VehicleID:    b.vehicle.ID,
			LicensePlate: b.vehicle.LicensePlate,
			CapacityKg:   b.vehicle.CapacityKg,
			Shipments:    b.shipments,
			TotalWeightKg: roundKg(b.weight),
		})
	}
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
					TrackingID:  sh.TrackingID,
					Destination: dest,
					Reason:      "sin_vehiculos_para_destino",
					WeightKg:    sh.WeightKg,
					Priority:    sh.Priority,
				})
			}
			continue
		}

		chosen, included, excluded := selectAndPack(poolForDest, existingLoad, group, cfg.MinFillRate)
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
	// Inicializamos como empty (no nil) para que el JSON siempre serialice
	// como `[]` y no como `null` — el frontend asume array.
	items := make([]model.ApplyResultItem, 0)

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
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusRedeliveryScheduled {
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
				Notes:     "Cargado en " + v.LicensePlate + " vía planificador (última milla)",
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
					_, _ = s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
						Kind:                model.TripKindLastMile,
						DriverID:            asgmt.DriverID,
						VehicleID:           v.ID,
						LicensePlate:        v.LicensePlate,
						OriginBranchID:      branchID,
						DestinationBranchID: nil,
						ShipmentIDs:         appliedIDs,
						TotalWeightKg:       totalWeight,
						CreatedBy:           username,
					})
				}
			}
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
				createdTrip, err := s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
					Kind:                model.TripKindInterBranch,
					DriverID:            nil,
					VehicleID:           v.ID,
					LicensePlate:        v.LicensePlate,
					OriginBranchID:      branchID,
					DestinationBranchID: &finalDest,
					ShipmentIDs:         allShipments,
					TotalWeightKg:       roundKg(totalWeight),
					Stops:               stops,
					CreatedBy:           username,
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

// isSLACriticalETA returns true if the shipment is within the SLA forced horizon
// based solely on estimated delivery time (not priority score).
func isSLACriticalETA(sh model.Shipment, cfg model.RoutingConfig, now time.Time) bool {
	if model.IsTerminalStatus(sh.Status) {
		return false
	}
	// Also skip Expired and Rechazado (non-active terminal-like statuses per CA-01)
	if sh.Status == model.StatusExpired || sh.Status == model.StatusRechazado {
		return false
	}
	slaHorizon := time.Duration(cfg.SLAForceHorizonHours) * time.Hour
	return sh.EstimatedDeliveryAt != nil && sh.EstimatedDeliveryAt.Sub(now) < slaHorizon
}

// checkSLARisk evaluates SLA risk for the given shipments and fires/resets notifications (CA-04).
// Must be called synchronously before plan generation returns.
func (s *RoutingService) checkSLARisk(shipments []model.Shipment, cfg model.RoutingConfig, now time.Time) {
	if s.notifSvc == nil {
		return
	}
	for _, sh := range shipments {
		critical := isSLACriticalETA(sh, cfg, now)
		if critical {
			if sh.SLANotifiedAt == nil {
				// Mark first, then fire in background — avoids double-notif on concurrent runs.
				notifiedAt := now
				if err := s.shipmentRepo.SetSLANotified(sh.TrackingID, &notifiedAt); err != nil {
					log.Printf("[RoutingService] SetSLANotified error for %s: %v", sh.TrackingID, err)
					continue
				}
				branchID := sh.CurrentLocation
				if branchID == "" {
					branchID = sh.ReceivingBranchID
				}
				shCopy := sh
				go s.notifSvc.NotifySLARisk(shCopy, branchID)
			}
			// else: already notified for this critical cycle, skip (CA-04)
		} else {
			// Shipment exited critical state — reset so a future re-entry re-notifies (CA-04)
			if sh.SLANotifiedAt != nil {
				if err := s.shipmentRepo.SetSLANotified(sh.TrackingID, nil); err != nil {
					log.Printf("[RoutingService] SetSLANotified reset error for %s: %v", sh.TrackingID, err)
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
func (s *RoutingService) consolidateCrossBranchDispatches(plan *model.GlobalRoutingPlan) {
	if s.graphSvc == nil {
		return
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
				from     string
				to       string
				liveKgIn float64 // peso al entrar en este tramo
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
		if sh.DeliveryMethod == model.DeliveryMethodBranchPickup {
			continue
		}
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
	inventory := s.snapshotAtHubInventory()
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
		branchPlan, err := s.generatePlan(ctx, br.ID, true, nil)
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
	s.consolidateCrossBranchDispatches(plan)

	// Utilización mínima del tramo: eliminar paradas adicionales cuyo tramo
	// no alcanza el fill_rate configurado, salvo que haya SLA forzado.
	s.enforceMinSegmentUtilization(plan, cfg)

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

	// Leer el plan global del día antes de generar: lo pasamos a generatePlan para
	// que los cross-branch pickups ya asignados a otras sucursales queden marcados
	// como taken y no sean reasignados por este plan local.
	global, err := s.planRepo.GetByDate(planDate)
	if err != nil {
		return nil, err
	}

	// Generar el plan fresco para esta sucursal con contexto del plan global existente.
	branchPlan, err := s.generatePlan(ctx, branchID, false, global)
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
						createdTrip, err := s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
							Kind:                model.TripKindInterBranch,
							DriverID:            nil,
							VehicleID:           v.ID,
							LicensePlate:        v.LicensePlate,
							OriginBranchID:      branchID,
							DestinationBranchID: &finalDest,
							ShipmentIDs:         allShipments,
							TotalWeightKg:       roundKg(totalWeight),
							Stops:               stops,
							CreatedBy:           username,
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
			if sh.Status != model.StatusAtHub && sh.Status != model.StatusRedeliveryScheduled {
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
						_, _ = s.interBranchTripSvc.Create(CreateInterBranchTripCmd{
							Kind:          model.TripKindLastMile,
							DriverID:      asgmt.DriverID,
							VehicleID:     v.ID,
							LicensePlate:  v.LicensePlate,
							OriginBranchID: branchID,
							ShipmentIDs:   appliedIDs,
							TotalWeightKg: totalWeight,
							CreatedBy:     username,
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
	// Para el recompute usamos el inicio de la ventana morning como referencia
	// en lugar de la hora actual. Así el operador puede recalcular a cualquier
	// hora del día (incluso de noche) y siempre obtiene un plan con candidatos
	// de salida válidos. La hora de inicio que devuelve el VRP igual refleja
	// el horario óptimo dentro de la ventana operativa.
	local := clock.Now().In(clock.LocalTZ)
	morningStart := time.Date(local.Year(), local.Month(), local.Day(),
		cfg.MorningWindowStartHour, 0, 0, 0, clock.LocalTZ).UTC()
	assignments := []model.LastMileAssignment{a}
	s.scheduleLastMileAssignments(assignments, branchID, shipByTID, cfg, morningStart, mode)

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

// tryProjectedDispatch is a WIP feature: uses incoming vehicles to rescue unassigned shipments.
func (s *RoutingService) tryProjectedDispatch(
	plan *model.RoutingPlan,
	branchID string,
	interBranchQ map[string][]model.Shipment,
	existingLoad map[string]float64,
	cfg model.RoutingConfig,
	now time.Time,
) {
	if cfg.FleetProjectionHorizonHours <= 0 {
		return
	}
	rescuableReasons := map[string]bool{
		"sin_vehiculos_disponibles":    true,
		"sin_vehiculos_para_destino":   true,
	}
	for _, incoming := range plan.IncomingVehicles {
		if incoming.EstimatedArrivalAt == nil {
			continue
		}
		for i := len(plan.Unassigned) - 1; i >= 0; i-- {
			u := plan.Unassigned[i]
			if !rescuableReasons[u.Reason] {
				continue
			}
			dest := u.Destination
			shipmentsForDest := interBranchQ[dest]
			if len(shipmentsForDest) == 0 {
				continue
			}
			var total float64
			var ids []string
			for _, sh := range shipmentsForDest {
				total += sh.WeightKg
				ids = append(ids, sh.TrackingID)
			}
			if total > incoming.CapacityKg {
				continue
			}
			plan.InterBranch = append(plan.InterBranch, model.InterBranchAssignment{
				VehicleID:         incoming.VehicleID,
				LicensePlate:      incoming.LicensePlate,
				DestinationBranch: dest,
				Rule:              model.DispatchRuleSLA,
				Shipments:         ids,
				TotalWeightKg:     total,
				CapacityKg:        incoming.CapacityKg,
			})
			// Remove rescued shipments from unassigned
			plan.Unassigned = append(plan.Unassigned[:i], plan.Unassigned[i+1:]...)
			break
		}
	}
}
