package service

import (
	"errors"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

const maxProfilesPerUser = 5

// ErrMaxProfilesReached is returned when a user tries to create a 6th dashboard profile.
var ErrMaxProfilesReached = errors.New("Máximo 5 perfiles. Elimina uno para crear otro")

type DashboardProfilesService struct {
	repo repository.DashboardProfilesRepository
}

func NewDashboardProfilesService(repo repository.DashboardProfilesRepository) *DashboardProfilesService {
	return &DashboardProfilesService{repo: repo}
}

func (s *DashboardProfilesService) ListForUser(userID string) ([]model.DashboardProfile, error) {
	return s.repo.ListForUser(userID)
}

func (s *DashboardProfilesService) Create(userID, name string, prefs []model.UserDashboardPreference) (*model.DashboardProfile, error) {
	count, err := s.repo.CountForUser(userID)
	if err != nil {
		return nil, err
	}
	if count >= maxProfilesPerUser {
		return nil, ErrMaxProfilesReached
	}
	return s.repo.Create(userID, name, prefs)
}

func (s *DashboardProfilesService) Delete(id, userID string) error {
	return s.repo.Delete(id, userID)
}
