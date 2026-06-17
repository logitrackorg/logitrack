package repository

import (
	"database/sql"
)

// DashboardResetRepository handles per-user dashboard reset flags and the associated audit trail.
type DashboardResetRepository interface {
	// ResetUserPreferences deletes a user's order/visibility prefs, sets the reset flag,
	// and writes an audit row — all in a single transaction.
	ResetUserPreferences(adminUserID, adminUsername, targetUserID string) error
	// ResetAllPreferences resets preferences for all supervisor/manager users atomically.
	ResetAllPreferences(adminUserID, adminUsername string) error
	// GetResetFlag returns whether the user still has an unacknowledged admin reset.
	GetResetFlag(userID string) (bool, error)
	// ClearResetFlag marks the reset notification as acknowledged.
	ClearResetFlag(userID string) error
}

type postgresDashboardResetRepo struct {
	db *sql.DB
}

func NewPostgresDashboardResetRepository(db *sql.DB) DashboardResetRepository {
	return &postgresDashboardResetRepo{db: db}
}

func (r *postgresDashboardResetRepo) ResetUserPreferences(adminUserID, adminUsername, targetUserID string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`DELETE FROM user_dashboard_preferences WHERE user_id = $1`,
		targetUserID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`DELETE FROM user_metric_permissions WHERE user_id = $1`,
		targetUserID,
	); err != nil {
		return err
	}

	// Restore role-level permissions to all-visible for supervisor and manager.
	if _, err := tx.Exec(
		`UPDATE role_metric_permissions SET is_visible = true, updated_at = NOW()
		 WHERE role_name IN ('supervisor', 'manager')`,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO user_dashboard_reset_flags (user_id, was_reset, reset_at, reset_by)
		 VALUES ($1, true, NOW(), $2)
		 ON CONFLICT (user_id) DO UPDATE SET was_reset = true, reset_at = NOW(), reset_by = $2`,
		targetUserID, adminUserID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO permission_audit_logs
		 (admin_user_id, admin_username, batch_id, affected_role, metric_id, metric_name,
		  action, previous_state, new_state)
		 VALUES ($1, $2, gen_random_uuid(), 'usuario', $3,
		         'Preferencias de dashboard', 'reset_dashboard', true, false)`,
		adminUserID, adminUsername, targetUserID,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *postgresDashboardResetRepo) ResetAllPreferences(adminUserID, adminUsername string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM user_dashboard_preferences`); err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM user_metric_permissions`); err != nil {
		return err
	}

	// Restore role-level permissions to all-visible for supervisor and manager.
	if _, err := tx.Exec(
		`UPDATE role_metric_permissions SET is_visible = true, updated_at = NOW()
		 WHERE role_name IN ('supervisor', 'manager')`,
	); err != nil {
		return err
	}

	// Set reset flag for every supervisor/manager (the only roles that can view the dashboard).
	if _, err := tx.Exec(
		`INSERT INTO user_dashboard_reset_flags (user_id, was_reset, reset_at, reset_by)
		 SELECT id, true, NOW(), $1 FROM users WHERE role IN ('supervisor', 'manager')
		 ON CONFLICT (user_id) DO UPDATE SET was_reset = true, reset_at = NOW(), reset_by = $1`,
		adminUserID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO permission_audit_logs
		 (admin_user_id, admin_username, batch_id, affected_role, metric_id, metric_name,
		  action, previous_state, new_state)
		 VALUES ($1, $2, gen_random_uuid(), 'todos', 'all',
		         'Preferencias de dashboard', 'reset_dashboard_all', true, false)`,
		adminUserID, adminUsername,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (r *postgresDashboardResetRepo) GetResetFlag(userID string) (bool, error) {
	var wasReset bool
	err := r.db.QueryRow(
		`SELECT was_reset FROM user_dashboard_reset_flags WHERE user_id = $1`,
		userID,
	).Scan(&wasReset)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return wasReset, err
}

func (r *postgresDashboardResetRepo) ClearResetFlag(userID string) error {
	_, err := r.db.Exec(
		`UPDATE user_dashboard_reset_flags SET was_reset = false WHERE user_id = $1`,
		userID,
	)
	return err
}
