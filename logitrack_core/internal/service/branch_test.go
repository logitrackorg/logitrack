package service

import (
	"errors"
	"testing"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

type stubCounter struct{ n int }

func (s *stubCounter) CountActiveByBranch(string) int { return s.n }

func newBranchSvc() (*BranchService, repository.BranchRepository) {
	repo := repository.NewInMemoryBranchRepository()
	return NewBranchService(repo, &stubCounter{0}), repo
}

func newBranchSvcWithActiveShipments(n int) (*BranchService, repository.BranchRepository) {
	repo := repository.NewInMemoryBranchRepository()
	return NewBranchService(repo, &stubCounter{n}), repo
}

func defaultCreateBranchReq() model.CreateBranchRequest {
	return model.CreateBranchRequest{
		Name:       "TEST-01",
		Street:     "Calle Falsa 123",
		City:       "Buenos Aires",
		Province:   "Buenos Aires",
		PostalCode: "C1000",
	}
}

// mustAddBranch adds a branch directly via the repo (bypasses service validation).
func mustAddBranch(t *testing.T, repo repository.BranchRepository, id string, status model.BranchStatus) model.Branch {
	t.Helper()
	b := model.Branch{
		ID:       id,
		Name:     "BRANCH-" + id,
		Address:  model.Address{Street: "Calle 1", City: "Ciudad", Province: "Prov", PostalCode: "1000"},
		Province: "Prov",
		Status:   status,
	}
	repo.Add(b)
	return b
}

// mustAddBranchWithCapacity is like mustAddBranch but sets a specific max_capacity.
func mustAddBranchWithCapacity(t *testing.T, repo repository.BranchRepository, id string, status model.BranchStatus, maxCap int) model.Branch {
	t.Helper()
	b := model.Branch{
		ID:          id,
		Name:        "BRANCH-" + id,
		Address:     model.Address{Street: "Calle 1", City: "Ciudad", Province: "Prov", PostalCode: "1000"},
		Province:    "Prov",
		Status:      status,
		MaxCapacity: maxCap,
	}
	repo.Add(b)
	return b
}

// ─── Create ──────────────────────────────────────────────────────────────────

func TestBranchCreate_GeneratesID(t *testing.T) {
	svc, _ := newBranchSvc()
	b, err := svc.Create(defaultCreateBranchReq())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.ID == "" {
		t.Error("expected non-empty ID, got empty string")
	}
}

func TestBranchCreate_FieldsPersistedCorrectly(t *testing.T) {
	svc, _ := newBranchSvc()
	req := defaultCreateBranchReq()

	b, err := svc.Create(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if b.Name != req.Name {
		t.Errorf("name: got %q, want %q", b.Name, req.Name)
	}
	if b.Address.City != req.City {
		t.Errorf("city: got %q, want %q", b.Address.City, req.City)
	}
	if b.Address.Street != req.Street {
		t.Errorf("street: got %q, want %q", b.Address.Street, req.Street)
	}
	if b.Status != model.BranchStatusActive {
		t.Errorf("status: got %q, want %q", b.Status, model.BranchStatusActive)
	}
}

func TestBranchCreate_CustomID(t *testing.T) {
	svc, _ := newBranchSvc()
	req := defaultCreateBranchReq()
	req.ID = "my-custom-id"
	b, err := svc.Create(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.ID != "my-custom-id" {
		t.Errorf("ID: got %q, want %q", b.ID, "my-custom-id")
	}
}

func TestBranchCreate_DuplicateName(t *testing.T) {
	svc, _ := newBranchSvc()
	if _, err := svc.Create(defaultCreateBranchReq()); err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err := svc.Create(defaultCreateBranchReq())
	if !errors.Is(err, ErrBranchDuplicateName) {
		t.Errorf("expected ErrBranchDuplicateName, got: %v", err)
	}
}

func TestBranchCreate_ValidationErrors(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(r *model.CreateBranchRequest)
	}{
		{"empty name", func(r *model.CreateBranchRequest) { r.Name = "" }},
		{"empty street", func(r *model.CreateBranchRequest) { r.Street = "" }},
		{"empty city", func(r *model.CreateBranchRequest) { r.City = "" }},
		{"empty province", func(r *model.CreateBranchRequest) { r.Province = "" }},
		{"empty postal code", func(r *model.CreateBranchRequest) { r.PostalCode = "" }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := newBranchSvc()
			req := defaultCreateBranchReq()
			tc.mutate(&req)
			_, err := svc.Create(req)
			if err == nil {
				t.Error("expected validation error, got nil")
			}
		})
	}
}

// ─── Update ──────────────────────────────────────────────────────────────────

func TestBranchUpdate_Happy(t *testing.T) {
	svc, repo := newBranchSvc()
	mustAddBranch(t, repo, "b1", model.BranchStatusActive)

	req := model.UpdateBranchRequest{
		Name:       "UPDATED-01",
		Street:     "Nueva Calle 999",
		City:       "Rosario",
		Province:   "Santa Fe",
		PostalCode: "S2000",
	}

	b, err := svc.Update("b1", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.Name != "UPDATED-01" {
		t.Errorf("name: got %q, want %q", b.Name, "UPDATED-01")
	}
	if b.Address.City != "Rosario" {
		t.Errorf("city: got %q, want %q", b.Address.City, "Rosario")
	}
}

func TestBranchUpdate_NotFound(t *testing.T) {
	svc, _ := newBranchSvc()
	req := model.UpdateBranchRequest{
		Name: "X", Street: "X", City: "X", Province: "X", PostalCode: "X",
	}
	_, err := svc.Update("nonexistent", req)
	if !errors.Is(err, ErrBranchNotFound) {
		t.Errorf("expected ErrBranchNotFound, got: %v", err)
	}
}

func TestBranchUpdate_InactiveBranch(t *testing.T) {
	svc, repo := newBranchSvc()
	mustAddBranch(t, repo, "b2", model.BranchStatusInactive)

	req := model.UpdateBranchRequest{
		Name: "X", Street: "X", City: "X", Province: "X", PostalCode: "X",
	}
	_, err := svc.Update("b2", req)
	if !errors.Is(err, ErrBranchNotActive) {
		t.Errorf("expected ErrBranchNotActive, got: %v", err)
	}
}

func TestBranchUpdate_DuplicateName(t *testing.T) {
	svc, repo := newBranchSvc()
	mustAddBranch(t, repo, "b1", model.BranchStatusActive)
	mustAddBranch(t, repo, "b2", model.BranchStatusActive)

	req := model.UpdateBranchRequest{
		Name:       "BRANCH-b1", // same as b1
		Street:     "Otra Calle",
		City:       "Mendoza",
		Province:   "Mendoza",
		PostalCode: "M5000",
	}
	_, err := svc.Update("b2", req)
	if !errors.Is(err, ErrBranchDuplicateName) {
		t.Errorf("expected ErrBranchDuplicateName, got: %v", err)
	}
}

// ─── UpdateStatus ─────────────────────────────────────────────────────────────

func TestBranchUpdateStatus_Happy(t *testing.T) {
	svc, repo := newBranchSvc()
	mustAddBranch(t, repo, "b1", model.BranchStatusActive)

	req := model.UpdateBranchStatusRequest{Status: model.BranchStatusInactive}
	b, err := svc.UpdateStatus("b1", req, "admin1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.Status != model.BranchStatusInactive {
		t.Errorf("status: got %q, want %q", b.Status, model.BranchStatusInactive)
	}
}

func TestBranchUpdateStatus_NotFound(t *testing.T) {
	svc, _ := newBranchSvc()
	req := model.UpdateBranchStatusRequest{Status: model.BranchStatusInactive}
	_, err := svc.UpdateStatus("nonexistent", req, "admin1")
	if !errors.Is(err, ErrBranchNotFound) {
		t.Errorf("expected ErrBranchNotFound, got: %v", err)
	}
}

func TestBranchUpdateStatus_InvalidStatus(t *testing.T) {
	svc, repo := newBranchSvc()
	mustAddBranch(t, repo, "b1", model.BranchStatusActive)

	req := model.UpdateBranchStatusRequest{Status: "bogus_status"}
	_, err := svc.UpdateStatus("b1", req, "admin1")
	if err == nil {
		t.Error("expected error for invalid status, got nil")
	}
}

func TestBranchUpdateStatus_BlockedByActiveShipments(t *testing.T) {
	svc, repo := newBranchSvcWithActiveShipments(3)
	mustAddBranch(t, repo, "b1", model.BranchStatusActive)

	req := model.UpdateBranchStatusRequest{Status: model.BranchStatusOutOfService}
	_, err := svc.UpdateStatus("b1", req, "admin1")
	if !errors.Is(err, ErrBranchHasActiveShipments) {
		t.Errorf("expected ErrBranchHasActiveShipments, got: %v", err)
	}
}

func TestBranchUpdateStatus_ForceOverridesActiveShipments(t *testing.T) {
	svc, repo := newBranchSvcWithActiveShipments(3)
	mustAddBranch(t, repo, "b1", model.BranchStatusActive)

	req := model.UpdateBranchStatusRequest{Status: model.BranchStatusOutOfService, Force: true}
	b, err := svc.UpdateStatus("b1", req, "admin1")
	if err != nil {
		t.Fatalf("unexpected error with force=true: %v", err)
	}
	if b.Status != model.BranchStatusOutOfService {
		t.Errorf("status: got %q, want %q", b.Status, model.BranchStatusOutOfService)
	}
}

func TestBranchUpdateStatus_ActiveToActiveNotBlocked(t *testing.T) {
	svc, repo := newBranchSvcWithActiveShipments(5)
	mustAddBranch(t, repo, "b1", model.BranchStatusInactive)

	req := model.UpdateBranchStatusRequest{Status: model.BranchStatusActive}
	_, err := svc.UpdateStatus("b1", req, "admin1")
	if err != nil {
		t.Fatalf("reactivation should not be blocked: %v", err)
	}
}

// ─── ListActive ───────────────────────────────────────────────────────────────

func TestBranchListActive_FiltersInactive(t *testing.T) {
	svc, repo := newBranchSvc()
	mustAddBranch(t, repo, "active1", model.BranchStatusActive)
	mustAddBranch(t, repo, "active2", model.BranchStatusActive)
	mustAddBranch(t, repo, "inactive1", model.BranchStatusInactive)
	mustAddBranch(t, repo, "oos1", model.BranchStatusOutOfService)

	active := svc.ListActive()
	if len(active) != 2 {
		t.Errorf("ListActive: got %d branches, want 2", len(active))
	}
	for _, b := range active {
		if b.Status != model.BranchStatusActive {
			t.Errorf("ListActive returned non-active branch: %s (status %s)", b.ID, b.Status)
		}
	}
}

// ─── Search ───────────────────────────────────────────────────────────────────

func TestBranchSearch_ByName(t *testing.T) {
	svc, _ := newBranchSvc()
	svc.Create(model.CreateBranchRequest{Name: "CDBA-01", Street: "Av. Corrientes 1", City: "Buenos Aires", Province: "Buenos Aires", PostalCode: "C1000"})
	svc.Create(model.CreateBranchRequest{Name: "CORD-01", Street: "Av. Colón 2", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"})

	results := svc.Search("CDBA")
	if len(results) != 1 || results[0].Name != "CDBA-01" {
		t.Errorf("Search('CDBA'): got %v", results)
	}
}

func TestBranchSearch_ByCity(t *testing.T) {
	svc, _ := newBranchSvc()
	svc.Create(model.CreateBranchRequest{Name: "CDBA-01", Street: "Av. Corrientes 1", City: "Buenos Aires", Province: "Buenos Aires", PostalCode: "C1000"})
	svc.Create(model.CreateBranchRequest{Name: "CORD-01", Street: "Av. Colón 2", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"})

	results := svc.Search("córdoba")
	if len(results) != 1 || results[0].Name != "CORD-01" {
		t.Errorf("Search('córdoba'): got %v", results)
	}
}

func TestBranchSearch_EmptyQueryReturnsAll(t *testing.T) {
	svc, _ := newBranchSvc()
	svc.Create(model.CreateBranchRequest{Name: "B1", Street: "S1", City: "C1", Province: "P1", PostalCode: "1000"})
	svc.Create(model.CreateBranchRequest{Name: "B2", Street: "S2", City: "C2", Province: "P2", PostalCode: "2000"})

	results := svc.Search("")
	if len(results) != 2 {
		t.Errorf("Search(''): got %d results, want 2", len(results))
	}
}

// ─── Create — max_capacity ────────────────────────────────────────────────────

func TestBranchCreate_DefaultMaxCapacity(t *testing.T) {
	svc, _ := newBranchSvc()
	b, err := svc.Create(defaultCreateBranchReq())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.MaxCapacity != 50 {
		t.Errorf("max_capacity: got %d, want 50 (default)", b.MaxCapacity)
	}
}

func TestBranchCreate_ExplicitMaxCapacity(t *testing.T) {
	svc, _ := newBranchSvc()
	req := defaultCreateBranchReq()
	req.MaxCapacity = 120
	b, err := svc.Create(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.MaxCapacity != 120 {
		t.Errorf("max_capacity: got %d, want 120", b.MaxCapacity)
	}
}

func TestBranchCreate_NegativeMaxCapacityDefaultsTo50(t *testing.T) {
	svc, _ := newBranchSvc()
	req := defaultCreateBranchReq()
	req.MaxCapacity = -10
	b, err := svc.Create(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if b.MaxCapacity != 50 {
		t.Errorf("max_capacity: got %d, want 50 (default for negative)", b.MaxCapacity)
	}
}

// ─── Update — max_capacity ────────────────────────────────────────────────────

func TestBranchUpdate_MaxCapacityChanged(t *testing.T) {
	svc, repo := newBranchSvc()
	b := mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 30)

	req := model.UpdateBranchRequest{
		Name:        b.Name,
		Street:      b.Address.Street,
		City:        b.Address.City,
		Province:    b.Province,
		PostalCode:  b.Address.PostalCode,
		MaxCapacity: 75,
	}
	updated, err := svc.Update("b1", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.MaxCapacity != 75 {
		t.Errorf("max_capacity: got %d, want 75", updated.MaxCapacity)
	}
}

func TestBranchUpdate_ZeroMaxCapacityPreservesExisting(t *testing.T) {
	svc, repo := newBranchSvc()
	b := mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 30)

	req := model.UpdateBranchRequest{
		Name:        b.Name,
		Street:      b.Address.Street,
		City:        b.Address.City,
		Province:    b.Province,
		PostalCode:  b.Address.PostalCode,
		MaxCapacity: 0,
	}
	updated, err := svc.Update("b1", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.MaxCapacity != 30 {
		t.Errorf("max_capacity: got %d, want 30 (preserved on zero)", updated.MaxCapacity)
	}
}

// ─── GetCapacity ──────────────────────────────────────────────────────────────

func TestGetCapacity_NotFound(t *testing.T) {
	svc, _ := newBranchSvc()
	_, err := svc.GetCapacity("nonexistent")
	if !errors.Is(err, ErrBranchNotFound) {
		t.Errorf("expected ErrBranchNotFound, got: %v", err)
	}
}

func TestGetCapacity_ZeroOccupancy(t *testing.T) {
	repo := repository.NewInMemoryBranchRepository()
	svc := NewBranchService(repo, &stubCounter{0})
	mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 10)

	cap, err := svc.GetCapacity("b1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.Current != 0 {
		t.Errorf("current: got %d, want 0", cap.Current)
	}
	if cap.MaxCapacity != 10 {
		t.Errorf("max_capacity: got %d, want 10", cap.MaxCapacity)
	}
	if cap.Percentage != 0 {
		t.Errorf("percentage: got %v, want 0", cap.Percentage)
	}
	if cap.Alert {
		t.Error("alert: got true, want false")
	}
}

func TestGetCapacity_PartialOccupancy(t *testing.T) {
	repo := repository.NewInMemoryBranchRepository()
	svc := NewBranchService(repo, &stubCounter{5})
	mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 10)

	cap, err := svc.GetCapacity("b1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.Current != 5 {
		t.Errorf("current: got %d, want 5", cap.Current)
	}
	if cap.Percentage != 50 {
		t.Errorf("percentage: got %v, want 50", cap.Percentage)
	}
	if cap.Alert {
		t.Error("alert: got true, want false at 50%")
	}
}

func TestGetCapacity_AlertTriggersAtEightyPercent(t *testing.T) {
	repo := repository.NewInMemoryBranchRepository()
	svc := NewBranchService(repo, &stubCounter{8})
	mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 10)

	cap, err := svc.GetCapacity("b1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cap.Alert {
		t.Errorf("alert: got false, want true at 80%%")
	}
}

func TestGetCapacity_BelowAlertThreshold(t *testing.T) {
	repo := repository.NewInMemoryBranchRepository()
	svc := NewBranchService(repo, &stubCounter{7})
	mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 10)

	cap, err := svc.GetCapacity("b1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.Alert {
		t.Errorf("alert: got true, want false at 70%%")
	}
}

func TestGetCapacity_OverCapacity(t *testing.T) {
	repo := repository.NewInMemoryBranchRepository()
	svc := NewBranchService(repo, &stubCounter{15})
	mustAddBranchWithCapacity(t, repo, "b1", model.BranchStatusActive, 10)

	cap, err := svc.GetCapacity("b1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.Current != 15 {
		t.Errorf("current: got %d, want 15", cap.Current)
	}
	if cap.Percentage != 150 {
		t.Errorf("percentage: got %v, want 150", cap.Percentage)
	}
	if !cap.Alert {
		t.Error("alert: got false, want true when over capacity")
	}
}

func TestGetCapacity_ZeroBranchMaxCapacityDefaultsTo50(t *testing.T) {
	repo := repository.NewInMemoryBranchRepository()
	svc := NewBranchService(repo, &stubCounter{0})
	mustAddBranch(t, repo, "b1", model.BranchStatusActive) // MaxCapacity=0 (zero value)

	cap, err := svc.GetCapacity("b1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cap.MaxCapacity != 50 {
		t.Errorf("max_capacity: got %d, want 50 (default for zero)", cap.MaxCapacity)
	}
}
