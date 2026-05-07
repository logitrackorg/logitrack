package service

import (
	"fmt"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type RoutingConfigService struct {
	repo repository.RoutingConfigRepository
}

func NewRoutingConfigService(repo repository.RoutingConfigRepository) *RoutingConfigService {
	return &RoutingConfigService{repo: repo}
}

func (s *RoutingConfigService) Get() model.RoutingConfig {
	return s.repo.Get()
}

func (s *RoutingConfigService) Update(cfg model.RoutingConfig) (model.RoutingConfig, error) {
	if err := validateRoutingConfig(cfg); err != nil {
		return model.RoutingConfig{}, err
	}
	if err := s.repo.Update(cfg); err != nil {
		return model.RoutingConfig{}, err
	}
	return s.repo.Get(), nil
}

func validateRoutingConfig(cfg model.RoutingConfig) error {
	if cfg.SLAForceHorizonHours < 1 || cfg.SLAForceHorizonHours > 168 {
		return fmt.Errorf("sla_force_horizon_hours debe estar entre 1 y 168")
	}
	if cfg.PriorityForceThreshold < 0 || cfg.PriorityForceThreshold > 1 {
		return fmt.Errorf("priority_force_threshold debe estar entre 0.0 y 1.0")
	}
	if cfg.MinFillRate < 0.1 || cfg.MinFillRate > 1 {
		return fmt.Errorf("min_fill_rate debe estar entre 0.1 y 1.0")
	}
	if cfg.MaxShipmentsPerDriver < 1 || cfg.MaxShipmentsPerDriver > 100 {
		return fmt.Errorf("max_shipments_per_driver debe estar entre 1 y 100")
	}
	if cfg.MaxWeightKgPerDriver < 1 || cfg.MaxWeightKgPerDriver > 5000 {
		return fmt.Errorf("max_weight_kg_per_driver debe estar entre 1 y 5000")
	}
	return nil
}
