package repository

import (
	"encoding/json"
	"os"
	"strings"
	"sync"

	"github.com/logitrack/core/internal/model"
)

const checkinFilePath = "data/checkins.json"

// checkinFile is the on-disk structure: a map of "driverID|YYYY-MM-DD" → DriverCheckin.
type checkinFile = map[string]model.DriverCheckin

// CheckinRepository persists KSS check-ins and voice analysis results to a
// single JSON file. All public methods are safe for concurrent use.
type CheckinRepository struct {
	mu   sync.Mutex
	path string
}

func NewCheckinRepository() *CheckinRepository {
	_ = os.MkdirAll("data", 0o755)
	return &CheckinRepository{path: checkinFilePath}
}

// Upsert saves or overwrites the check-in for (DriverID, Date).
func (r *CheckinRepository) Upsert(c model.DriverCheckin) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	records[key(c.DriverID, c.Date)] = c
	return r.save(records)
}

// Get returns the check-in for a driver on a given date, if any.
func (r *CheckinRepository) Get(driverID, date string) (model.DriverCheckin, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return model.DriverCheckin{}, false
	}
	c, ok := records[key(driverID, date)]
	return c, ok
}

// AllForDriver returns every check-in ever recorded for a driver, ordered by
// insertion (map iteration — callers must sort if order matters).
func (r *CheckinRepository) AllForDriver(driverID string) []model.DriverCheckin {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return nil
	}
	prefix := driverID + "|"
	var out []model.DriverCheckin
	for k, v := range records {
		if strings.HasPrefix(k, prefix) {
			out = append(out, v)
		}
	}
	return out
}

// ── private helpers ──────────────────────────────────────────────────────────

func key(driverID, date string) string { return driverID + "|" + date }

// load reads the JSON file. Returns an empty map when the file doesn't exist yet.
func (r *CheckinRepository) load() (checkinFile, error) {
	records := checkinFile{}
	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return records, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	return records, nil
}

// save writes the map back atomically via a temp file + rename.
func (r *CheckinRepository) save(records checkinFile) error {
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
