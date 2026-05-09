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

// applyRoutingConfigDefaults rellena con defaults los campos NUEVOS de la config
// de ventanas horarias cuando vienen en cero. Esto permite que callers que solo
// conocen los campos legacy sigan funcionando sin enviar los nuevos campos.
// Los campos legacy (SLA, fill rate, etc.) NO se tocan aquí para no ocultar
// valores inválidos que deben ser rechazados por la validación.
func applyRoutingConfigDefaults(cfg *model.RoutingConfig) {
	d := model.DefaultRoutingConfig()
	if cfg.MorningWindowStartHour == 0 && cfg.MorningWindowEndHour == 0 {
		cfg.MorningWindowStartHour = d.MorningWindowStartHour
		cfg.MorningWindowEndHour = d.MorningWindowEndHour
	}
	if cfg.AfternoonWindowStartHour == 0 && cfg.AfternoonWindowEndHour == 0 {
		cfg.AfternoonWindowStartHour = d.AfternoonWindowStartHour
		cfg.AfternoonWindowEndHour = d.AfternoonWindowEndHour
	}
	if cfg.ServiceTimeMinutes == 0 {
		cfg.ServiceTimeMinutes = d.ServiceTimeMinutes
	}
	if cfg.AvgSpeedKmh == 0 {
		cfg.AvgSpeedKmh = d.AvgSpeedKmh
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
	if cfg.MaxShipmentsPerDriver < 1 || cfg.MaxShipmentsPerDriver > 100 {
		return fmt.Errorf("max_shipments_per_driver debe estar entre 1 y 100")
	}
	if cfg.MaxWeightKgPerDriver < 1 || cfg.MaxWeightKgPerDriver > 5000 {
		return fmt.Errorf("max_weight_kg_per_driver debe estar entre 1 y 5000")
	}
	if cfg.MorningWindowStartHour < 0 || cfg.MorningWindowStartHour > 23 {
		return fmt.Errorf("morning_window_start_hour debe estar entre 0 y 23")
	}
	if cfg.MorningWindowEndHour < 1 || cfg.MorningWindowEndHour > 24 {
		return fmt.Errorf("morning_window_end_hour debe estar entre 1 y 24")
	}
	if cfg.MorningWindowStartHour >= cfg.MorningWindowEndHour {
		return fmt.Errorf("morning_window_start_hour debe ser menor que morning_window_end_hour")
	}
	if cfg.AfternoonWindowStartHour < 0 || cfg.AfternoonWindowStartHour > 23 {
		return fmt.Errorf("afternoon_window_start_hour debe estar entre 0 y 23")
	}
	if cfg.AfternoonWindowEndHour < 1 || cfg.AfternoonWindowEndHour > 24 {
		return fmt.Errorf("afternoon_window_end_hour debe estar entre 1 y 24")
	}
	if cfg.AfternoonWindowStartHour >= cfg.AfternoonWindowEndHour {
		return fmt.Errorf("afternoon_window_start_hour debe ser menor que afternoon_window_end_hour")
	}
	if cfg.ServiceTimeMinutes < 1 || cfg.ServiceTimeMinutes > 120 {
		return fmt.Errorf("service_time_minutes debe estar entre 1 y 120")
	}
	if cfg.AvgSpeedKmh < 5 || cfg.AvgSpeedKmh > 120 {
		return fmt.Errorf("avg_speed_kmh debe estar entre 5 y 120")
	}
	return nil
}
