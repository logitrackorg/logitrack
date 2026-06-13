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
	// Validaciones existentes
	if cfg.MaxDeliveryAttempts < 1 || cfg.MaxDeliveryAttempts > 10 {
		return model.SystemConfig{}, fmt.Errorf("max_delivery_attempts debe estar entre 1 y 10")
	}
	if cfg.DraftRetentionDays < 1 || cfg.DraftRetentionDays > 365 {
		return model.SystemConfig{}, fmt.Errorf("draft_retention_days debe estar entre 1 y 365")
	}
	if cfg.DraftPurgeDays < 1 || cfg.DraftPurgeDays > 1825 {
		return model.SystemConfig{}, fmt.Errorf("draft_purge_days debe estar entre 1 y 1825 (5 años)")
	}
	if cfg.PickupDeadlineDays < 0 || cfg.PickupDeadlineDays > 365 {
		return model.SystemConfig{}, fmt.Errorf("pickup_deadline_days debe estar entre 0 y 365 (0 = sin límite)")
	}
	

	if cfg.MaxReschedules < 0 || cfg.MaxReschedules > 10 {
		return model.SystemConfig{}, fmt.Errorf("max_reschedules debe estar entre 0 y 10")
	}

	
	if cfg.MaxRescheduleDays < 1 || cfg.MaxRescheduleDays > 7 {
		return model.SystemConfig{}, fmt.Errorf("max_reschedule_days debe estar entre 1 y 7")
	}

	if cfg.MaxCoverageAreaKm2 < 100 || cfg.MaxCoverageAreaKm2 > 500000 {
		return model.SystemConfig{}, fmt.Errorf("max_coverage_area_km2 debe estar entre 100 y 500000")
	}

	// CA01: Guardar configuración
	if err := s.repo.Update(cfg); err != nil {
		return model.SystemConfig{}, err
	}
	
	return s.repo.Get(), nil
}

//  Helper method para obtener solo MaxReschedules
func (s *SystemConfigService) GetMaxReschedules() int {
	return s.repo.Get().MaxReschedules
}