package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type RouteService struct {
	repo         repository.RouteRepository
	shipmentRepo repository.ShipmentRepository
}

func NewRouteService(repo repository.RouteRepository, shipmentRepo repository.ShipmentRepository) *RouteService {
	return &RouteService{repo: repo, shipmentRepo: shipmentRepo}
}

func (s *RouteService) GetTodayRoute(driverID string) (model.Route, []model.Shipment, error) {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil {
		return model.Route{}, nil, err
	}
	shipments := make([]model.Shipment, 0, len(route.ShipmentIDs))
	for _, id := range route.ShipmentIDs {
		sh, err := s.shipmentRepo.GetByTrackingID(id)
		if err == nil && isVisibleForDriver(sh, today) {
			shipments = append(shipments, sh)
		}
	}
	return route, shipments, nil
}

// isVisibleForDriver returns true for shipments the driver should see on their route.
func isVisibleForDriver(sh model.Shipment, routeDate model.DateOnly) bool {
	switch sh.Status {
	case model.StatusOutForDelivery, model.StatusDeliveryFailed:
		return true
	case model.StatusDelivered:
		return sh.DeliveredAt != nil && model.NewDateOnly(sh.DeliveredAt.In(clock.LocalTZ)).Equal(routeDate)
	case model.StatusRechazado:
		return true
	}
	return false
}

func isDriverActiveStatus(s model.Status) bool {
	return s == model.StatusOutForDelivery || s == model.StatusDeliveryFailed
}

func (s *RouteService) Create(req model.CreateRouteRequest, createdBy string) (model.Route, error) {
	t, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		return model.Route{}, fmt.Errorf("formato de fecha inválido, usá AAAA-MM-DD")
	}
	route := model.Route{
		ID:          generateRouteID(),
		Date:        model.NewDateOnly(t),
		DriverID:    req.DriverID,
		ShipmentIDs: req.ShipmentIDs,
		CreatedBy:   createdBy,
		CreatedAt:   clock.Now().UTC(),
		Status:      model.RouteStatusPending,
	}
	return s.repo.Create(route)
}

func (s *RouteService) AddShipmentToDriverRoute(driverID, trackingID string, date model.DateOnly) error {
	route, err := s.repo.GetByDriverAndDate(driverID, date)
	if err != nil {
		// No route yet for this driver today — create one
		newRoute := model.Route{
			ID:          generateRouteID(),
			Date:        date,
			DriverID:    driverID,
			ShipmentIDs: []string{trackingID},
			CreatedBy:   "system",
			CreatedAt:   clock.Now().UTC(),
			Status:      model.RouteStatusPending,
		}
		_, err = s.repo.Create(newRoute)
		return err
	}
	if route.Status == model.RouteStatusActive || route.Status == model.RouteStatusFinished {
		if route.HasShipment(trackingID) {
			return nil
		}
		// Si no hay envíos activos pendientes, resetear la ruta para una nueva tanda.
		// Si los hay, igualmente agregar el nuevo envío (el planificador puede asignar
		// una segunda tanda al mismo chofer mientras aún tiene entregas en curso).
		hasActivePending := false
		for _, sid := range route.ShipmentIDs {
			sh, err := s.shipmentRepo.GetByTrackingID(sid)
			if err != nil || isDriverActiveStatus(sh.Status) {
				hasActivePending = true
				break
			}
		}
		if !hasActivePending {
			route.ShipmentIDs = route.ShipmentIDs[:0]
			route.Status = model.RouteStatusPending
			route.StartedAt = nil
		}
	}
	if route.HasShipment(trackingID) {
		return nil
	}
	route.ShipmentIDs = append(route.ShipmentIDs, trackingID)
	return s.repo.Update(route)
}

func (s *RouteService) RemoveShipmentFromTodayRoute(trackingID string) error {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	return s.repo.RemoveShipmentFromDate(trackingID, today)
}

// FinishRoute transitions today's route from en_curso → finalizada.
// Called when all deliveries are complete so that GetTodayCheckin can detect
// the completed run and increment CompletedRoutesToday on the check-in.
// Returns nil (no-op) if the route is not currently active.
func (s *RouteService) FinishRoute(driverID string) error {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil || route.Status != model.RouteStatusActive {
		return nil
	}
	route.Status = model.RouteStatusFinished
	return s.repo.Update(route)
}

// SetSuggestedStartTime persiste el horario óptimo de salida sugerido por el
// motor de ruteo en la Route del chofer para esa fecha. Si la ruta no existe
// (todavía no se aplicaron shipments) o ya arrancó, no hace nada.
func (s *RouteService) SetSuggestedStartTime(driverID string, date model.DateOnly, suggestedAt time.Time) error {
	route, err := s.repo.GetByDriverAndDate(driverID, date)
	if err != nil {
		return nil
	}
	if route.Status == model.RouteStatusActive {
		return nil
	}
	route.SuggestedStartTime = &suggestedAt
	return s.repo.Update(route)
}

func (s *RouteService) ValidateDriverCanUpdateShipment(driverID, trackingID string, status model.Status) error {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil {
		return fmt.Errorf("no tenés una ruta asignada para hoy")
	}
	if route.Status == model.RouteStatusPending {
		return fmt.Errorf("debés iniciar la ruta antes de registrar entregas")
	}
	if !route.HasShipment(trackingID) {
		return fmt.Errorf("el envío no está en tu ruta")
	}
	if status != model.StatusDelivered && status != model.StatusDeliveryFailed && status != model.StatusLost && status != model.StatusRechazado {
		return fmt.Errorf("los choferes solo pueden marcar envíos como entregado, fallo de entrega o extraviado")
	}
	return nil
}

