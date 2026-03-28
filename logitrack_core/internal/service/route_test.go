package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func newRouteSetup(t *testing.T) (*RouteService, testSetup, repository.RouteRepository) {
	t.Helper()
	ts := newSetup()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)
	return routeSvc, ts, routeRepo
}

func todayRoute(driverID string, shipmentIDs []string) model.Route {
	return model.Route{
		ID:          "ROUTE-TEST01",
		Date:        model.NewDateOnly(time.Now().UTC()),
		DriverID:    driverID,
		ShipmentIDs: shipmentIDs,
		CreatedBy:   "supervisor",
		CreatedAt:   time.Now().UTC(),
	}
}

// ─── ValidateDriverCanUpdateShipment ─────────────────────────────────────────

func TestValidateDriver_NoRoute(t *testing.T) {
	routeRepo := repository.NewInMemoryRouteRepository()
	ts := newSetup()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)
	err := routeSvc.ValidateDriverCanUpdateShipment("driver-01", "LT-XXXXXXX1", model.StatusDelivered)
	if err == nil || err.Error() != "no route assigned for today" {
		t.Errorf("expected no-route error, got: %v", err)
	}
}

func TestValidateDriver_ShipmentNotInRoute(t *testing.T) {
	_, ts, _ := newRouteSetup(t)
	ship := mustCreate(t, ts)

	// Create a route that does NOT include the shipment
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc2 := NewRouteService(routeRepo, ts.shipmentRepo)
	routeRepo.Create(todayRoute("driver-01", []string{"LT-OTHER000"}))

	err := routeSvc2.ValidateDriverCanUpdateShipment("driver-01", ship.TrackingID, model.StatusDelivered)
	if err == nil || err.Error() != "shipment not in your route" {
		t.Errorf("expected shipment-not-in-route error, got: %v", err)
	}
}

func TestValidateDriver_InvalidStatus(t *testing.T) {
	ts := newSetup()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)

	ship := mustCreate(t, ts)
	routeRepo.Create(todayRoute("driver-01", []string{ship.TrackingID}))

	invalidStatuses := []model.Status{
		model.StatusInTransit,
		model.StatusAtBranch,
		model.StatusDelivering,
		model.StatusCancelled,
	}
	for _, status := range invalidStatuses {
		err := routeSvc.ValidateDriverCanUpdateShipment("driver-01", ship.TrackingID, status)
		if err == nil || err.Error() != "drivers can only mark shipments as delivered or delivery_failed" {
			t.Errorf("status %s: expected invalid-status error, got: %v", status, err)
		}
	}
}

func TestValidateDriver_ValidStatuses(t *testing.T) {
	ts := newSetup()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)

	ship := mustCreate(t, ts)
	routeRepo.Create(todayRoute("driver-01", []string{ship.TrackingID}))

	for _, status := range []model.Status{model.StatusDelivered, model.StatusDeliveryFailed} {
		err := routeSvc.ValidateDriverCanUpdateShipment("driver-01", ship.TrackingID, status)
		if err != nil {
			t.Errorf("status %s should be allowed for driver, got: %v", status, err)
		}
	}
}

// ─── AddShipmentToDriverRoute ─────────────────────────────────────────────────

func TestAddShipmentToDriverRoute_CreatesRouteWhenNoneExists(t *testing.T) {
	ts := newSetup()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)

	ship := mustCreate(t, ts)
	today := model.NewDateOnly(time.Now().UTC())

	err := routeSvc.AddShipmentToDriverRoute("driver-01", ship.TrackingID, today)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	route, err := routeRepo.GetByDriverAndDate("driver-01", today)
	if err != nil {
		t.Fatalf("route not found: %v", err)
	}
	if !route.HasShipment(ship.TrackingID) {
		t.Errorf("shipment %q not found in newly created route", ship.TrackingID)
	}
}

func TestAddShipmentToDriverRoute_AppendsToExistingRoute(t *testing.T) {
	ts := newSetup()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)

	ship1 := mustCreate(t, ts)
	ship2 := mustCreate(t, ts)
	today := model.NewDateOnly(time.Now().UTC())

	// Seed a route with ship1
	routeRepo.Create(todayRoute("driver-01", []string{ship1.TrackingID}))

	// Add ship2 via AddShipmentToDriverRoute
	err := routeSvc.AddShipmentToDriverRoute("driver-01", ship2.TrackingID, today)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	route, _ := routeRepo.GetByDriverAndDate("driver-01", today)
	if !route.HasShipment(ship1.TrackingID) || !route.HasShipment(ship2.TrackingID) {
		t.Errorf("route should contain both shipments, got %v", route.ShipmentIDs)
	}
}

