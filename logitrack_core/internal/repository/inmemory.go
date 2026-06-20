package repository

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
)

// ── InMemory EventStore ───────────────────────────────────────────────────────

type inMemoryEventStore struct {
	mu     sync.RWMutex
	events []model.DomainEvent
}

func newInMemoryEventStore() EventStore {
	return &inMemoryEventStore{}
}

func (s *inMemoryEventStore) Append(event model.DomainEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
	return nil
}

func (s *inMemoryEventStore) LoadStream(trackingID string) ([]model.DomainEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []model.DomainEvent
	for _, e := range s.events {
		if e.TrackingID == trackingID {
			out = append(out, e)
		}
	}
	return out, nil
}

func (s *inMemoryEventStore) LoadAll() ([]model.DomainEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]model.DomainEvent, len(s.events))
	copy(out, s.events)
	return out, nil
}

// NewInMemoryShipmentRepository wires an event-sourced ShipmentRepository backed
// by in-memory storage. Intended for unit tests only.
func NewInMemoryShipmentRepository() ShipmentRepository {
	store := newInMemoryEventStore()
	proj := projection.NewShipmentProjection()
	return NewEventSourcedShipmentRepository(store, proj)
}

// NewInMemoryShipmentRepositoryWithDeps returns the underlying EventStore and
// Projector alongside the ShipmentRepository, for tests that need to wire
// additional services (e.g. IncidentService) against the same in-memory store.
func NewInMemoryShipmentRepositoryWithDeps() (ShipmentRepository, EventStore, projection.Projector) {
	store := newInMemoryEventStore()
	proj := projection.NewShipmentProjection()
	return NewEventSourcedShipmentRepository(store, proj), store, proj
}

// ── InMemory BranchRepository ─────────────────────────────────────────────────

type inMemoryBranchRepository struct {
	mu       sync.RWMutex
	branches map[string]model.Branch
}

func NewInMemoryBranchRepository() BranchRepository {
	return &inMemoryBranchRepository{branches: make(map[string]model.Branch)}
}

func (r *inMemoryBranchRepository) List() []model.Branch {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]model.Branch, 0, len(r.branches))
	for _, b := range r.branches {
		out = append(out, b)
	}
	return out
}

func (r *inMemoryBranchRepository) ListActive() []model.Branch {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []model.Branch
	for _, b := range r.branches {
		if b.Status == model.BranchStatusActive {
			out = append(out, b)
		}
	}
	return out
}

func (r *inMemoryBranchRepository) Create(branch model.Branch) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, b := range r.branches {
		if strings.EqualFold(b.Name, branch.Name) {
			return ErrDuplicateBranchName
		}
	}
	r.branches[branch.ID] = branch
	return nil
}

func (r *inMemoryBranchRepository) Add(branch model.Branch) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.branches[branch.ID] = branch
}

func (r *inMemoryBranchRepository) Update(id string, branch model.Branch) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.branches[id]; !ok {
		return errors.New("branch not found")
	}
	for existingID, b := range r.branches {
		if existingID != id && strings.EqualFold(b.Name, branch.Name) {
			return ErrDuplicateBranchName
		}
	}
	existing := r.branches[id]
	branch.ID = existing.ID
	branch.Status = existing.Status
	branch.UpdatedBy = existing.UpdatedBy
	r.branches[id] = branch
	return nil
}

func (r *inMemoryBranchRepository) UpdateStatus(id string, status model.BranchStatus, username string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.branches[id]
	if !ok {
		return errors.New("branch not found")
	}
	b.Status = status
	b.UpdatedBy = username
	r.branches[id] = b
	return nil
}

func (r *inMemoryBranchRepository) UpdateEmployeeOfMonth(id string, enabled bool, username string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.branches[id]
	if !ok {
		return errors.New("branch not found")
	}
	b.EmployeeOfMonthEnabled = enabled
	b.UpdatedBy = username
	r.branches[id] = b
	return nil
}

func (r *inMemoryBranchRepository) GetByID(id string) (model.Branch, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	b, ok := r.branches[id]
	return b, ok
}

