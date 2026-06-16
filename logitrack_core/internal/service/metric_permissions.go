package service

import (
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type MetricPermissionsService struct {
	repo repository.MetricPermissionsRepository
}

func NewMetricPermissionsService(repo repository.MetricPermissionsRepository) *MetricPermissionsService {
	return &MetricPermissionsService{repo: repo}
}

// GetMatrix returns the full admin view: all roles × all metrics with current visibility.
func (s *MetricPermissionsService) GetMatrix() (*model.MetricPermissionsMatrix, error) {
	perms, err := s.repo.GetAll()
	if err != nil {
		return nil, err
	}
	matrix := make(map[string]map[string]bool)
	for _, p := range perms {
		if matrix[p.RoleName] == nil {
			matrix[p.RoleName] = make(map[string]bool)
		}
		matrix[p.RoleName][p.MetricID] = p.IsVisible
	}
	return &model.MetricPermissionsMatrix{
		Metrics: model.AllMetrics,
		Roles:   []string{"supervisor", "manager"},
		Matrix:  matrix,
	}, nil
}

// GetForRole returns metric_id → is_visible for the given role.
func (s *MetricPermissionsService) GetForRole(role string) (map[string]bool, error) {
	return s.repo.GetForRole(role)
}

// Set updates a single role+metric visibility flag.
func (s *MetricPermissionsService) Set(role, metricID string, isVisible bool) error {
	return s.repo.Set(role, metricID, isVisible)
}

// SetBatch applies all changes atomically and writes audit log entries.
func (s *MetricPermissionsService) SetBatch(adminUserID, adminUsername, batchID string, changes []model.PermissionChange) error {
	return s.repo.SetBatch(adminUserID, adminUsername, batchID, changes)
}

// GetAuditLogs returns audit entries, newest first. All filter params are optional.
func (s *MetricPermissionsService) GetAuditLogs(role, startDate, endDate string) ([]model.PermissionAuditLog, error) {
	return s.repo.ListAuditLogs(role, startDate, endDate)
}

// GetEffectivePermissions merges role-level permissions with user-level overrides.
// User overrides always win. Only metrics with an explicit DB entry are included;
// missing keys default to true on the frontend (permissions[id] !== false).
func (s *MetricPermissionsService) GetEffectivePermissions(userID, role string) (map[string]bool, error) {
	rolePerm, err := s.repo.GetForRole(role)
	if err != nil {
		return nil, err
	}
	userOverrides, err := s.repo.GetUserOverrides(userID)
	if err != nil {
		return nil, err
	}
	merged := make(map[string]bool)
	for _, m := range model.AllMetrics {
		if override, ok := userOverrides[m.ID]; ok {
			merged[m.ID] = override
		} else if roleVal, ok := rolePerm[m.ID]; ok {
			// Only include when the role has an explicit DB record.
			merged[m.ID] = roleVal
		}
		// No DB record for this role → omit key → frontend defaults to true (visible).
	}
	return merged, nil
}

// GetAllUserOverrides returns all user-level overrides as userID → metricID → isVisible.
func (s *MetricPermissionsService) GetAllUserOverrides() (map[string]map[string]bool, error) {
	return s.repo.GetAllUserOverrides()
}

// SetUserOverride creates or updates a user-level permission override.
func (s *MetricPermissionsService) SetUserOverride(userID, metricID string, isVisible bool) error {
	return s.repo.SetUserOverride(userID, metricID, isVisible)
}

// DeleteUserOverride removes a user-level override, reverting to the role default.
func (s *MetricPermissionsService) DeleteUserOverride(userID, metricID string) error {
	return s.repo.DeleteUserOverride(userID, metricID)
}
