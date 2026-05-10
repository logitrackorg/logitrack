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
	// Para los nuevos campos: si quedaron en cero (config vieja en DB sin
	// estos valores), aplicar defaults para evitar arrancar con un solver
	// VRP roto (avg_speed=0 dispararía división por cero).
	if cfg.MorningWindowEndHour == 0 {
		cfg.MorningWindowStartHour = d.MorningWindowStartHour
		cfg.MorningWindowEndHour = d.MorningWindowEndHour
	}
	if cfg.AfternoonWindowEndHour == 0 {
		cfg.AfternoonWindowStartHour = d.AfternoonWindowStartHour
		cfg.AfternoonWindowEndHour = d.AfternoonWindowEndHour
	}
	if cfg.ServiceTimeMinutes == 0 {
		cfg.ServiceTimeMinutes = d.ServiceTimeMinutes
	}
	if cfg.AvgSpeedKmh == 0 {
		cfg.AvgSpeedKmh = d.AvgSpeedKmh
	}
	if cfg.LastMilePackingStrategy == "" {
		cfg.LastMilePackingStrategy = d.LastMilePackingStrategy
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
	if cfg.MorningWindowStartHour < 0 || cfg.MorningWindowStartHour > 23 {
		return fmt.Errorf("morning_window_start_hour debe estar entre 0 y 23")
	}
	if cfg.MorningWindowEndHour < 1 || cfg.MorningWindowEndHour > 24 {
		return fmt.Errorf("morning_window_end_hour debe estar entre 1 y 24")
	}
	if cfg.MorningWindowEndHour <= cfg.MorningWindowStartHour {
		return fmt.Errorf("morning_window_end_hour debe ser mayor que morning_window_start_hour")
	}
	if cfg.AfternoonWindowStartHour < 0 || cfg.AfternoonWindowStartHour > 23 {
		return fmt.Errorf("afternoon_window_start_hour debe estar entre 0 y 23")
	}
	if cfg.AfternoonWindowEndHour < 1 || cfg.AfternoonWindowEndHour > 24 {
		return fmt.Errorf("afternoon_window_end_hour debe estar entre 1 y 24")
	}
	if cfg.AfternoonWindowEndHour <= cfg.AfternoonWindowStartHour {
		return fmt.Errorf("afternoon_window_end_hour debe ser mayor que afternoon_window_start_hour")
	}
	if cfg.ServiceTimeMinutes < 1 || cfg.ServiceTimeMinutes > 60 {
		return fmt.Errorf("service_time_minutes debe estar entre 1 y 60")
	}
	if cfg.AvgSpeedKmh < 5 || cfg.AvgSpeedKmh > 120 {
		return fmt.Errorf("avg_speed_kmh debe estar entre 5 y 120")
	}
	switch cfg.LastMilePackingStrategy {
	case model.PackingStrategyBalanced, model.PackingStrategyMaximizeCapacity:
	default:
		return fmt.Errorf("last_mile_packing_strategy debe ser 'balanced' o 'maximize_capacity'")
	}
	return nil
}
