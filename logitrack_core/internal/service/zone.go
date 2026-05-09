package service

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type ZoneService struct {
	repo repository.ZoneRepository
}

func NewZoneService(repo repository.ZoneRepository) *ZoneService {
	return &ZoneService{repo: repo}
}

func (s *ZoneService) List(includeInactive bool) ([]model.Zone, error) {
	return s.repo.List(includeInactive)
}

func (s *ZoneService) GetByID(id string) (model.Zone, error) {
	return s.repo.GetByID(id)
}

func (s *ZoneService) Create(req model.CreateZoneRequest, createdBy string) (model.Zone, error) {
	if err := validateZone(req.Name, req.Polygon); err != nil {
		return model.Zone{}, err
	}
	now := time.Now()
	zone := model.Zone{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		Polygon:     req.Polygon,
		Active:      true,
		CreatedBy:   createdBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.Create(zone); err != nil {
		return model.Zone{}, err
	}
	return zone, nil
}

func (s *ZoneService) Update(id string, req model.UpdateZoneRequest, updatedBy string) (model.Zone, error) {
	existing, err := s.repo.GetByID(id)
	if err != nil {
		return model.Zone{}, err
	}

	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if len(req.Polygon) > 0 {
		existing.Polygon = req.Polygon
	}
	if req.Active != nil {
		existing.Active = *req.Active
	}
	existing.UpdatedAt = time.Now()

	if err := validateZone(existing.Name, existing.Polygon); err != nil {
		return model.Zone{}, err
	}
	if err := s.repo.Update(id, existing); err != nil {
		return model.Zone{}, err
	}
	return existing, nil
}

func (s *ZoneService) Disable(id string) error {
	active := false
	_, err := s.Update(id, model.UpdateZoneRequest{Active: &active}, "")
	return err
}

// Delete elimina la zona definitivamente de la base.
func (s *ZoneService) Delete(id string) error {
	return s.repo.Delete(id)
}

// IsPointInDangerZone returns true if the given coordinates fall inside any active zone.
func (s *ZoneService) IsPointInDangerZone(lat, lng float64) bool {
	zones, err := s.repo.ListActive()
	if err != nil || len(zones) == 0 {
		return false
	}
	for _, z := range zones {
		if pointInPolygon(lat, lng, z.Polygon) {
			return true
		}
	}
	return false
}

// pointInPolygon uses the ray casting algorithm to determine if a point is inside a polygon.
func pointInPolygon(lat, lng float64, polygon []model.ZonePoint) bool {
	n := len(polygon)
	if n < 3 {
		return false
	}
	inside := false
	j := n - 1
	for i := 0; i < n; i++ {
		xi, yi := polygon[i].Lng, polygon[i].Lat
		xj, yj := polygon[j].Lng, polygon[j].Lat
		if ((yi > lat) != (yj > lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi) {
			inside = !inside
		}
		j = i
	}
	return inside
}

func validateZone(name string, polygon []model.ZonePoint) error {
	if name == "" {
		return fmt.Errorf("el nombre de la zona es obligatorio")
	}
	if len(polygon) < 3 {
		return fmt.Errorf("el polígono debe tener al menos 3 puntos")
	}
	return nil
}
