package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

// DashboardPreferencesRepository manages per-user dashboard metric ordering and visibility.
type DashboardPreferencesRepository interface {
	GetForUser(userID string) ([]model.UserDashboardPreference, error)
	SaveForUser(userID string, prefs []model.UserDashboardPreference) error
}

type postgresDashboardPrefsRepo struct {
	db *sql.DB
}

func NewPostgresDashboardPreferencesRepository(db *sql.DB) DashboardPreferencesRepository {
	return &postgresDashboardPrefsRepo{db: db}
}

func (r *postgresDashboardPrefsRepo) GetForUser(userID string) ([]model.UserDashboardPreference, error) {
	rows, err := r.db.Query(
		`SELECT user_id, metric_id, sort_order, is_hidden
		 FROM user_dashboard_preferences
		 WHERE user_id = $1
		 ORDER BY sort_order`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var prefs []model.UserDashboardPreference
	for rows.Next() {
		var p model.UserDashboardPreference
		if err := rows.Scan(&p.UserID, &p.MetricID, &p.SortOrder, &p.IsHidden); err != nil {
			return nil, err
		}
		prefs = append(prefs, p)
	}
	return prefs, rows.Err()
}

func (r *postgresDashboardPrefsRepo) SaveForUser(userID string, prefs []model.UserDashboardPreference) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, p := range prefs {
		if _, err := tx.Exec(
			`INSERT INTO user_dashboard_preferences (user_id, metric_id, sort_order, is_hidden)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (user_id, metric_id) DO UPDATE
			   SET sort_order = EXCLUDED.sort_order,
			       is_hidden  = EXCLUDED.is_hidden,
			       updated_at = NOW()`,
			userID, p.MetricID, p.SortOrder, p.IsHidden,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
