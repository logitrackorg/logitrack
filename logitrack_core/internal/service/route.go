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

// isVisibleForDriver returns true for shipments the driver should see on their route:
// - actively in delivering or delivery_failed
// - delivered on the same day as the route (visible until the day rolls over)
func isVisibleForDriver(sh model.Shipment, routeDate model.DateOnly) bool {
	switch sh.Status {
	case model.StatusDelivering, model.StatusDeliveryFailed:
		return true
	case model.StatusDelivered:
		return sh.DeliveredAt != nil && model.NewDateOnly(*sh.DeliveredAt).Equal(routeDate)
	}
	return false
}

func isDriverActiveStatus(s model.Status) bool {
	return s == model.StatusDelivering || s == model.StatusDeliveryFailed
}

func (s *RouteService) Create(req model.CreateRouteRequest, createdBy string) (model.Route, error) {
	t, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		return model.Route{}, fmt.Errorf("invalid date format, use YYYY-MM-DD")
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
		return fmt.Errorf("no route assigned for today")
	}
	if !route.HasShipment(trackingID) {
		return fmt.Errorf("shipment not in your route")
	}
	if status != model.StatusDelivered && status != model.StatusDeliveryFailed {
		return fmt.Errorf("drivers can only mark shipments as delivered or delivery_failed")
	}
	return nil
}

func generateRouteID() string {
	id := uuid.New().String()
	return fmt.Sprintf("ROUTE-%s", strings.ToUpper(id[:8]))
}
