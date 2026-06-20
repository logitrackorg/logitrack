package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func newTestOrgService() *OrganizationService {
	return NewOrganizationService(repository.NewInMemoryOrganizationRepository())
}

func TestOrgService_Update_ValidFont(t *testing.T) {
	svc := newTestOrgService()
	cfg := model.OrganizationConfig{Name: "Test", FontFamily: "Roboto"}
	result, err := svc.Update(cfg, "testuser")
	if err != nil {
		t.Fatalf("expected no error for valid font, got: %v", err)
	}
	if result.FontFamily != "Roboto" {
		t.Errorf("expected FontFamily=Roboto, got %s", result.FontFamily)
	}
	if result.Name != "Test" {
		t.Errorf("expected Name=Test, got %s", result.Name)
	}
}

func TestOrgService_Update_EmptyFont(t *testing.T) {
	svc := newTestOrgService()
	cfg := model.OrganizationConfig{Name: "Test", FontFamily: ""}
	result, err := svc.Update(cfg, "testuser")
	if err != nil {
		t.Fatalf("expected no error for empty font, got: %v", err)
	}
	if result.FontFamily != "" {
		t.Errorf("expected FontFamily=\"\", got %s", result.FontFamily)
	}
}

func TestOrgService_Update_InvalidFont(t *testing.T) {
	svc := newTestOrgService()
	cfg := model.OrganizationConfig{Name: "Test", FontFamily: "Comic Sans"}
	_, err := svc.Update(cfg, "testuser")
	if err == nil {
		t.Fatal("expected error for invalid font, got nil")
	}
}

func TestOrgService_Update_FontPersisted(t *testing.T) {
	svc := newTestOrgService()
	cfg := model.OrganizationConfig{Name: "Test", FontFamily: "IBM Plex Sans"}
	_, err := svc.Update(cfg, "testuser")
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	got, err := svc.Get()
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.FontFamily != "IBM Plex Sans" {
		t.Errorf("expected FontFamily=IBM Plex Sans from Get, got %s", got.FontFamily)
	}
}
