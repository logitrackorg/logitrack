package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var (
	ErrBranchNotFound      = errors.New("branch not found")
	ErrBranchDuplicateName = errors.New("duplicate branch name")
	ErrBranchNotActive     = errors.New("branch is not active")
)

type BranchService struct {
	repo repository.BranchRepository
}

func NewBranchService(repo repository.BranchRepository) *BranchService {
	return &BranchService{repo: repo}
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
		return model.Branch{}, fmt.Errorf("name is required")
	}
	if strings.TrimSpace(req.Street) == "" {
		return model.Branch{}, fmt.Errorf("street is required")
	}
	if strings.TrimSpace(req.City) == "" {
		return model.Branch{}, fmt.Errorf("city is required")
	}
	if strings.TrimSpace(req.Province) == "" {
		return model.Branch{}, fmt.Errorf("province is required")
	}
	if strings.TrimSpace(req.PostalCode) == "" {
		return model.Branch{}, fmt.Errorf("postal code is required")
	}

	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = uuid.New().String()
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
		Province: req.Province,
		Status:   model.BranchStatusActive,
	}

	if err := s.repo.Create(branch); err != nil {
		if err == repository.ErrDuplicateBranchName {
			return model.Branch{}, fmt.Errorf("a branch with name '%s' already exists: %w", req.Name, ErrBranchDuplicateName)
		}
		return model.Branch{}, fmt.Errorf("failed to create branch: %w", err)
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
		return model.Branch{}, fmt.Errorf("cannot edit a branch that is not active (current status: %s): %w", branch.Status, ErrBranchNotActive)
	}

	if strings.TrimSpace(req.Name) == "" {
		return model.Branch{}, fmt.Errorf("name is required")
	}
	if strings.TrimSpace(req.Street) == "" {
		return model.Branch{}, fmt.Errorf("street is required")
	}
	if strings.TrimSpace(req.City) == "" {
		return model.Branch{}, fmt.Errorf("city is required")
	}
	if strings.TrimSpace(req.Province) == "" {
		return model.Branch{}, fmt.Errorf("province is required")
	}
	if strings.TrimSpace(req.PostalCode) == "" {
		return model.Branch{}, fmt.Errorf("postal code is required")
	}

	update := model.Branch{
		Name: req.Name,
		Address: model.Address{
			Street:     req.Street,
			City:       req.City,
			Province:   req.Province,
			PostalCode: req.PostalCode,
		},
		Province: req.Province,
	}

	if err := s.repo.Update(id, update); err != nil {
		if err == repository.ErrDuplicateBranchName {
			return model.Branch{}, fmt.Errorf("a branch with name '%s' already exists: %w", req.Name, ErrBranchDuplicateName)
		}
		if repository.IsNotUpdatable(err) {
			return model.Branch{}, fmt.Errorf("cannot edit a branch that is not active: %w", ErrBranchNotActive)
		}
		return model.Branch{}, fmt.Errorf("failed to update branch: %w", err)
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
		return model.Branch{}, fmt.Errorf("invalid status: %s", req.Status)
	}

	if err := s.repo.UpdateStatus(id, req.Status, username); err != nil {
		return model.Branch{}, fmt.Errorf("failed to update status: %w", err)
	}

	updated, _ := s.repo.GetByID(id)
	return updated, nil
}

func (s *BranchService) IsBranchActive(branchID string) bool {
	b, found := s.repo.GetByID(branchID)
	return found && b.Status == model.BranchStatusActive
}
