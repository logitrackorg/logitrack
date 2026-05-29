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

func (r *HistoryAccessRequestRepository) Get(driverID string) (model.HistoryAccessRequest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return model.HistoryAccessRequest{}, false
	}
	req, ok := records[driverID]
	return req, ok
}

func (r *HistoryAccessRequestRepository) Upsert(req model.HistoryAccessRequest) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	records, err := r.load()
	if err != nil {
		return err
	}
	records[req.DriverID] = req
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

func (r *HistoryAccessRequestRepository) load() (historyAccessFile, error) {
	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return historyAccessFile{}, nil
	}
	if err != nil {
		return nil, err
	}
	var records historyAccessFile
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
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
