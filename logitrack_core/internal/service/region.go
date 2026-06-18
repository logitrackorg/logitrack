package service

import (
	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type RegionService struct {
	repo repository.RegionRepository
}

func NewRegionService(repo repository.RegionRepository) *RegionService {
	return &RegionService{repo: repo}
}

func (s *RegionService) List() ([]model.Region, error) {
	regions, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	if regions == nil {
		return []model.Region{}, nil
	}
	return regions, nil
}

func (s *RegionService) Create(req model.CreateRegionRequest) (model.Region, error) {
	region := model.Region{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Type:        model.RegionTypeCustom,
		Coordinates: req.Coordinates,
	}
	if err := s.repo.Create(region); err != nil {
		return model.Region{}, err
	}
	return region, nil
}

// Update renames and re-draws a custom region. The repository enforces that
// only custom regions can be edited (returns sql.ErrNoRows otherwise), which
// the handler maps to 404.
func (s *RegionService) Update(id string, req model.CreateRegionRequest) (model.Region, error) {
	if err := s.repo.Update(id, req.Name, req.Coordinates); err != nil {
		return model.Region{}, err
	}
	return model.Region{
		ID:          id,
		Name:        req.Name,
		Type:        model.RegionTypeCustom,
		Coordinates: req.Coordinates,
	}, nil
}
