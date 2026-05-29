package repository

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/logitrack/core/internal/model"
)

const sleepFilePath = "data/sleep_records.json"

type sleepFile = map[string]model.SleepRecord

// SleepRepository persists per-driver, per-logical-day sleep hours to a single
// JSON file. Keys are "driverID|YYYY-MM-DD". All public methods are safe for
// concurrent use.
type SleepRepository struct {
	mu   sync.Mutex
	path string
}

func NewSleepRepository() *SleepRepository {
	_ = os.MkdirAll("data", 0o755)
	return &SleepRepository{path: sleepFilePath}
}

// Get returns the sleep record for a driver on a given logical date, if any.
func (r *SleepRepository) Get(driverID, logicalDate string) (model.SleepRecord, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return model.SleepRecord{}, false
	}
	rec, ok := records[sleepKey(driverID, logicalDate)]
	return rec, ok
}

// Upsert saves or overwrites the sleep record for (DriverID, LogicalDate).
func (r *SleepRepository) Upsert(driverID, logicalDate string, horasSueno int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	records[sleepKey(driverID, logicalDate)] = model.SleepRecord{
		DriverID:    driverID,
		LogicalDate: logicalDate,
		HorasSueno:  horasSueno,
		RecordedAt:  time.Now(),
	}
	return r.save(records)
}

func sleepKey(driverID, logicalDate string) string { return driverID + "|" + logicalDate }

func (r *SleepRepository) load() (sleepFile, error) {
	records := sleepFile{}
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

func (r *SleepRepository) save(records sleepFile) error {
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
