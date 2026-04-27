package service

import (
	"errors"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

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
	cfg.UpdatedBy = updatedBy
	return s.repo.Upsert(cfg)
}
