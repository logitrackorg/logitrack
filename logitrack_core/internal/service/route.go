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
		}
		_, err = s.repo.Create(newRoute)
		return err
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
	if !route.HasShipment(trackingID) {
		return fmt.Errorf("el envío no está en tu ruta")
	}
	if status != model.StatusDelivered && status != model.StatusDeliveryFailed && status != model.StatusLost {
		return fmt.Errorf("los choferes solo pueden marcar envíos como entregado, fallo de entrega o extraviado")
	}
	return nil
}

func generateRouteID() string {
	id := uuid.New().String()
	return fmt.Sprintf("ROUTE-%s", strings.ToUpper(id[:8]))
}
