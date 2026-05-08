package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var (
	ErrBranchNotFound           = errors.New("sucursal no encontrada")
	ErrBranchDuplicateName      = errors.New("ya existe una sucursal con ese nombre")
	ErrBranchDuplicateID        = errors.New("ya existe una sucursal con ese ID")
	ErrBranchNotActive          = errors.New("la sucursal no está activa")
	ErrBranchHasActiveShipments = errors.New("la sucursal tiene envíos activos")
)

// ActiveShipmentCounter counts non-terminal shipments assigned to a branch.
type ActiveShipmentCounter interface {
	CountActiveByBranch(branchID string) int
}

type BranchService struct {
	repo    repository.BranchRepository
	counter ActiveShipmentCounter
}

func NewBranchService(repo repository.BranchRepository, counter ActiveShipmentCounter) *BranchService {
	return &BranchService{repo: repo, counter: counter}
}

func (s *BranchService) List() []model.Branch {
	return s.repo.List()
}

func (s *BranchService) ListActive() []model.Branch {
	return s.repo.ListActive()
}

func (s *BranchService) Search(query string) []model.Branch {
	if strings.TrimSpace(query) == "" {
		return s.repo.List()
	}
	return s.repo.GetByNameOrID(query)
}

func (s *BranchService) Create(req model.CreateBranchRequest) (model.Branch, error) {
	if strings.TrimSpace(req.Name) == "" {
		return model.Branch{}, fmt.Errorf("el nombre es obligatorio")
	}
	if strings.TrimSpace(req.Street) == "" {
		return model.Branch{}, fmt.Errorf("la calle es obligatoria")
	}
	if strings.TrimSpace(req.City) == "" {
		return model.Branch{}, fmt.Errorf("la ciudad es obligatoria")
	}
	if strings.TrimSpace(req.Province) == "" {
		return model.Branch{}, fmt.Errorf("la provincia es obligatoria")
	}
	if strings.TrimSpace(req.PostalCode) == "" {
		return model.Branch{}, fmt.Errorf("el código postal es obligatorio")
	}

	id := strings.ToLower(strings.TrimSpace(req.ID))
	if id == "" {
		id = uuid.New().String()
	}

	maxCap := req.MaxCapacity
	if maxCap <= 0 {
		maxCap = 50
	}

	lat, lng := req.Latitude, req.Longitude
	if lat == nil {
		if gLat, gLng, _ := geo.GeocodeBranch(req.City, req.Province); gLat != 0 || gLng != 0 {
			lat, lng = &gLat, &gLng
		}
	}

	branch := model.Branch{
		ID:   id,
		Name: req.Name,
		Address: model.Address{
			Street:     req.Street,
			City:       req.City,
			Province:   req.Province,
			PostalCode: req.PostalCode,
		},
		Province:    req.Province,
		Status:      model.BranchStatusActive,
		MaxCapacity: maxCap,
		Latitude:    lat,
		Longitude:   lng,
	}

	if err := s.repo.Create(branch); err != nil {
		if err == repository.ErrDuplicateBranchID {
			return model.Branch{}, fmt.Errorf("ya existe una sucursal con el ID '%s': %w", branch.ID, ErrBranchDuplicateID)
		}
		if err == repository.ErrDuplicateBranchName {
			return model.Branch{}, fmt.Errorf("ya existe una sucursal con el nombre '%s': %w", req.Name, ErrBranchDuplicateName)
		}
		return model.Branch{}, fmt.Errorf("error al crear la sucursal: %w", err)
	}

	created, _ := s.repo.GetByID(branch.ID)
	return created, nil
}

