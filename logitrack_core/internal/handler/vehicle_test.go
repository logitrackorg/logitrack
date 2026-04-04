package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ─── test setup ──────────────────────────────────────────────────────────────

type vehicleTestSetup struct {
	handler      *VehicleHandler
	vehicleRepo  repository.VehicleRepository
	branchRepo   repository.BranchRepository
	shipmentSvc  *service.ShipmentService
	shipmentRepo repository.ShipmentRepository
}

func newVehicleTestSetup() vehicleTestSetup {
	branchRepo := repository.NewInMemoryBranchRepository()
	cabaBranch := "br-caba"
	cordBranch := "br-cordoba"
	branchRepo.Add(model.Branch{ID: cabaBranch, Name: "CDBA-01", Address: model.Address{City: "Buenos Aires", Province: "CABA"}, Province: "CABA", Status: model.BranchStatusActive})
	branchRepo.Add(model.Branch{ID: cordBranch, Name: "CORD-01", Address: model.Address{City: "Córdoba", Province: "Córdoba"}, Province: "Córdoba", Status: model.BranchStatusActive})

	shipmentRepo := repository.NewInMemoryShipmentRepository()
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	commentSvc := service.NewCommentService(commentRepo, shipmentRepo)
	shipmentSvc := service.NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, nil)

	vehicleRepo := repository.NewInMemoryVehicleRepository()
	h := NewVehicleHandler(vehicleRepo, shipmentSvc, branchRepo)

	return vehicleTestSetup{h, vehicleRepo, branchRepo, shipmentSvc, shipmentRepo}
}

// do sends an HTTP request through a fresh gin router with the supervisor user set.
func (ts *vehicleTestSetup) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.UserKey, model.User{Username: "supervisor1", Role: model.RoleSupervisor})
		c.Next()
	})
	r.POST("/vehicles/:plate/assign", ts.handler.AssignToShipment)
	r.POST("/vehicles/:plate/start-trip", ts.handler.StartTrip)
	r.POST("/vehicles/:plate/end-trip", ts.handler.EndTrip)
	r.DELETE("/vehicles/:plate/shipments/:trackingId", ts.handler.UnassignShipment)

	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// mustAddVehicle adds a vehicle assigned to br-caba with the given capacity.
func (ts *vehicleTestSetup) mustAddVehicle(t *testing.T, plate string, capacityKg float64) {
	t.Helper()
	branchID := "br-caba"
	if err := ts.vehicleRepo.Add(model.Vehicle{
		LicensePlate:   plate,
		Type:           model.VehicleTypeVan,
		CapacityKg:     capacityKg,
		Status:         model.VehicleStatusAvailable,
		AssignedBranch: &branchID,
	}); err != nil {
		t.Fatalf("mustAddVehicle: %v", err)
	}
}

// mustCreateShipment creates a shipment in in_progress at br-caba.
func (ts *vehicleTestSetup) mustCreateShipment(t *testing.T, weightKg float64) model.Shipment {
	t.Helper()
	req := model.CreateShipmentRequest{
		Sender:            model.Customer{DNI: "12345678", Name: "Sender", Address: model.Address{City: "Buenos Aires", Province: "CABA"}},
		Recipient:         model.Customer{DNI: "87654321", Name: "Recipient", Address: model.Address{City: "Córdoba", Province: "Córdoba"}},
		WeightKg:          weightKg,
		PackageType:       model.PackageBox,
		ReceivingBranchID: "br-caba",
		CreatedBy:         "operator",
	}
	s, err := ts.shipmentSvc.Create(req)
	if err != nil {
		t.Fatalf("mustCreateShipment: %v", err)
	}
	return s
}

// getVehicle fetches a vehicle by plate; fails the test if not found.
func (ts *vehicleTestSetup) getVehicle(t *testing.T, plate string) model.Vehicle {
	t.Helper()
	v, found := ts.vehicleRepo.GetByLicensePlate(plate)
	if !found {
		t.Fatalf("vehicle %q not found", plate)
	}
	return v
}

// ─── AssignToShipment ─────────────────────────────────────────────────────────

func TestAssignToShipment_Happy(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Vehicle should be en_carga with the shipment assigned
	v := ts.getVehicle(t, "AB123CD")
	if v.Status != model.VehicleStatusLoading {
		t.Errorf("vehicle status: got %q, want %q", v.Status, model.VehicleStatusLoading)
	}
	if len(v.AssignedShipments) != 1 || v.AssignedShipments[0] != ship.TrackingID {
		t.Errorf("vehicle.AssignedShipments: got %v, want [%s]", v.AssignedShipments, ship.TrackingID)
	}

	// Shipment should be in pre_transit
	updated, err := ts.shipmentSvc.GetByTrackingID(ship.TrackingID)
	if err != nil {
		t.Fatalf("GetByTrackingID: %v", err)
	}
	if updated.Status != model.StatusPreTransit {
		t.Errorf("shipment status: got %q, want %q", updated.Status, model.StatusPreTransit)
	}
}

