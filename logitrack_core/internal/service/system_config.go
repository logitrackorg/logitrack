package service

import (
	"fmt"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type SystemConfigService struct {
	repo repository.SystemConfigRepository
}

func NewSystemConfigService(repo repository.SystemConfigRepository) *SystemConfigService {
	return &SystemConfigService{repo: repo}
}

func (s *SystemConfigService) Get() model.SystemConfig {
	return s.repo.Get()
}

func (s *SystemConfigService) Update(cfg model.SystemConfig) (model.SystemConfig, error) {
	if cfg.MaxDeliveryAttempts < 1 || cfg.MaxDeliveryAttempts > 10 {
		return model.SystemConfig{}, fmt.Errorf("max_delivery_attempts debe estar entre 1 y 10")
	}
	if err := s.repo.Update(cfg); err != nil {
		return model.SystemConfig{}, err
	}
	return s.repo.Get(), nil
}
