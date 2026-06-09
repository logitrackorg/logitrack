package repository

import (
	"encoding/json"
	"os"
	"sync"

	"github.com/logitrack/core/internal/model"
)

const historyAccessFilePath = "data/history_access_requests.json"

type historyAccessFile = map[string]model.HistoryAccessRequest

type HistoryAccessRequestRepository struct {
	mu   sync.Mutex
	path string
}

func NewHistoryAccessRequestRepository() *HistoryAccessRequestRepository {
	_ = os.MkdirAll("data", 0o755)
	return &HistoryAccessRequestRepository{path: historyAccessFilePath}
}

// recordKey builds the composite storage key for a (driver, request type)
// pair — a driver can hold one access request and one deletion request
// simultaneously, so the bare driver ID is no longer a unique key.
func recordKey(driverID string, reqType model.HistoryRequestType) string {
	return driverID + "|" + string(reqType)
}

func (r *HistoryAccessRequestRepository) Get(driverID string, reqType model.HistoryRequestType) (model.HistoryAccessRequest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return model.HistoryAccessRequest{}, false
	}
	req, ok := records[recordKey(driverID, reqType)]
	return req, ok
}

func (r *HistoryAccessRequestRepository) Upsert(req model.HistoryAccessRequest) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	records[recordKey(req.DriverID, req.Type)] = req
	return r.save(records)
}

// Delete removes a (driver, request type) record entirely — used when a
// deletion request is approved, to revoke sharing and reset the driver back
// to "no active permissions" (Caso A) for both request types.
func (r *HistoryAccessRequestRepository) Delete(driverID string, reqType model.HistoryRequestType) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	delete(records, recordKey(driverID, reqType))
	return r.save(records)
}

func (r *HistoryAccessRequestRepository) ListByStatus(status model.HistoryRequestStatus) []model.HistoryAccessRequest {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return []model.HistoryAccessRequest{}
	}
	result := make([]model.HistoryAccessRequest, 0)
	for _, req := range records {
		if req.Status == status {
			result = append(result, req)
		}
	}
	return result
}

func (r *HistoryAccessRequestRepository) ListAll() []model.HistoryAccessRequest {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return []model.HistoryAccessRequest{}
	}
	result := make([]model.HistoryAccessRequest, 0, len(records))
	for _, req := range records {
		result = append(result, req)
	}
	return result
}

// load reads the records file and migrates legacy entries — records written
// before the access/deletion split are keyed by bare driver ID and have no
// `Type`. They are reinterpreted as access requests (the only type that
// existed back then) and re-keyed to the new composite format.
func (r *HistoryAccessRequestRepository) load() (historyAccessFile, error) {
	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return historyAccessFile{}, nil
	}
	if err != nil {
		return nil, err
	}
	var raw historyAccessFile
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	records := make(historyAccessFile, len(raw))
	migrated := false
	for key, req := range raw {
		if req.Type == "" {
			req.Type = model.HistoryRequestTypeAccess
			migrated = true
		}
		records[recordKey(req.DriverID, req.Type)] = req
		_ = key // legacy key discarded — composite key recomputed from the record itself
	}

	if migrated {
		if err := r.save(records); err != nil {
			return nil, err
		}
	}
	return records, nil
}

func (r *HistoryAccessRequestRepository) save(records historyAccessFile) error {
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
