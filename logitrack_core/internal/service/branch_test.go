package service

import (
	"errors"
	"testing"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

func newBranchSvc() (*BranchService, repository.BranchRepository) {
	repo := repository.NewInMemoryBranchRepository()
	return NewBranchService(repo), repo
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
