// Package service — DispatchVolumeChecker implementa LOGITRACK-409.
//
// Evalúa en tiempo real si el volumen acumulado de envíos pendientes de despacho
// en una sucursal alcanza el mínimo configurado para al menos un vehículo disponible,
// y genera una notificación in-app para operadores y supervisores.
//
// CA-01: trigger al llegar a at_origin_hub, at_hub o al confirmar un envío.
// CA-02: evaluación inmediata, no periódica.
// CA-03: título y cuerpo según tipo de viaje (última milla / intersucursal).
// CA-04: deduplicación por par (origen, destino, tipo) — no re-notifica mientras el par
//
//	siga notificado.
//
// CA-05: reset del estado notificado cuando el volumen cae por debajo del umbral
//
//	(se re-evalúa luego de aplicar un plan de ruteo).
//
// CA-06: estado persistido en dispatch_volume_state (Postgres).
// CA-07: tasas independientes para última milla e intersucursal.
package service

import (
	"fmt"
	"log"
	"sort"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// dispatchRoutingCfgGetter es la interfaz mínima que necesita DispatchVolumeChecker
// para leer la configuración de tasas de volumen mínimo.
type dispatchRoutingCfgGetter interface {
	Get() model.RoutingConfig
}

// DispatchVolumeChecker evalúa el volumen pendiente de despacho de una sucursal
// y emite/resetea notificaciones según el estado.
type DispatchVolumeChecker struct {
	shipmentRepo  repository.ShipmentRepository
	vehicleRepo   repository.VehicleRepository
	branchRepo    repository.BranchRepository
	stateRepo     repository.DispatchVolumeRepository
	notifRepo     repository.NotificationRepository
	routingCfgSvc dispatchRoutingCfgGetter
	hub           Pusher // SSE push; nil = sin push
}

// NewDispatchVolumeChecker crea un DispatchVolumeChecker.
func NewDispatchVolumeChecker(
	shipmentRepo repository.ShipmentRepository,
	vehicleRepo repository.VehicleRepository,
	branchRepo repository.BranchRepository,
	stateRepo repository.DispatchVolumeRepository,
	notifRepo repository.NotificationRepository,
	routingCfgSvc dispatchRoutingCfgGetter,
) *DispatchVolumeChecker {
	return &DispatchVolumeChecker{
		shipmentRepo:  shipmentRepo,
		vehicleRepo:   vehicleRepo,
		branchRepo:    branchRepo,
		stateRepo:     stateRepo,
		notifRepo:     notifRepo,
		routingCfgSvc: routingCfgSvc,
	}
}

// SetHub inyecta el hub SSE para push en tiempo real.
func (c *DispatchVolumeChecker) SetHub(hub Pusher) { c.hub = hub }

// Check evalúa el volumen pendiente de despacho de la sucursal y dispara/resetea
// notificaciones. Está diseñado para llamarse como goroutine (fire-and-forget).
func (c *DispatchVolumeChecker) Check(branchID string) {
	cfg := c.routingCfgSvc.Get()

	// Usar tasa legada si las nuevas están en cero (retrocompat).
	lastMileRate := cfg.MinFillLastMileRate
	if lastMileRate <= 0 {
		lastMileRate = cfg.MinFillRate
	}
	interRate := cfg.MinFillInterBranchRate
	if interRate <= 0 {
		interRate = cfg.MinFillRate
	}

	// --- Listar envíos pendientes de despacho en la sucursal ---
	all, err := c.shipmentRepo.List(model.ShipmentFilter{ReceivingBranchID: branchID})
	if err != nil {
		log.Printf("[DispatchVolumeChecker] List error para %s: %v", branchID, err)
		return
	}

	// Vehículos disponibles en la sucursal.
	vehicles := c.vehiclesForBranch(branchID)

	// Acumular grupos.
	type group struct {
		totalKg  float64
		destKey  string // branch_id (inter) | "ultima_milla"
		tripType string
	}

	lastMileKg := 0.0
	interKg := map[string]float64{} // destKey → kg

	for _, sh := range all {
		if !c.isPendingDispatch(sh, branchID) {
			continue
		}
		if sh.FinalBranchID == branchID && sh.DeliveryMethod == model.DeliveryMethodLastMile {
			lastMileKg += sh.WeightKg
		} else if sh.FinalBranchID != "" && sh.FinalBranchID != branchID {
			destKey := sh.NextHopBranchID
			if destKey == "" {
				destKey = sh.FinalBranchID
			}
			interKg[destKey] += sh.WeightKg
		}
		// retiro_sucursal en sucursal destino: no necesita despacho → ignorar.
	}

	// --- Evaluar cada grupo ---
	// Última milla.
	c.evaluateGroup(
		branchID,
		repository.TripTypeLastMile,
		"ultima_milla",
		"ultima_milla",
		lastMileKg,
		lastMileRate,
		model.VehicleModeLastMile,
		vehicles,
	)

	// Intersucursal — uno por destino.
	for destKey, kg := range interKg {
		c.evaluateGroup(
			branchID,
			repository.TripTypeInterBranch,
			destKey,
			destKey,
			kg,
			interRate,
			model.VehicleModeInterBranch,
			vehicles,
		)
	}

	// CA-05: resetear pares notificados cuyo volumen ya cayó por debajo del umbral.
	c.resetStaleNotifications(branchID, lastMileKg, interKg, lastMileRate, interRate, vehicles)
}

// evaluateGroup comprueba si el volumen kg alcanza el umbral para el tipo de vehículo
// indicado y emite/omite la notificación según el estado de deduplicación.
func (c *DispatchVolumeChecker) evaluateGroup(
	branchID, tripType, destKey, rawDestKey string,
	totalKg, rate float64,
	mode model.VehicleMode,
	vehicles []model.Vehicle,
) {
	// Filtrar vehículos del modo correcto.
	var modeVehicles []model.Vehicle
	for _, v := range vehicles {
		if v.Mode == mode {
			modeVehicles = append(modeVehicles, v)
		}
	}
	if len(modeVehicles) == 0 || totalKg <= 0 {
		return
	}

	// Buscar el vehículo sugerido: el más pequeño cuya capacidad×rate ≤ totalKg.
	suggested, ok := c.bestVehicle(modeVehicles, totalKg, rate)
	if !ok {
		// Volumen no alcanza el mínimo de ningún vehículo — verificar reset.
		return
	}

	// CA-04: ya notificado → no volver a notificar.
	notified, err := c.stateRepo.IsNotified(branchID, destKey, tripType)
	if err != nil {
		log.Printf("[DispatchVolumeChecker] IsNotified error (%s,%s,%s): %v", branchID, destKey, tripType, err)
		return
	}
	if notified {
		return
	}

	// Marcar como notificado antes de crear las notificaciones (evita race).
	if err := c.stateRepo.SetNotified(branchID, destKey, tripType, clock.Now().UTC()); err != nil {
		log.Printf("[DispatchVolumeChecker] SetNotified error (%s,%s,%s): %v", branchID, destKey, tripType, err)
		return
	}

	// Construir contenido (CA-03).
	title, resourceID := c.buildTitle(tripType, destKey)
	fillPct := int((totalKg / suggested.CapacityKg) * 100)
	body := fmt.Sprintf("%.1f kg listos · Vehículo sugerido: %s (%d%% de capacidad)",
		totalKg, suggested.LicensePlate, fillPct)

	// Notificar a operadores y supervisores de la sucursal.
	users, err := c.notifRepo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[DispatchVolumeChecker] GetUsers error para %s: %v", branchID, err)
		return
	}
	if len(users) == 0 {
		return
	}

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationMinFillReached,
			Title:      title,
			Body:       body,
			ResourceID: resourceID,
			CreatedAt:  now,
		}
		if err := c.notifRepo.Create(n); err != nil {
			log.Printf("[DispatchVolumeChecker] Create notif error para user %s: %v", u.ID, err)
		} else if c.hub != nil {
			c.hub.Push(n.UserID)
		}
	}
	log.Printf("[DispatchVolumeChecker] notificación emitida — sucursal %s, destino %s, tipo %s, %.1f kg, vehículo %s",
		branchID, destKey, tripType, totalKg, suggested.LicensePlate)
}