func (r *inMemoryBranchRepository) GetByCity(city string) (model.Branch, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, b := range r.branches {
		if strings.EqualFold(b.Address.City, city) {
			return b, true
		}
	}
	return model.Branch{}, false
}

func (r *inMemoryBranchRepository) GetByNameOrID(query string) []model.Branch {
	r.mu.RLock()
	defer r.mu.RUnlock()
	q := strings.ToLower(query)
	var out []model.Branch
	for _, b := range r.branches {
		if strings.Contains(strings.ToLower(b.Name), q) ||
			strings.Contains(strings.ToLower(b.ID), q) ||
			strings.Contains(strings.ToLower(b.Address.City), q) {
			out = append(out, b)
		}
	}
	return out
}

// ── InMemory VehicleRepository ────────────────────────────────────────────────

type inMemoryVehicleRepository struct {
	mu       sync.RWMutex
	vehicles map[string]model.Vehicle // keyed by license plate
}

func NewInMemoryVehicleRepository() VehicleRepository {
	return &inMemoryVehicleRepository{vehicles: make(map[string]model.Vehicle)}
}

func (r *inMemoryVehicleRepository) List() []model.Vehicle {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]model.Vehicle, 0, len(r.vehicles))
	for _, v := range r.vehicles {
		out = append(out, v)
	}
	return out
}

func (r *inMemoryVehicleRepository) Add(vehicle model.Vehicle) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.vehicles[vehicle.LicensePlate]; ok {
		return ErrDuplicateLicensePlate
	}
	if vehicle.ID == "" {
		vehicle.ID = vehicle.LicensePlate
	}
	r.vehicles[vehicle.LicensePlate] = vehicle
	return nil
}

func (r *inMemoryVehicleRepository) GetByID(id string) (model.Vehicle, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, v := range r.vehicles {
		if v.ID == id {
			return v, true
		}
	}
	return model.Vehicle{}, false
}

func (r *inMemoryVehicleRepository) GetByLicensePlate(licensePlate string) (model.Vehicle, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.vehicles[licensePlate]
	return v, ok
}

func (r *inMemoryVehicleRepository) UpdateStatus(id string, status model.VehicleStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for plate, v := range r.vehicles {
		if v.LicensePlate == plate && (v.ID == id || v.LicensePlate == id) {
			v.Status = status
			r.vehicles[plate] = v
			return nil
		}
	}
	return fmt.Errorf("vehicle not found")
}

func (r *inMemoryVehicleRepository) UpdateStatusByUser(id string, status model.VehicleStatus, username string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	// id may be the license plate in the in-memory implementation
	if v, ok := r.vehicles[id]; ok {
		v.Status = status
		v.UpdatedBy = username
		r.vehicles[id] = v
		return nil
	}
	return fmt.Errorf("vehicle not found")
}

func (r *inMemoryVehicleRepository) AddShipment(id string, trackingID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vehicles[id]
	if !ok {
		return fmt.Errorf("vehicle not found")
	}
	v.AssignedShipments = append(v.AssignedShipments, trackingID)
	r.vehicles[id] = v
	return nil
}

func (r *inMemoryVehicleRepository) RemoveShipment(id string, trackingID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vehicles[id]
	if !ok {
		return fmt.Errorf("vehicle not found")
	}
	filtered := v.AssignedShipments[:0]
	for _, tid := range v.AssignedShipments {
		if tid != trackingID {
			filtered = append(filtered, tid)
		}
	}
	v.AssignedShipments = filtered
	r.vehicles[id] = v
	return nil
}

func (r *inMemoryVehicleRepository) ClearShipments(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vehicles[id]
	if !ok {
		return fmt.Errorf("vehicle not found")
	}
	v.AssignedShipments = nil
	r.vehicles[id] = v
	return nil
}

func (r *inMemoryVehicleRepository) AssignBranch(id string, branchID *string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vehicles[id]
	if !ok {
		return fmt.Errorf("vehicle not found")
	}
	v.AssignedBranch = branchID
	r.vehicles[id] = v
	return nil
}

func (r *inMemoryVehicleRepository) SetDestinationBranch(id string, branchID *string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vehicles[id]
	if !ok {
		return fmt.Errorf("vehicle not found")
	}
	v.DestinationBranch = branchID
	r.vehicles[id] = v
	return nil
}

