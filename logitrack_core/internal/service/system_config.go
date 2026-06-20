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

	if cfg.MaxCoverageAreaKm2 < 100 || cfg.MaxCoverageAreaKm2 > 10000000 {
		return model.SystemConfig{}, fmt.Errorf("max_coverage_area_km2 debe estar entre 100 y 10000000")
	}

	// Prioridad de reclamos: tope de urgentes y umbrales ML.
	if cfg.UrgentClaimsCapPct <= 0 || cfg.UrgentClaimsCapPct > 1 {
		return model.SystemConfig{}, fmt.Errorf("urgent_claims_cap_pct debe ser mayor a 0 y menor o igual a 1")
	}
	if cfg.ClaimsHighPriorityThreshold <= 0 || cfg.ClaimsHighPriorityThreshold > 1 {
		return model.SystemConfig{}, fmt.Errorf("claims_high_priority_threshold debe ser mayor a 0 y menor o igual a 1")
	}
	if cfg.ClaimsMediumPriorityThreshold <= 0 || cfg.ClaimsMediumPriorityThreshold > 1 {
		return model.SystemConfig{}, fmt.Errorf("claims_medium_priority_threshold debe ser mayor a 0 y menor o igual a 1")
	}
	if cfg.ClaimsMediumPriorityThreshold >= cfg.ClaimsHighPriorityThreshold {
		return model.SystemConfig{}, fmt.Errorf("claims_medium_priority_threshold debe ser menor que claims_high_priority_threshold")
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