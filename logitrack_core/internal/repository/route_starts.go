package repository

import (
	"encoding/json"
	"os"
	"sync"
)

const routeStartsPath = "data/route_starts.json"

// RouteStartRepository persists a per-driver, per-day counter of how many
// vehicle claims (route starts) have occurred since the driver's last valid
// KSS check-in. It is completely decoupled from the DriverCheckin record so
// that the counter is always available regardless of whether a check-in exists.
type RouteStartRepository struct {
	mu   sync.Mutex
	path string
}

func NewRouteStartRepository() *RouteStartRepository {
	_ = os.MkdirAll("data", 0o755)
	return &RouteStartRepository{path: routeStartsPath}
}

// routeStartKey returns the map key for a given driver and calendar date.
func routeStartKey(driverID, date string) string { return driverID + "|" + date }

// Get returns the current route-start count for a driver on the given date.
// Returns 0 if no record exists (no route has been claimed yet today).
func (r *RouteStartRepository) Get(driverID, date string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, _ := r.load()
	return m[routeStartKey(driverID, date)]
}

// Increment adds 1 to the counter and returns the new value.
func (r *RouteStartRepository) Increment(driverID, date string) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, err := r.load()
	if err != nil {
		return 0, err
	}
	k := routeStartKey(driverID, date)
	m[k]++
	if err := r.save(m); err != nil {
		return 0, err
	}
	return m[k], nil
}

// Reset sets the counter to 0. Called when the driver completes a new check-in
// so the gate does not re-fire immediately after they just passed it.
func (r *RouteStartRepository) Reset(driverID, date string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	m, err := r.load()
	if err != nil {
		return err
	}
	k := routeStartKey(driverID, date)
	if m[k] == 0 {
		return nil // nothing to do
	}
	m[k] = 0
	return r.save(m)
}

func (r *RouteStartRepository) load() (map[string]int, error) {
	data, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return map[string]int{}, nil
	}
	if err != nil {
		return nil, err
	}
	m := map[string]int{}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (r *RouteStartRepository) save(m map[string]int) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}
