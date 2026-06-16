package repository

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/logitrack/core/internal/model"
)

// DashboardProfilesRepository manages named dashboard configuration snapshots.
type DashboardProfilesRepository interface {
	ListForUser(userID string) ([]model.DashboardProfile, error)
	CountForUser(userID string) (int, error)
	Create(userID, name string, prefs []model.UserDashboardPreference) (*model.DashboardProfile, error)
	Delete(id, userID string) error
}

type postgresDashboardProfilesRepo struct {
	db *sql.DB
}

func NewPostgresDashboardProfilesRepository(db *sql.DB) DashboardProfilesRepository {
	return &postgresDashboardProfilesRepo{db: db}
}

func (r *postgresDashboardProfilesRepo) ListForUser(userID string) ([]model.DashboardProfile, error) {
	rows, err := r.db.Query(
		`SELECT id, user_id, name, preferences, created_at
		 FROM user_dashboard_profiles
		 WHERE user_id = $1
		 ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []model.DashboardProfile
	for rows.Next() {
		var p model.DashboardProfile
		var prefsJSON []byte
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &prefsJSON, &p.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(prefsJSON, &p.Preferences); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

func (r *postgresDashboardProfilesRepo) CountForUser(userID string) (int, error) {
	var count int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM user_dashboard_profiles WHERE user_id = $1`,
		userID,
	).Scan(&count)
	return count, err
}

func (r *postgresDashboardProfilesRepo) Create(userID, name string, prefs []model.UserDashboardPreference) (*model.DashboardProfile, error) {
	prefsJSON, err := json.Marshal(prefs)
	if err != nil {
		return nil, err
	}

	var p model.DashboardProfile
	var scanPrefsJSON []byte
	err = r.db.QueryRow(
		`INSERT INTO user_dashboard_profiles (user_id, name, preferences)
		 VALUES ($1, $2, $3)
		 RETURNING id, user_id, name, preferences, created_at`,
		userID, name, prefsJSON,
	).Scan(&p.ID, &p.UserID, &p.Name, &scanPrefsJSON, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(scanPrefsJSON, &p.Preferences); err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *postgresDashboardProfilesRepo) Delete(id, userID string) error {
	result, err := r.db.Exec(
		`DELETE FROM user_dashboard_profiles WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return errors.New("perfil no encontrado")
	}
	return nil
}