// resetStaleNotifications verifica pares actualmente notificados cuyo volumen
// ahora está por debajo del umbral y resetea su estado (CA-05).
func (c *DispatchVolumeChecker) resetStaleNotifications(
	branchID string,
	lastMileKg float64,
	interKg map[string]float64,
	lastMileRate, interRate float64,
	vehicles []model.Vehicle,
) {
	notified, err := c.stateRepo.GetAllNotified(branchID)
	if err != nil {
		log.Printf("[DispatchVolumeChecker] GetAllNotified error para %s: %v", branchID, err)
		return
	}
	for _, st := range notified {
		switch st.TripType {
		case repository.TripTypeLastMile:
			modeVehicles := c.vehiclesByMode(vehicles, model.VehicleModeLastMile)
			if _, ok := c.bestVehicle(modeVehicles, lastMileKg, lastMileRate); !ok {
				c.doReset(branchID, st.DestKey, st.TripType)
			}
		case repository.TripTypeInterBranch:
			modeVehicles := c.vehiclesByMode(vehicles, model.VehicleModeInterBranch)
			kg := interKg[st.DestKey]
			if _, ok := c.bestVehicle(modeVehicles, kg, interRate); !ok {
				c.doReset(branchID, st.DestKey, st.TripType)
			}
		}
	}
}