func (r *inMemoryVehicleRepository) UpdateLocation(id string, lat, lng float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.vehicles[id]
	if !ok {
		return fmt.Errorf("vehicle not found")
	}
	v.CurrentLatitude = &lat
	v.CurrentLongitude = &lng
	r.vehicles[id] = v
	return nil
}

func (r *inMemoryVehicleRepository) SyncMode(licensePlate string, mode model.VehicleMode) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, v := range r.vehicles {
		if v.LicensePlate == licensePlate {
			v.Mode = mode
			r.vehicles[id] = v
			return nil
		}
	}
	return nil
}

func (r *inMemoryVehicleRepository) GetByQRToken(token string) (model.Vehicle, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, v := range r.vehicles {
		if v.QRToken == token {
			return v, true
		}
	}
	return model.Vehicle{}, false
}

// ── InMemory RouteRepository ──────────────────────────────────────────────────

type inMemoryRouteRepository struct {
	mu     sync.RWMutex
	routes []model.Route
}

func NewInMemoryRouteRepository() RouteRepository {
	return &inMemoryRouteRepository{}
}

func (r *inMemoryRouteRepository) Create(route model.Route) (model.Route, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.routes = append(r.routes, route)
	return route, nil
}

func (r *inMemoryRouteRepository) Update(route model.Route) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, existing := range r.routes {
		if existing.ID == route.ID {
			r.routes[i] = route
			return nil
		}
	}
	return fmt.Errorf("route not found")
}

func (r *inMemoryRouteRepository) GetByDriverAndDate(driverID string, date model.DateOnly) (model.Route, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, route := range r.routes {
		if route.DriverID == driverID && route.Date.Equal(date) {
			return route, nil
		}
	}
	return model.Route{}, fmt.Errorf("route not found")
}

func (r *inMemoryRouteRepository) GetByID(id string) (model.Route, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, route := range r.routes {
		if route.ID == id {
			return route, nil
		}
	}
	return model.Route{}, fmt.Errorf("route not found")
}

func (r *inMemoryRouteRepository) RemoveShipmentFromDate(trackingID string, date model.DateOnly) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, route := range r.routes {
		if !route.Date.Equal(date) {
			continue
		}
		filtered := route.ShipmentIDs[:0]
		for _, id := range route.ShipmentIDs {
			if id != trackingID {
				filtered = append(filtered, id)
			}
		}
		r.routes[i].ShipmentIDs = filtered
	}
	return nil
}

func (r *inMemoryRouteRepository) UpdateStatus(id string, status model.RouteStatus, startedAt *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, route := range r.routes {
		if route.ID == id {
			r.routes[i].Status = status
			r.routes[i].StartedAt = startedAt
			return nil
		}
	}
	return fmt.Errorf("route not found")
}

func (r *inMemoryRouteRepository) ListByDateRange(from, to time.Time) []model.Route {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []model.Route
	for _, route := range r.routes {
		d := time.Time(route.Date)
		if !d.Before(from) && !d.After(to) {
			result = append(result, route)
		}
	}
	return result
}

// ── InMemory CustomerRepository ───────────────────────────────────────────────

type inMemoryCustomerRepository struct {
	mu        sync.RWMutex
	customers map[string]model.Customer // keyed by DNI
}

func NewInMemoryCustomerRepository() CustomerRepository {
	return &inMemoryCustomerRepository{customers: make(map[string]model.Customer)}
}

func (r *inMemoryCustomerRepository) Upsert(customer model.Customer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.customers[customer.DNI] = customer
}

func (r *inMemoryCustomerRepository) GetByDNI(dni string) (model.Customer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.customers[dni]
	return c, ok
}

// ── InMemory CommentRepository ────────────────────────────────────────────────

type inMemoryCommentRepository struct {
	mu       sync.RWMutex
	comments []model.ShipmentComment
}

func NewInMemoryCommentRepository() CommentRepository {
	return &inMemoryCommentRepository{}
}

func (r *inMemoryCommentRepository) AddComment(comment model.ShipmentComment) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.comments = append(r.comments, comment)
	return nil
}