func TestAssignToShipment_VehicleNotFound(t *testing.T) {
	ts := newVehicleTestSetup()
	ship := ts.mustCreateShipment(t, 10)

	w := ts.do(t, http.MethodPost, "/vehicles/NONEXISTENT/assign",
		gin.H{"tracking_id": ship.TrackingID})

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestAssignToShipment_VehicleNotAvailable(t *testing.T) {
	ts := newVehicleTestSetup()

	// Add vehicle in_transit
	branchID := "br-caba"
	_ = ts.vehicleRepo.Add(model.Vehicle{
		LicensePlate:   "EF456GH",
		Type:           model.VehicleTypeVan,
		CapacityKg:     1000,
		Status:         model.VehicleStatusInTransit,
		AssignedBranch: &branchID,
	})
	ship := ts.mustCreateShipment(t, 10)

	w := ts.do(t, http.MethodPost, "/vehicles/EF456GH/assign",
		gin.H{"tracking_id": ship.TrackingID})

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestAssignToShipment_BranchMismatch(t *testing.T) {
	ts := newVehicleTestSetup()

	// Vehicle assigned to cordoba
	cordBranch := "br-cordoba"
	_ = ts.vehicleRepo.Add(model.Vehicle{
		LicensePlate:   "CD789EF",
		Type:           model.VehicleTypeVan,
		CapacityKg:     1000,
		Status:         model.VehicleStatusAvailable,
		AssignedBranch: &cordBranch,
	})
	// Shipment is at br-caba
	ship := ts.mustCreateShipment(t, 10)

	w := ts.do(t, http.MethodPost, "/vehicles/CD789EF/assign",
		gin.H{"tracking_id": ship.TrackingID})

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestAssignToShipment_CapacityExceeded(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 5)   // 5 kg capacity
	ship := ts.mustCreateShipment(t, 10) // 10 kg shipment

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestAssignToShipment_AlreadyAssigned(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)

	// Assign once
	ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	// Try again
	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

// ─── StartTrip ────────────────────────────────────────────────────────────────

func TestStartTrip_Happy(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)

	// First assign the shipment
	ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/start-trip",
		gin.H{"destination_branch": "br-cordoba"})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	v := ts.getVehicle(t, "AB123CD")
	if v.Status != model.VehicleStatusInTransit {
		t.Errorf("vehicle status: got %q, want %q", v.Status, model.VehicleStatusInTransit)
	}
	if v.DestinationBranch == nil || *v.DestinationBranch != "br-cordoba" {
		t.Errorf("destination branch: got %v, want br-cordoba", v.DestinationBranch)
	}
}

func TestStartTrip_VehicleNotLoading(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000) // disponible, no shipments

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/start-trip",
		gin.H{"destination_branch": "br-cordoba"})

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestStartTrip_NoShipments(t *testing.T) {
	ts := newVehicleTestSetup()
	// Add vehicle in en_carga but without shipments (edge case)
	branchID := "br-caba"
	_ = ts.vehicleRepo.Add(model.Vehicle{
		LicensePlate:   "ZZ999ZZ",
		Type:           model.VehicleTypeVan,
		CapacityKg:     1000,
		Status:         model.VehicleStatusLoading,
		AssignedBranch: &branchID,
	})

	w := ts.do(t, http.MethodPost, "/vehicles/ZZ999ZZ/start-trip",
		gin.H{"destination_branch": "br-cordoba"})

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestStartTrip_SameOriginAndDestination(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)
	ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/start-trip",
		gin.H{"destination_branch": "br-caba"}) // same as current branch

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// ─── EndTrip ──────────────────────────────────────────────────────────────────

func TestEndTrip_Happy(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)

	ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})
	ts.do(t, http.MethodPost, "/vehicles/AB123CD/start-trip",
		gin.H{"destination_branch": "br-cordoba"})

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/end-trip", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	v := ts.getVehicle(t, "AB123CD")
	if v.Status != model.VehicleStatusAvailable {
		t.Errorf("vehicle status: got %q, want %q", v.Status, model.VehicleStatusAvailable)
	}
	if len(v.AssignedShipments) != 0 {
		t.Errorf("expected no assigned shipments after end-trip, got %v", v.AssignedShipments)
	}
	if v.AssignedBranch == nil || *v.AssignedBranch != "br-cordoba" {
		t.Errorf("after end-trip, vehicle should be at destination branch, got %v", v.AssignedBranch)
	}
}

func TestEndTrip_VehicleNotInTransit(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000) // disponible

	w := ts.do(t, http.MethodPost, "/vehicles/AB123CD/end-trip", nil)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

// ─── UnassignShipment ─────────────────────────────────────────────────────────

func TestUnassignShipment_Happy_LastShipmentRestoresAvailable(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)
	ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	path := fmt.Sprintf("/vehicles/AB123CD/shipments/%s", ship.TrackingID)
	w := ts.do(t, http.MethodDelete, path, nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Vehicle should be disponible again with no shipments
	v := ts.getVehicle(t, "AB123CD")
	if v.Status != model.VehicleStatusAvailable {
		t.Errorf("vehicle status: got %q, want %q", v.Status, model.VehicleStatusAvailable)
	}
	if len(v.AssignedShipments) != 0 {
		t.Errorf("expected no assigned shipments, got %v", v.AssignedShipments)
	}
}

func TestUnassignShipment_VehicleNotLoading(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000) // disponible

	w := ts.do(t, http.MethodDelete, "/vehicles/AB123CD/shipments/LT-FAKE0001", nil)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestUnassignShipment_ShipmentNotAssigned(t *testing.T) {
	ts := newVehicleTestSetup()
	ts.mustAddVehicle(t, "AB123CD", 1000)
	ship := ts.mustCreateShipment(t, 10)

	// Assign the shipment to put vehicle in en_carga
	ts.do(t, http.MethodPost, "/vehicles/AB123CD/assign",
		gin.H{"tracking_id": ship.TrackingID})

	// Try to unassign a different shipment
	w := ts.do(t, http.MethodDelete, "/vehicles/AB123CD/shipments/LT-NOTEXIST", nil)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}
