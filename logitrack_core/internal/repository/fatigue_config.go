package repository

import (
	"encoding/json"
	"os"
	"sync"

	"github.com/logitrack/core/internal/model"
)

const fatigueConfigPath = "data/fatigue_config.json"

// FatigueConfigRepository persists the fatigue model configuration to a JSON
// file. Thread-safe; writes are atomic (temp file + rename).
type FatigueConfigRepository struct {
	mu   sync.Mutex
	path string
}

func NewFatigueConfigRepository() *FatigueConfigRepository {
	_ = os.MkdirAll("data", 0o755)
	return &FatigueConfigRepository{path: fatigueConfigPath}
}

// Get returns the stored config, or the default values when no file exists yet.
func (r *FatigueConfigRepository) Get() model.FatigueConfig {
	r.mu.Lock()
	defer r.mu.Unlock()

	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return model.DefaultFatigueConfig()
	}
	if err != nil {
		return model.DefaultFatigueConfig()
	}
	var cfg model.FatigueConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return model.DefaultFatigueConfig()
	}
	return cfg
}

// Update persists the configuration atomically.
func (r *FatigueConfigRepository) Update(cfg model.FatigueConfig) error {
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
