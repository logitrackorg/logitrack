package repository

import (
	"encoding/json"
	"os"
	"sync"

	"github.com/logitrack/core/internal/model"
)

const priorityLogPath = "data/priority_logs.json"

// PriorityLogRepository is an append-only store for automatic priority-escalation
// events (AC3). It persists to data/priority_logs.json using the same atomic
// temp-file-rename pattern used by other file-backed repositories.
type PriorityLogRepository struct {
	mu   sync.Mutex
	path string
}

func NewPriorityLogRepository() *PriorityLogRepository {
	_ = os.MkdirAll("data", 0o755)
	return &PriorityLogRepository{path: priorityLogPath}
}

// Append adds a new PriorityLog entry to the file. Concurrent calls are
// serialised by the mutex; no entry is ever lost or overwritten.
func (r *PriorityLogRepository) Append(entry model.PriorityLog) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	records = append(records, entry)
	return r.save(records)
}

// ListAll returns every log entry ordered as stored (oldest first).
func (r *PriorityLogRepository) ListAll() []model.PriorityLog {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil || len(records) == 0 {
		return []model.PriorityLog{}
	}
	return records
}

func (r *PriorityLogRepository) load() ([]model.PriorityLog, error) {
	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return []model.PriorityLog{}, nil
	}
	if err != nil {
		return nil, err
	}
	var records []model.PriorityLog
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	return records, nil
}

func (r *PriorityLogRepository) save(records []model.PriorityLog) error {
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}
