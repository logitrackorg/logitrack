package repository

import (
	"encoding/json"
	"os"
	"sync"

	"github.com/logitrack/core/internal/model"
)

const slaSettingsPath = "data/sla_settings.json"

// SLASettingsRepository persists the SLA anomaly-engine configuration to a
// single JSON file. Thread-safe; writes are atomic (temp file + rename).
// Falls back to model.DefaultSLASettings() when the file does not exist yet,
// so the service is never left without a valid configuration.
type SLASettingsRepository struct {
	mu   sync.Mutex
	path string
}

func NewSLASettingsRepository() *SLASettingsRepository {
	_ = os.MkdirAll("data", 0o755)
	return &SLASettingsRepository{path: slaSettingsPath}
}

// Get returns the stored settings, or the defaults when no file exists yet.
// Never returns a zero-value struct — callers can use the result directly.
func (r *SLASettingsRepository) Get() model.SLASettings {
	r.mu.Lock()
	defer r.mu.Unlock()

	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return model.DefaultSLASettings()
	}
	if err != nil {
		return model.DefaultSLASettings()
	}
	var cfg model.SLASettings
	if err := json.Unmarshal(data, &cfg); err != nil {
		return model.DefaultSLASettings()
	}
	// Guard against a partially-written file that left required fields at zero.
	if cfg.ToleranceMultiplier <= 0 {
		cfg.ToleranceMultiplier = model.DefaultSLASettings().ToleranceMultiplier
	}
	if cfg.CacheIntervalMinutes <= 0 {
		cfg.CacheIntervalMinutes = model.DefaultSLASettings().CacheIntervalMinutes
	}
	if cfg.PriorityCeiling == "" {
		cfg.PriorityCeiling = model.DefaultSLASettings().PriorityCeiling
	}
	if len(cfg.EnabledStates) == 0 {
		cfg.EnabledStates = model.DefaultSLASettings().EnabledStates
	}
	return cfg
}

// Update persists the configuration atomically.
func (r *SLASettingsRepository) Update(cfg model.SLASettings) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}
