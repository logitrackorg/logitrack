package repository

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

func TestInMemoryOrgRepo_Get_Empty(t *testing.T) {
	repo := NewInMemoryOrganizationRepository()
	_, err := repo.Get()
	if err == nil {
		t.Fatal("expected error for empty repo, got nil")
	}
}

func TestInMemoryOrgRepo_UpsertAndGet(t *testing.T) {
	repo := NewInMemoryOrganizationRepository()
	cfg := model.OrganizationConfig{Name: "Test", FontFamily: "Inter"}
	saved, err := repo.Upsert(cfg)
	if err != nil {
		t.Fatalf("upsert failed: %v", err)
	}
	if saved.Name != "Test" {
		t.Fatalf("expected Name=Test, got %s", saved.Name)
	}
	got, err := repo.Get()
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.FontFamily != "Inter" {
		t.Fatalf("expected FontFamily=Inter, got %s", got.FontFamily)
	}
}

func TestInMemoryOrgRepo_Upsert_FontFamily(t *testing.T) {
	repo := NewInMemoryOrganizationRepository()
	cfg := model.OrganizationConfig{Name: "Test", FontFamily: "IBM Plex Sans"}
	repo.Upsert(cfg)
	got, _ := repo.Get()
	if got.FontFamily != "IBM Plex Sans" {
		t.Fatalf("expected FontFamily='IBM Plex Sans', got %s", got.FontFamily)
	}
}

func TestInMemoryOrgRepo_Upsert_Overwrite(t *testing.T) {
	repo := NewInMemoryOrganizationRepository()
	cfg1 := model.OrganizationConfig{Name: "First", FontFamily: "Inter"}
	cfg2 := model.OrganizationConfig{Name: "Second", FontFamily: "Roboto"}
	repo.Upsert(cfg1)
	repo.Upsert(cfg2)
	got, _ := repo.Get()
	if got.Name != "Second" {
		t.Fatalf("expected Name=Second after overwrite, got %s", got.Name)
	}
	if got.FontFamily != "Roboto" {
		t.Fatalf("expected FontFamily=Roboto after overwrite, got %s", got.FontFamily)
	}
}
