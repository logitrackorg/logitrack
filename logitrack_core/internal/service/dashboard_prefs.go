package service

import (
	"sort"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type DashboardPreferencesService struct {
	repo    repository.DashboardPreferencesRepository
	permSvc *MetricPermissionsService
}

func NewDashboardPreferencesService(
	repo repository.DashboardPreferencesRepository,
	permSvc *MetricPermissionsService,
) *DashboardPreferencesService {
	return &DashboardPreferencesService{repo: repo, permSvc: permSvc}
}

// GetEffective returns admin-permitted metrics merged with the user's sort/hide preferences.
// Metrics with no user preference get default sort_order (AllMetrics index) and is_hidden=false.
func (s *DashboardPreferencesService) GetEffective(userID, role string) ([]model.UserDashboardPreference, error) {
	permMap, err := s.permSvc.GetEffectivePermissions(userID, role)
	if err != nil {
		return nil, err
	}

	rawPrefs, err := s.repo.GetForUser(userID)
	if err != nil {
		return nil, err
	}
	prefsMap := make(map[string]model.UserDashboardPreference)
	for _, p := range rawPrefs {
		prefsMap[p.MetricID] = p
	}

	var result []model.UserDashboardPreference
	for i, m := range model.AllMetrics {
		if visible, hasEntry := permMap[m.ID]; hasEntry && !visible {
			continue // admin explicitly blocked this metric
		}
		if p, exists := prefsMap[m.ID]; exists {
			result = append(result, p)
		} else {
			result = append(result, model.UserDashboardPreference{
				UserID:    userID,
				MetricID:  m.ID,
				SortOrder: i,
				IsHidden:  false,
			})
		}
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].SortOrder < result[j].SortOrder
	})
	return result, nil
}

// Save upserts the user's dashboard preferences. Unknown metric IDs are silently ignored.
func (s *DashboardPreferencesService) Save(userID string, prefs []model.UserDashboardPreference) error {
	validMetrics := make(map[string]bool, len(model.AllMetrics))
	for _, m := range model.AllMetrics {
		validMetrics[m.ID] = true
	}
	var valid []model.UserDashboardPreference
	for _, p := range prefs {
		if validMetrics[p.MetricID] {
			p.UserID = userID
			valid = append(valid, p)
		}
	}
	if len(valid) == 0 {
		return nil
	}
	return s.repo.SaveForUser(userID, valid)
}
