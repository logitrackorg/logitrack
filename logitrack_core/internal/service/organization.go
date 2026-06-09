package service

import (
	"errors"
	"regexp"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// hexColorRe valida un color hexadecimal de 6 dígitos (ej: #2563eb).
var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type OrganizationService struct {
	repo repository.OrganizationRepository
}

func NewOrganizationService(repo repository.OrganizationRepository) *OrganizationService {
	return &OrganizationService{repo: repo}
}

func (s *OrganizationService) Get() (*model.OrganizationConfig, error) {
	return s.repo.Get()
}

func (s *OrganizationService) Update(cfg model.OrganizationConfig, updatedBy string) (*model.OrganizationConfig, error) {
	if cfg.Name == "" {
		return nil, errors.New("el nombre de la organización es obligatorio")
	}
	// Los colores son opcionales; si vienen, deben ser hex de 6 dígitos.
	for _, c := range []struct {
		label string
		value string
	}{
		{"color primario", cfg.PrimaryColor},
		{"color de acento", cfg.AccentColor},
		{"color del sidebar", cfg.SidebarColor},
	} {
		if c.value != "" && !hexColorRe.MatchString(c.value) {
			return nil, errors.New("el " + c.label + " debe ser un color hexadecimal válido (ej: #2563eb)")
		}
	}
	cfg.UpdatedBy = updatedBy
	return s.repo.Upsert(cfg)
}