func (r *inMemoryCommentRepository) GetComments(trackingID string) ([]model.ShipmentComment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []model.ShipmentComment
	for _, c := range r.comments {
		if c.TrackingID == trackingID {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

// ── InMemory PricingConfigRepository ──────────────────────────────────────────

type inMemoryPricingConfigRepository struct {
	mu  sync.RWMutex
	cfg model.PricingConfig
}

func NewInMemoryPricingConfigRepository() PricingConfigRepository {
	return &inMemoryPricingConfigRepository{cfg: model.DefaultPricingConfig()}
}

func (r *inMemoryPricingConfigRepository) Get() model.PricingConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.cfg
}

func (r *inMemoryPricingConfigRepository) Update(cfg model.PricingConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cfg = cfg
	return nil
}

// ── InMemory IncidentRepository ───────────────────────────────────────────────

type inMemoryIncidentRepository struct {
	mu        sync.RWMutex
	incidents []model.ShipmentIncident
}

func NewInMemoryIncidentRepository() IncidentRepository {
	return &inMemoryIncidentRepository{}
}

func (r *inMemoryIncidentRepository) ReportIncident(incident model.ShipmentIncident) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.incidents = append(r.incidents, incident)
	return nil
}

func (r *inMemoryIncidentRepository) GetIncidents(trackingID string) ([]model.ShipmentIncident, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []model.ShipmentIncident
	for _, inc := range r.incidents {
		if inc.TrackingID == trackingID {
			out = append(out, inc)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

// =============================================================================
// In-memory RoutingConfigRepository (tests only)
// =============================================================================

type inMemoryRoutingConfigRepository struct {
	mu  sync.RWMutex
	cfg model.RoutingConfig
	set bool
}

func NewInMemoryRoutingConfigRepository() RoutingConfigRepository {
	return &inMemoryRoutingConfigRepository{}
}

func (r *inMemoryRoutingConfigRepository) Get() model.RoutingConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.set {
		return model.DefaultRoutingConfig()
	}
	return r.cfg
}

func (r *inMemoryRoutingConfigRepository) Update(cfg model.RoutingConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cfg = cfg
	r.set = true
	return nil
}

// ── InMemory ClaimRepository ──────────────────────────────────────────────────

type inMemoryClaimRepository struct {
	mu      sync.RWMutex
	claims  []model.Claim
	nextSeq int64
}

func NewInMemoryClaimRepository() ClaimRepository {
	return &inMemoryClaimRepository{nextSeq: 10000}
}

func (r *inMemoryClaimRepository) NextID() (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextSeq++
	return fmt.Sprintf("REC-%d", r.nextSeq), nil
}

func (r *inMemoryClaimRepository) Create(claim model.Claim) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.claims = append(r.claims, claim)
	return nil
}

func (r *inMemoryClaimRepository) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, c := range r.claims {
		if c.ID == id {
			r.claims = append(r.claims[:i], r.claims[i+1:]...)
			return nil
		}
	}
	return ErrClaimNotFound
}

func (r *inMemoryClaimRepository) GetByID(id string) (model.Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, c := range r.claims {
		if c.ID == id {
			return c, nil
		}
	}
	return model.Claim{}, ErrClaimNotFound
}

func (r *inMemoryClaimRepository) GetLatestByTrackingID(trackingID string) (model.Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var latest *model.Claim
	for i := range r.claims {
		if r.claims[i].TrackingID != trackingID {
			continue
		}
		if latest == nil || r.claims[i].UpdatedAt.After(latest.UpdatedAt) {
			candidate := r.claims[i]
			latest = &candidate
		}
	}
	if latest == nil {
		return model.Claim{}, ErrClaimNotFound
	}
	return *latest, nil
}

func (r *inMemoryClaimRepository) GetLatestByTrackingIDAndDNI(trackingID, dni string) (model.Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var latest *model.Claim
	for i := range r.claims {
		if r.claims[i].TrackingID != trackingID || r.claims[i].ClaimantDNI != dni {
			continue
		}
		if latest == nil || r.claims[i].UpdatedAt.After(latest.UpdatedAt) {
			candidate := r.claims[i]
			latest = &candidate
		}
	}
	if latest == nil {
		return model.Claim{}, ErrClaimNotFound
	}
	return *latest, nil
}

func (r *inMemoryClaimRepository) ListAll() ([]model.Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]model.Claim, len(r.claims))
	copy(out, r.claims)
	return out, nil
}

