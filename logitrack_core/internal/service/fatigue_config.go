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

// Get returns the current config, applying defaults for any zero-value fields.
// This ensures forward-compatibility when old JSON files (which lacked the new
// weight/enabled fields) are read — they receive sensible defaults instead of
// all-zero weights that would break score calculation.
func (s *FatigueConfigService) Get() model.FatigueConfig {
	cfg := s.repo.Get()
	applyFatigueConfigDefaults(&cfg)
	return cfg
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
	out := s.repo.Get()
	applyFatigueConfigDefaults(&out)
	return out, nil
}

// ResetCheckins stamps the current time so that any check-in recorded before
// this moment is treated as "not done" by GetTodayCheckin.
func (s *FatigueConfigService) ResetCheckins() (model.FatigueConfig, error) {
	cfg := s.repo.Get()
	now := time.Now()
	cfg.LastCheckinReset = &now
	if err := s.repo.Update(cfg); err != nil {
		return model.FatigueConfig{}, err
	}
	out := s.repo.Get()
	applyFatigueConfigDefaults(&out)
	return out, nil
}

// applyFatigueConfigDefaults fills zero-value weight/enabled fields with the
// package defaults. Called after every read so the service always returns a
// fully-initialised config regardless of the underlying JSON content.
func applyFatigueConfigDefaults(cfg *model.FatigueConfig) {
	d := model.DefaultFatigueConfig()

	if cfg.RiskThresholds.GreenMax == 0 && cfg.RiskThresholds.RedMin == 0 {
		cfg.RiskThresholds = d.RiskThresholds
	}
	// If all weights are zero the file predates this schema version — apply defaults.
	if cfg.KSSWeight == 0 && cfg.VoiceWeight == 0 &&
		cfg.TactileWeight == 0 && cfg.PVTWeight == 0 {
		cfg.KSSWeight = d.KSSWeight
		cfg.VoiceWeight = d.VoiceWeight
		cfg.TactileWeight = d.TactileWeight
		cfg.PVTWeight = d.PVTWeight
		cfg.KSSEnabled = d.KSSEnabled
		cfg.VoiceEnabled = d.VoiceEnabled
		cfg.TactileEnabled = d.TactileEnabled
		cfg.PVTEnabled = d.PVTEnabled
	}
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

	// ── Individual weight range (0–1) ─────────────────────────────────────────
	weights := map[string]float64{
		"kss_weight":     cfg.KSSWeight,
		"voice_weight":   cfg.VoiceWeight,
		"tactile_weight": cfg.TactileWeight,
		"pvt_weight":     cfg.PVTWeight,
	}
	for name, w := range weights {
		if w < 0 || w > 1 {
			return fmt.Errorf("%s debe estar entre 0.0 y 1.0 (actual: %.4f)", name, w)
		}
	}

	// ── Active weights must sum to 1.0 (±0.01) ────────────────────────────────
	activeSum := 0.0
	anyEnabled := false
	if cfg.KSSEnabled {
		activeSum += cfg.KSSWeight
		anyEnabled = true
	}
	if cfg.VoiceEnabled {
		activeSum += cfg.VoiceWeight
		anyEnabled = true
	}
	if cfg.TactileEnabled {
		activeSum += cfg.TactileWeight
		anyEnabled = true
	}
	if cfg.PVTEnabled {
		activeSum += cfg.PVTWeight
		anyEnabled = true
	}

	if anyEnabled && math.Abs(activeSum-1.0) > 0.01 {
		return fmt.Errorf(
			"la suma de los pesos de las pruebas activas debe ser 1.0 (actual: %.4f)",
			activeSum,
		)
	}

	return nil
}
