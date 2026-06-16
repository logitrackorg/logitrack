package service

import "github.com/logitrack/core/internal/repository"

type DashboardResetService struct {
	repo repository.DashboardResetRepository
}

func NewDashboardResetService(repo repository.DashboardResetRepository) *DashboardResetService {
	return &DashboardResetService{repo: repo}
}

func (s *DashboardResetService) ResetUser(adminUserID, adminUsername, targetUserID string) error {
	return s.repo.ResetUserPreferences(adminUserID, adminUsername, targetUserID)
}

func (s *DashboardResetService) ResetAll(adminUserID, adminUsername string) error {
	return s.repo.ResetAllPreferences(adminUserID, adminUsername)
}

func (s *DashboardResetService) GetResetFlag(userID string) (bool, error) {
	return s.repo.GetResetFlag(userID)
}

func (s *DashboardResetService) ClearResetFlag(userID string) error {
	return s.repo.ClearResetFlag(userID)
}
