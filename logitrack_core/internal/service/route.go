package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
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
	today := model.NewDateOnly(time.Now().UTC())
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
		return sh.DeliveredAt != nil && model.NewDateOnly(*sh.DeliveredAt).Equal(routeDate)
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
		CreatedAt:   time.Now().UTC(),
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
			CreatedAt:   time.Now().UTC(),
			Status:      model.RouteStatusPending,
		}
		_, err = s.repo.Create(newRoute)
		return err
	}
	if route.Status == model.RouteStatusActive {
		return fmt.Errorf("la ruta ya está iniciada, no se pueden agregar nuevos envíos")
	}
	if route.Status == model.RouteStatusFinished {
		// Nueva tanda de envíos después de una ruta finalizada — reabre para que el chofer la inicie de nuevo.
		// Purge shipments that are already in a terminal delivery state so they don't bleed into the new batch.
		active := route.ShipmentIDs[:0]
		for _, sid := range route.ShipmentIDs {
			sh, err := s.shipmentRepo.GetByTrackingID(sid)
			if err != nil || isDriverActiveStatus(sh.Status) {
				active = append(active, sid)
			}
		}
		route.ShipmentIDs = active
		route.Status = model.RouteStatusPending
		route.StartedAt = nil
	}
	if route.HasShipment(trackingID) {
		return nil
	}
	route.ShipmentIDs = append(route.ShipmentIDs, trackingID)
	return s.repo.Update(route)
}

func (s *RouteService) RemoveShipmentFromTodayRoute(trackingID string) error {
	today := model.NewDateOnly(time.Now().UTC())
	return s.repo.RemoveShipmentFromDate(trackingID, today)
}

func (s *RouteService) ValidateDriverCanUpdateShipment(driverID, trackingID string, status model.Status) error {
	today := model.NewDateOnly(time.Now().UTC())
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
	if status != model.StatusDelivered && status != model.StatusDeliveryFailed && status != model.StatusLost {
		return fmt.Errorf("los choferes solo pueden marcar envíos como entregado, fallo de entrega o extraviado")
	}
	return nil
}

// CanAssignToRoute returns an error if the driver already has an active route for the given date.
func (s *RouteService) CanAssignToRoute(driverID string, date model.DateOnly) error {
	route, err := s.repo.GetByDriverAndDate(driverID, date)
	if err != nil {
		return nil // no route yet — assignment will create one
	}
	if route.Status == model.RouteStatusActive {
		return fmt.Errorf("la ruta del chofer ya está iniciada, no se pueden agregar nuevos envíos")
	}
	return nil
}

// StartRoute sets the driver's today route to active.
func (s *RouteService) StartRoute(driverID string) (model.Route, error) {
	today := model.NewDateOnly(time.Now().UTC())
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
	now := time.Now().UTC()
	if err := s.repo.UpdateStatus(route.ID, model.RouteStatusActive, &now); err != nil {
		return model.Route{}, err
	}
	route.Status = model.RouteStatusActive
	route.StartedAt = &now
	return route, nil
}

// CheckAndFinalizeRoute finalizes the route if all shipments reached a terminal delivery state.
// Called after each driver status update; errors are intentionally ignored by callers.
func (s *RouteService) CheckAndFinalizeRoute(driverID string) {
	today := model.NewDateOnly(time.Now().UTC())
	route, err := s.repo.GetByDriverAndDate(driverID, today)
	if err != nil || route.Status != model.RouteStatusActive || len(route.ShipmentIDs) == 0 {
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