func (r *inMemoryClaimRepository) Resolve(id string, resolutionType model.ClaimResolutionType, status model.ClaimStatus, updatedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		if r.claims[i].ID == id {
			r.claims[i].ResolutionType = resolutionType
			r.claims[i].Status = status
			r.claims[i].UpdatedAt = updatedAt
			return nil
		}
	}
	return ErrClaimNotFound
}

func (r *inMemoryClaimRepository) UpdateStatus(id string, status model.ClaimStatus, updatedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		if r.claims[i].ID == id {
			r.claims[i].Status = status
			r.claims[i].UpdatedAt = updatedAt
			return nil
		}
	}
	return ErrClaimNotFound
}

func (r *inMemoryClaimRepository) UpdateTransferStatus(id, assignedBranchID string, status model.ClaimStatus, updatedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		if r.claims[i].ID == id {
			r.claims[i].Status = status
			r.claims[i].AssignedBranchID = assignedBranchID
			r.claims[i].UpdatedAt = updatedAt
			return nil
		}
	}
	return ErrClaimNotFound
}

func (r *inMemoryClaimRepository) ListByAssignedBranch(branchID string) ([]model.Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []model.Claim
	for _, c := range r.claims {
		if c.AssignedBranchID == branchID {
			result = append(result, c)
		}
	}
	return result, nil
}

// ListNonTerminal devuelve los reclamos cuyo status NO es resuelto. Lo consume
// el job de escalado automático para evaluar inactividad.
func (r *inMemoryClaimRepository) ListNonTerminal() ([]model.Claim, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []model.Claim
	for _, c := range r.claims {
		if strings.HasPrefix(string(c.Status), "resolved_") {
			continue
		}
		result = append(result, c)
	}
	return result, nil
}

// UpdatePriority sobreescribe la prioridad y la nota de un reclamo, dejando
// el resto del registro intacto. Lo usa el job de escalado automático.
func (r *inMemoryClaimRepository) UpdatePriority(id string, priority model.ClaimPriority, note string, updatedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.claims {
		if r.claims[i].ID == id {
			r.claims[i].Priority = priority
			r.claims[i].PriorityNote = note
			r.claims[i].UpdatedAt = updatedAt
			return nil
		}
	}
	return ErrClaimNotFound
}

// CountOpenAndUrgentByBranch en memoria considera solo el assigned_branch_id
// del reclamo (no resuelve el origin_branch_id del envío); suficiente para
// tests, que pueden setear ese campo directamente.
func (r *inMemoryClaimRepository) CountOpenAndUrgentByBranch(branchID string) (totalOpen, urgentOpen int, err error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, c := range r.claims {
		if c.AssignedBranchID != branchID {
			continue
		}
		if strings.HasPrefix(string(c.Status), "resolved_") || c.Status == model.ClaimStatusTransferRejected {
			continue
		}
		totalOpen++
		if c.Priority == model.ClaimPriorityUrgente {
			urgentOpen++
		}
	}
	return totalOpen, urgentOpen, nil
}

// ── InMemory ClaimEventRepository ─────────────────────────────────────────────

type inMemoryClaimEventRepository struct {
	mu     sync.RWMutex
	events []model.DomainEvent
}

func NewInMemoryClaimEventRepository() ClaimEventRepository {
	return &inMemoryClaimEventRepository{}
}

func (r *inMemoryClaimEventRepository) Append(event model.DomainEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	maxVer := 0
	for _, e := range r.events {
		if e.TrackingID == event.TrackingID && e.Version > maxVer {
			maxVer = e.Version
		}
	}
	event.Version = maxVer + 1
	r.events = append(r.events, event)
	return nil
}

func (r *inMemoryClaimEventRepository) LoadStream(claimID string) ([]model.DomainEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []model.DomainEvent
	for _, e := range r.events {
		if e.TrackingID == claimID {
			out = append(out, e)
		}
	}
	if len(out) == 0 {
		return nil, ErrClaimEventStreamNotFound
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}
