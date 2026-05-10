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
	cfg := s.repo.Get()
	applyRoutingConfigDefaults(&cfg)
	return cfg
}

func (s *RoutingConfigService) Update(cfg model.RoutingConfig) (model.RoutingConfig, error) {
	applyRoutingConfigDefaults(&cfg)
	if err := validateRoutingConfig(cfg); err != nil {
		return model.RoutingConfig{}, err
	}
	if err := s.repo.Update(cfg); err != nil {
		return model.RoutingConfig{}, err
	}
	return s.repo.Get(), nil
}

func applyRoutingConfigDefaults(cfg *model.RoutingConfig) {
	d := model.DefaultRoutingConfig()
	if cfg.MinFillRate == 0 {
		cfg.MinFillRate = d.MinFillRate
	}
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
	return nil
}
