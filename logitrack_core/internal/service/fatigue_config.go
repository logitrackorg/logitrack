package service

import (
	"fmt"
	"math"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type FatigueConfigService struct {
	repo *repository.FatigueConfigRepository
}

func NewFatigueConfigService(repo *repository.FatigueConfigRepository) *FatigueConfigService {
	return &FatigueConfigService{repo: repo}
}

func (s *FatigueConfigService) Get() model.FatigueConfig {
	return s.repo.Get()
}

func (s *FatigueConfigService) Update(cfg model.FatigueConfig) (model.FatigueConfig, error) {
	if err := validateFatigueConfig(cfg); err != nil {
		return model.FatigueConfig{}, err
	}
	// LastCheckinReset is server-managed; never overwrite it from a client payload.
	existing := s.repo.Get()
	cfg.LastCheckinReset = existing.LastCheckinReset
	if err := s.repo.Update(cfg); err != nil {
		return model.FatigueConfig{}, err
	}
	return s.repo.Get(), nil
}

// ResetCheckins stamps the current time so that any check-in recorded before this
// moment is treated as "not done" by GetTodayCheckin. The actual check-in data is
// preserved; drivers can redo (or skip) the gate without losing history.
func (s *FatigueConfigService) ResetCheckins() (model.FatigueConfig, error) {
	cfg := s.repo.Get()
	now := time.Now()
	cfg.LastCheckinReset = &now
	if err := s.repo.Update(cfg); err != nil {
		return model.FatigueConfig{}, err
	}
	return s.repo.Get(), nil
}

func validateFatigueConfig(cfg model.FatigueConfig) error {
	// ── Risk thresholds ────────────────────────────────────────────────────────
	if cfg.RiskThresholds.GreenMax < 0 || cfg.RiskThresholds.GreenMax > 100 {
		return fmt.Errorf("green_max debe estar entre 0 y 100")
	}
	if cfg.RiskThresholds.RedMin < 0 || cfg.RiskThresholds.RedMin > 100 {
		return fmt.Errorf("red_min debe estar entre 0 y 100")
	}
	if cfg.RiskThresholds.GreenMax >= cfg.RiskThresholds.RedMin {
		return fmt.Errorf("green_max (%d) debe ser menor que red_min (%d)",
			cfg.RiskThresholds.GreenMax, cfg.RiskThresholds.RedMin)
	}

	// ── Voice weights must sum to 1.0 (±0.01 tolerance) ──────────────────────
	w := cfg.VoiceWeights
	if w.PitchMean < 0 || w.PitchRange < 0 || w.EnergyRMS < 0 || w.SpeechRate < 0 || w.PauseRatio < 0 {
		return fmt.Errorf("los pesos de voz no pueden ser negativos")
	}
	sum := w.PitchMean + w.PitchRange + w.EnergyRMS + w.SpeechRate + w.PauseRatio
	if math.Abs(sum-1.0) > 0.01 {
		return fmt.Errorf("los pesos de voz deben sumar 1.0 (actual: %.4f)", sum)
	}

	// ── Baseline days ──────────────────────────────────────────────────────────
	if cfg.MinBaselineDays < 1 || cfg.MinBaselineDays > 90 {
		return fmt.Errorf("min_baseline_days debe estar entre 1 y 90")
	}

	// ── KSS scores ─────────────────────────────────────────────────────────────
	if cfg.KSSScores.KSS14 < 0 {
		return fmt.Errorf("kss_1_4 no puede ser negativo")
	}
	if cfg.KSSScores.KSS57 < 0 {
		return fmt.Errorf("kss_5_7 no puede ser negativo")
	}
	if cfg.KSSScores.KSS89 < 0 {
		return fmt.Errorf("kss_8_9 no puede ser negativo")
	}
	if cfg.KSSScores.KSS14 > cfg.KSSScores.KSS57 {
		return fmt.Errorf("kss_1_4 debe ser menor o igual que kss_5_7")
	}
	if cfg.KSSScores.KSS57 > cfg.KSSScores.KSS89 {
		return fmt.Errorf("kss_5_7 debe ser menor o igual que kss_8_9")
	}

	return nil
}