func TestAddShipmentToDriverRoute_Idempotent(t *testing.T) {
	ts := newSetup()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, ts.shipmentRepo)

	ship := mustCreate(t, ts)
	today := model.NewDateOnly(time.Now().UTC())

	routeRepo.Create(todayRoute("driver-01", []string{ship.TrackingID}))

	// Adding the same shipment twice should not duplicate it
	routeSvc.AddShipmentToDriverRoute("driver-01", ship.TrackingID, today)
	routeSvc.AddShipmentToDriverRoute("driver-01", ship.TrackingID, today)

	route, _ := routeRepo.GetByDriverAndDate("driver-01", today)
	count := 0
	for _, id := range route.ShipmentIDs {
		if id == ship.TrackingID {
			count++
		}
	}
	if count != 1 {
		t.Errorf("shipment appears %d times in route, want 1", count)
	}
}

// ─── Create route ─────────────────────────────────────────────────────────────

func TestRouteCreate_InvalidDateFormat(t *testing.T) {
	routeSvc, _, _ := newRouteSetup(t)
	_, err := routeSvc.Create(model.CreateRouteRequest{
		Date:        "28-03-2026", // wrong format
		DriverID:    "driver-01",
		ShipmentIDs: []string{},
	}, "supervisor")
	if err == nil || err.Error() != "invalid date format, use YYYY-MM-DD" {
		t.Errorf("expected date format error, got: %v", err)
	}
}

func TestRouteCreate_ValidRequest(t *testing.T) {
	routeSvc, _, _ := newRouteSetup(t)
	route, err := routeSvc.Create(model.CreateRouteRequest{
		Date:        "2026-03-28",
		DriverID:    "driver-01",
		ShipmentIDs: []string{"LT-ABC12345"},
	}, "supervisor")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if route.DriverID != "driver-01" {
		t.Errorf("driverID = %q, want driver-01", route.DriverID)
	}
	if !hasPrefix(route.ID, "ROUTE-") {
		t.Errorf("route ID = %q, want ROUTE- prefix", route.ID)
	}
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// ─── GetTodayRoute (TC-29–TC-32) ─────────────────────────────────────────────

func TestGetTodayRoute_NoRoute(t *testing.T) {
	routeSvc, _, _ := newRouteSetup(t)

	_, _, err := routeSvc.GetTodayRoute("driver-99")
	if err == nil {
		t.Error("expected error for driver with no route, got nil")
	}
}

func TestGetTodayRoute_ReturnsRouteAndShipmentDetails(t *testing.T) {
	routeSvc, ts, routeRepo := newRouteSetup(t)

	ship1 := mustCreate(t, ts)
	ship2 := mustCreate(t, ts)
	today := model.NewDateOnly(time.Now().UTC())

	routeRepo.Create(model.Route{
		ID:          "ROUTE-TEST42",
		Date:        today,
		DriverID:    "driver-01",
		ShipmentIDs: []string{ship1.TrackingID, ship2.TrackingID},
		CreatedBy:   "supervisor",
		CreatedAt:   time.Now().UTC(),
	})

	route, shipments, err := routeSvc.GetTodayRoute("driver-01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if route.DriverID != "driver-01" {
		t.Errorf("driverID = %q, want driver-01", route.DriverID)
	}
	if len(shipments) != 2 {
		t.Errorf("got %d shipments, want 2", len(shipments))
	}
	ids := make(map[string]bool)
	for _, s := range shipments {
		ids[s.TrackingID] = true
	}
	if !ids[ship1.TrackingID] || !ids[ship2.TrackingID] {
		t.Errorf("expected both shipments in route result, got ids: %v", ids)
	}
}

func TestGetTodayRoute_OnlyTodaysRoute(t *testing.T) {
	routeSvc, ts, routeRepo := newRouteSetup(t)

	ship := mustCreate(t, ts)
	yesterday := model.NewDateOnly(time.Now().UTC().AddDate(0, 0, -1))

	routeRepo.Create(model.Route{
		ID:          "ROUTE-YEST01",
		Date:        yesterday,
		DriverID:    "driver-01",
		ShipmentIDs: []string{ship.TrackingID},
		CreatedBy:   "supervisor",
		CreatedAt:   time.Now().UTC().AddDate(0, 0, -1),
	})

	_, _, err := routeSvc.GetTodayRoute("driver-01")
	if err == nil {
		t.Error("expected no-route error for today when only a yesterday route exists")
	}
}

func TestGetTodayRoute_IgnoresMissingShipments(t *testing.T) {
	routeSvc, ts, routeRepo := newRouteSetup(t)

	ship := mustCreate(t, ts)
	today := model.NewDateOnly(time.Now().UTC())

	routeRepo.Create(model.Route{
		ID:          "ROUTE-TEST99",
		Date:        today,
		DriverID:    "driver-01",
		ShipmentIDs: []string{ship.TrackingID, "LT-GHOST0001"}, // ghost ID does not exist
		CreatedBy:   "supervisor",
		CreatedAt:   time.Now().UTC(),
	})

	_, shipments, err := routeSvc.GetTodayRoute("driver-01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(shipments) != 1 || shipments[0].TrackingID != ship.TrackingID {
		t.Errorf("expected only the existing shipment, got %v", shipments)
	}
}