func (c *DispatchVolumeChecker) doReset(branchID, destKey, tripType string) {
	if err := c.stateRepo.ResetNotified(branchID, destKey, tripType); err != nil {
		log.Printf("[DispatchVolumeChecker] ResetNotified error (%s,%s,%s): %v", branchID, destKey, tripType, err)
	} else {
		log.Printf("[DispatchVolumeChecker] estado notificado reseteado — sucursal %s, destino %s, tipo %s (CA-05)",
			branchID, destKey, tripType)
	}
}

// isPendingDispatch devuelve true si el envío está pendiente de despacho desde branchID.
func (c *DispatchVolumeChecker) isPendingDispatch(sh model.Shipment, branchID string) bool {
	// Solo estados "en sucursal" y esperando despacho.
	if sh.Status != model.StatusAtOriginHub && sh.Status != model.StatusAtHub &&
		sh.Status != model.StatusRedeliveryScheduled {
		return false
	}
	// Verificar que el envío esté físicamente en esta sucursal.
	loc := sh.CurrentLocation
	if loc == "" {
		loc = sh.ReceivingBranchID
	}
	if loc != branchID {
		return false
	}
	// Excluir reservados para un trip ya asignado.
	if sh.ReservedForTripID != nil {
		return false
	}
	return true
}

// vehiclesForBranch retorna todos los vehículos disponibles asignados a la sucursal.
func (c *DispatchVolumeChecker) vehiclesForBranch(branchID string) []model.Vehicle {
	all := c.vehicleRepo.List()
	var out []model.Vehicle
	for _, v := range all {
		if v.AssignedBranch == nil || *v.AssignedBranch != branchID {
			continue
		}
		if v.Status == model.VehicleStatusAvailable {
			out = append(out, v)
		}
	}
	return out
}

func (c *DispatchVolumeChecker) vehiclesByMode(vehicles []model.Vehicle, mode model.VehicleMode) []model.Vehicle {
	var out []model.Vehicle
	for _, v := range vehicles {
		if v.Mode == mode {
			out = append(out, v)
		}
	}
	return out
}

// bestVehicle retorna el vehículo sugerido: el de menor capacidad cuya
// capacidad × rate ≤ totalKg (el que mejor "llena" sin desperdiciar espacio).
// Si ninguno cumple el umbral, devuelve (_, false).
func (c *DispatchVolumeChecker) bestVehicle(vehicles []model.Vehicle, totalKg, rate float64) (model.Vehicle, bool) {
	// Ordenar de menor a mayor capacidad para encontrar el "más ajustado".
	sorted := make([]model.Vehicle, len(vehicles))
	copy(sorted, vehicles)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].CapacityKg < sorted[j].CapacityKg
	})

	for _, v := range sorted {
		if v.CapacityKg <= 0 {
			continue
		}
		if totalKg >= rate*v.CapacityKg {
			return v, true
		}
	}
	return model.Vehicle{}, false
}

// buildTitle construye el título de la notificación y el resourceID de navegación (CA-03).
func (c *DispatchVolumeChecker) buildTitle(tripType, destKey string) (title, resourceID string) {
	if tripType == repository.TripTypeLastMile {
		return "Volumen mínimo alcanzado para recorrido de última milla", "repartos"
	}
	// Intersucursal: buscar el nombre de la sucursal destino.
	branchName := destKey
	if b, ok := c.branchRepo.GetByID(destKey); ok && b.Name != "" {
		branchName = b.Name
	}
	return fmt.Sprintf("Volumen mínimo alcanzado para despacho a %s", branchName), "inter-sucursal"
}

// CheckAfterDispatch re-evalúa el volumen de una sucursal luego de aplicar un plan
// de ruteo, lo que puede resetear pares cuyo volumen cayó por debajo del umbral (CA-05).
// Está diseñado para llamarse como goroutine (fire-and-forget).
func (c *DispatchVolumeChecker) CheckAfterDispatch(branchID string) {
	c.Check(branchID)
}

// DispatchVolumeNotifier es la interfaz mínima que necesitan ShipmentService y RoutingService.
type DispatchVolumeNotifier interface {
	Check(branchID string)
	CheckAfterDispatch(branchID string)
}

