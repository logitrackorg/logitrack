package repository

import (
	"encoding/json"
	"os"
	"sort"
	"sync"

	"github.com/logitrack/core/internal/model"
)

const auditLogPath = "data/fatigue_audit_logs.json"

// AuditLogRepository persists fatigue audit records in a JSON array.
// It is intentionally append-only: no Delete or Update methods exist,
// enforcing immutability at the storage layer (AC2).
type AuditLogRepository struct {
	mu   sync.Mutex
	path string
}

func NewAuditLogRepository() *AuditLogRepository {
	_ = os.MkdirAll("data", 0o755)
	return &AuditLogRepository{path: auditLogPath}
}

// Append adds a new record. Writes are atomic (temp file + rename).
func (r *AuditLogRepository) Append(entry model.AuditLog) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	records = append(records, entry)
	return r.save(records)
}

// ListAll returns every record sorted newest-first.
// Returns an empty slice when the file does not exist yet.
func (r *AuditLogRepository) ListAll() []model.AuditLog {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil || len(records) == 0 {
		return []model.AuditLog{}
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].CreatedAt.After(records[j].CreatedAt)
	})
	return records
}

// ListByActions returns only records whose Action field matches one of the
// given values, sorted newest-first. Used to separate config-change history
// from driver check-in events that share the same backing file.
func (r *AuditLogRepository) ListByActions(actions ...string) []model.AuditLog {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return []model.AuditLog{}
	}
	allowed := make(map[string]struct{}, len(actions))
	for _, a := range actions {
		allowed[a] = struct{}{}
	}
	filtered := make([]model.AuditLog, 0, len(records))
	for _, rec := range records {
		if _, ok := allowed[rec.Action]; ok {
			filtered = append(filtered, rec)
		}
	}
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].CreatedAt.After(filtered[j].CreatedAt)
	})
	return filtered
}

func (r *AuditLogRepository) load() ([]model.AuditLog, error) {
	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return []model.AuditLog{}, nil
	}
	if err != nil {
		return nil, err
	}
	var records []model.AuditLog
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	return records, nil
}

func (r *AuditLogRepository) save(records []model.AuditLog) error {
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