// PendingLoad devuelve la cantidad y peso de envíos que el chofer todavía
// tiene físicamente sobre el camión, para que el planificador no le sume más
// si ya está al tope. Cuenta out_for_delivery y delivery_failed: hasta que el
// envío deje delivery_failed (transición a at_hub / redelivery_scheduled / etc),
// el paquete sigue con el chofer. Una vez que la ruta del día terminó
// (RouteStatusFinished), el chofer ya volvió a la sucursal — no importa el
// estado de los envíos, su camión queda libre para una nueva tanda.
func (s *RouteService) PendingLoad(driverID string, date model.DateOnly) (count int, weightKg float64) {
	tids := s.PendingShipments(driverID, date)
	for _, tid := range tids {
		sh, err := s.shipmentRepo.GetByTrackingID(tid)
		if err != nil {
			continue
		}
		count++
		weightKg += sh.WeightKg
	}
	return count, weightKg
}

// PendingShipments devuelve los tracking IDs de los envíos que el chofer
// todavía tiene físicamente sobre el camión (out_for_delivery / delivery_failed)
// en la ruta del día. Si la ruta ya terminó, devuelve nil.
//
// Es el "espejo" de PendingLoad cuando el caller necesita los IDs (no solo
// el conteo) — por ejemplo, para mostrarlos en la UI del planificador.
func (s *RouteService) PendingShipments(driverID string, date model.DateOnly) []string {
	route, err := s.repo.GetByDriverAndDate(driverID, date)
	if err != nil {
		return nil
	}
	if route.Status == model.RouteStatusFinished {
		return nil
	}
	var out []string
	for _, tid := range route.ShipmentIDs {
		sh, err := s.shipmentRepo.GetByTrackingID(tid)
		if err != nil {
			continue
		}
		if sh.Status != model.StatusOutForDelivery && sh.Status != model.StatusDeliveryFailed {
			continue
		}
		out = append(out, tid)
	}
	return out
}

// CanAssignToRoute returns an error if the driver has an active route with pending shipments for the given date.
// A route is considered "busy" only if it is active AND has shipments physically with the driver
// (out_for_delivery or delivery_failed). An active route with no such shipments means the driver
// already finished their batch — the system just hasn't auto-closed it yet.
// If a shipment cannot be fetched, it is treated as pending (conservative).
func (s *RouteService) CanAssignToRoute(driverID string, date model.DateOnly) error {
	route, err := s.repo.GetByDriverAndDate(driverID, date)
	if err != nil {
		return nil // no route yet — assignment will create one
	}
	if route.Status != model.RouteStatusActive {
		return nil
	}
	for _, sid := range route.ShipmentIDs {
		sh, err := s.shipmentRepo.GetByTrackingID(sid)
		if err != nil || isDriverActiveStatus(sh.Status) {
			return fmt.Errorf("la ruta del chofer ya está iniciada, no se pueden agregar nuevos envíos")
		}
	}
	return nil
}

// StartRoute sets the driver's today route to active.
func (s *RouteService) StartRoute(driverID string) (model.Route, error) {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil {
		return model.Route{}, fmt.Errorf("no tenés una ruta asignada para hoy")
	}
	if route.Status == model.RouteStatusActive {
		return model.Route{}, fmt.Errorf("la ruta ya está iniciada")
	}
	if route.Status == model.RouteStatusFinished {
		return model.Route{}, fmt.Errorf("la ruta ya finalizó")
	}
	now := clock.Now().UTC()
	if err := s.repo.UpdateStatus(route.ID, model.RouteStatusActive, &now); err != nil {
		return model.Route{}, err
	}
	route.Status = model.RouteStatusActive
	route.StartedAt = &now
	return route, nil
}

// ReopenRoute reactivates a finished route so the driver can start a second run on the same day.
// Called when the driver claims a new last-mile vehicle after completing a previous route.
func (s *RouteService) ReopenRoute(driverID string) error {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil {
		return fmt.Errorf("no tenés una ruta asignada para hoy")
	}
	if route.Status != model.RouteStatusFinished {
		return nil // already active or pending — nothing to do
	}
	return s.repo.UpdateStatus(route.ID, model.RouteStatusActive, route.StartedAt)
}

// CheckAndFinalizeRoute finalizes the route if all shipments reached a terminal delivery state.
// Called after each driver status update; errors are intentionally ignored by callers.
func (s *RouteService) CheckAndFinalizeRoute(driverID string) {
	today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil || route.Status != model.RouteStatusActive {
		return
	}
	for _, id := range route.ShipmentIDs {
		sh, err := s.shipmentRepo.GetByTrackingID(id)
		if err != nil {
			return
		}
		if sh.Status != model.StatusDelivered && sh.Status != model.StatusDeliveryFailed && sh.Status != model.StatusLost {
			return
		}
	}
	_ = s.repo.UpdateStatus(route.ID, model.RouteStatusFinished, route.StartedAt)
}

func generateRouteID() string {
	id := uuid.New().String()
	return fmt.Sprintf("ROUTE-%s", strings.ToUpper(id[:8]))
}