func (s *BranchService) Update(id string, req model.UpdateBranchRequest) (model.Branch, error) {
	branch, found := s.repo.GetByID(id)
	if !found {
		return model.Branch{}, ErrBranchNotFound
	}

	if branch.Status != model.BranchStatusActive {
		return model.Branch{}, fmt.Errorf("no se puede editar una sucursal inactiva (estado actual: %s): %w", branch.Status, ErrBranchNotActive)
	}

	if strings.TrimSpace(req.Name) == "" {
		return model.Branch{}, fmt.Errorf("el nombre es obligatorio")
	}
	if strings.TrimSpace(req.Street) == "" {
		return model.Branch{}, fmt.Errorf("la calle es obligatoria")
	}
	if strings.TrimSpace(req.City) == "" {
		return model.Branch{}, fmt.Errorf("la ciudad es obligatoria")
	}
	if strings.TrimSpace(req.Province) == "" {
		return model.Branch{}, fmt.Errorf("la provincia es obligatoria")
	}
	if strings.TrimSpace(req.PostalCode) == "" {
		return model.Branch{}, fmt.Errorf("el código postal es obligatorio")
	}

	maxCap := req.MaxCapacity
	if maxCap <= 0 {
		maxCap = branch.MaxCapacity
	}

	updateLat, updateLng := req.Latitude, req.Longitude
	if updateLat == nil {
		if gLat, gLng, _ := geo.GeocodeBranch(req.City, req.Province); gLat != 0 || gLng != 0 {
			updateLat, updateLng = &gLat, &gLng
		}
	}

	update := model.Branch{
		Name: req.Name,
		Address: model.Address{
			Street:     req.Street,
			City:       req.City,
			Province:   req.Province,
			PostalCode: req.PostalCode,
		},
		Province:    req.Province,
		MaxCapacity: maxCap,
		Latitude:    updateLat,
		Longitude:   updateLng,
	}

	if err := s.repo.Update(id, update); err != nil {
		if err == repository.ErrDuplicateBranchName {
			return model.Branch{}, fmt.Errorf("ya existe una sucursal con el nombre '%s': %w", req.Name, ErrBranchDuplicateName)
		}
		if repository.IsNotUpdatable(err) {
			return model.Branch{}, fmt.Errorf("no se puede editar una sucursal inactiva: %w", ErrBranchNotActive)
		}
		return model.Branch{}, fmt.Errorf("error al actualizar la sucursal: %w", err)
	}

	updated, _ := s.repo.GetByID(id)
	return updated, nil
}

func (s *BranchService) UpdateStatus(id string, req model.UpdateBranchStatusRequest, username string) (model.Branch, error) {
	_, found := s.repo.GetByID(id)
	if !found {
		return model.Branch{}, ErrBranchNotFound
	}

	validStatuses := map[model.BranchStatus]bool{
		model.BranchStatusActive:       true,
		model.BranchStatusInactive:     true,
		model.BranchStatusOutOfService: true,
	}
	if !validStatuses[req.Status] {
		return model.Branch{}, fmt.Errorf("estado inválido: %s", req.Status)
	}

	if req.Status != model.BranchStatusActive && !req.Force && s.counter != nil {
		if n := s.counter.CountActiveByBranch(id); n > 0 {
			return model.Branch{}, fmt.Errorf("%w: %d pedido(s) activo(s) asignados", ErrBranchHasActiveShipments, n)
		}
	}

	if err := s.repo.UpdateStatus(id, req.Status, username); err != nil {
		return model.Branch{}, fmt.Errorf("error al actualizar el estado: %w", err)
	}

	updated, _ := s.repo.GetByID(id)
	return updated, nil
}

func (s *BranchService) IsBranchActive(branchID string) bool {
	b, found := s.repo.GetByID(branchID)
	return found && b.Status == model.BranchStatusActive
}

const capacityAlertThreshold = 0.80

func (s *BranchService) GetCapacity(branchID string) (model.BranchCapacity, error) {
	b, found := s.repo.GetByID(branchID)
	if !found {
		return model.BranchCapacity{}, ErrBranchNotFound
	}

	current := 0
	if s.counter != nil {
		current = s.counter.CountActiveByBranch(branchID)
	}

	maxCap := b.MaxCapacity
	if maxCap <= 0 {
		maxCap = 50
	}

	pct := float64(current) / float64(maxCap) * 100

	return model.BranchCapacity{
		BranchID:    branchID,
		Current:     current,
		MaxCapacity: maxCap,
		Percentage:  pct,
		Alert:       pct >= capacityAlertThreshold*100,
	}, nil
}
