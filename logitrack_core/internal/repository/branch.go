package repository

import (
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/logitrack/core/internal/model"
)

var ErrDuplicateBranchName = errors.New("branch with this name already exists")

type BranchRepository interface {
	List() []model.Branch
	ListActive() []model.Branch
	Create(branch model.Branch) error
	Add(branch model.Branch) // legacy — for seeding; does not validate duplicates
	Update(id string, branch model.Branch) error
	UpdateStatus(id string, status model.BranchStatus, username string) error
	GetByID(id string) (model.Branch, bool)
	GetByCity(city string) (model.Branch, bool)
	GetByNameOrID(query string) []model.Branch
}

type inMemoryBranchRepository struct {
	mu       sync.RWMutex
	branches []model.Branch
}

func NewInMemoryBranchRepository() BranchRepository {
	return &inMemoryBranchRepository{}
}

func (r *inMemoryBranchRepository) List() []model.Branch {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.Branch, len(r.branches))
	copy(result, r.branches)
	return result
}

func (r *inMemoryBranchRepository) ListActive() []model.Branch {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []model.Branch
	for _, b := range r.branches {
		if b.Status == model.BranchStatusActive {
			result = append(result, b)
		}
	}
	return result
}

func (r *inMemoryBranchRepository) Create(branch model.Branch) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, b := range r.branches {
		if strings.EqualFold(b.Name, branch.Name) {
			return ErrDuplicateBranchName
		}
	}

	r.branches = append(r.branches, branch)
	return nil
}

func (r *inMemoryBranchRepository) Update(id string, branch model.Branch) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, b := range r.branches {
		if b.ID == id {
			if b.Status != model.BranchStatusActive {
				return errors.New("cannot update inactive or out-of-service branch")
			}
			for _, other := range r.branches {
				if other.ID != id && strings.EqualFold(other.Name, branch.Name) {
					return ErrDuplicateBranchName
				}
			}
			branch.ID = id
			branch.Status = b.Status
			branch.CreatedAt = b.CreatedAt
			branch.UpdatedAt = time.Now()
			r.branches[i] = branch
			return nil
		}
	}
	return errors.New("branch not found")
}

func (r *inMemoryBranchRepository) UpdateStatus(id string, status model.BranchStatus, username string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, b := range r.branches {
		if b.ID == id {
			r.branches[i].Status = status
			r.branches[i].UpdatedAt = time.Now()
			r.branches[i].UpdatedBy = username
			return nil
		}
	}
	return errors.New("branch not found")
}

func (r *inMemoryBranchRepository) Add(branch model.Branch) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if branch.Status == "" {
		branch.Status = model.BranchStatusActive
	}
	r.branches = append(r.branches, branch)
}

func (r *inMemoryBranchRepository) GetByID(id string) (model.Branch, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, b := range r.branches {
		if b.ID == id {
			return b, true
		}
	}
	return model.Branch{}, false
}

func (r *inMemoryBranchRepository) GetByCity(city string) (model.Branch, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, b := range r.branches {
		if b.Address.City == city {
			return b, true
		}
	}
	return model.Branch{}, false
}

func (r *inMemoryBranchRepository) GetByNameOrID(query string) []model.Branch {
	r.mu.RLock()
	defer r.mu.RUnlock()
	q := strings.ToLower(query)
	var result []model.Branch
	for _, b := range r.branches {
		if strings.Contains(strings.ToLower(b.Name), q) ||
			strings.Contains(strings.ToLower(b.ID), q) ||
			strings.Contains(strings.ToLower(b.Address.City), q) {
			result = append(result, b)
		}
	}
	return result
}
