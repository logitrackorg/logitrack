package service

import (
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type StatsExtendedService struct {
	repo       repository.StatsExtendedRepository
	branchRepo repository.BranchRepository
}

func NewStatsExtendedService(repo repository.StatsExtendedRepository, branchRepo repository.BranchRepository) *StatsExtendedService {
	return &StatsExtendedService{repo: repo, branchRepo: branchRepo}
}

func (s *StatsExtendedService) DriverPerformance(dateFrom, dateTo *time.Time, branchID string) (model.DriverPerformanceResponse, error) {
	return s.repo.DriverPerformance(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) IncidentsByBranch(dateFrom, dateTo *time.Time, branchID string) (model.IncidentsByBranchResponse, error) {
	return s.repo.IncidentsByBranch(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) BillingMetrics(dateFrom, dateTo *time.Time, branchID string) (model.BillingMetricsResponse, error) {
	return s.repo.BillingMetrics(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) BranchRanking(dateFrom, dateTo *time.Time, branchID string) (model.BranchRankingResponse, error) {
	return s.repo.BranchRanking(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) VolumeByTimeWindow(dateFrom, dateTo *time.Time, branchID string) (model.VolumeByTimeWindowResponse, error) {
	return s.repo.VolumeByTimeWindow(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) VolumeByShipmentType(dateFrom, dateTo *time.Time, branchID string) (model.VolumeByShipmentTypeResponse, error) {
	return s.repo.VolumeByShipmentType(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) VolumeByDeliveryMethod(dateFrom, dateTo *time.Time, branchID string) (model.VolumeByDeliveryMethodResponse, error) {
	return s.repo.VolumeByDeliveryMethod(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) ReturnMetrics(dateFrom, dateTo *time.Time, branchID string) (model.ReturnMetricsResponse, error) {
	return s.repo.ReturnMetrics(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) SuccessRateByBranch(dateFrom, dateTo *time.Time, branchID string) (model.SuccessRateByBranchResponse, error) {
	return s.repo.SuccessRateByBranch(dateFrom, dateTo, branchID)
}

func (s *StatsExtendedService) ClaimStats(dateFrom, dateTo *time.Time, branchID string) (model.ClaimStatsResponse, error) {
	return s.repo.ClaimStats(dateFrom, dateTo, branchID)
}
