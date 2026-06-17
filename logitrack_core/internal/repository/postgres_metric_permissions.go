package repository

import (
	"database/sql"
	"fmt"

	"github.com/logitrack/core/internal/model"
)

// MetricPermissionsRepository manages role_metric_permissions, user_metric_permissions and permission_audit_logs.
type MetricPermissionsRepository interface {
	GetAll() ([]model.MetricPermission, error)
	GetForRole(role string) (map[string]bool, error)
	Set(role, metricID string, isVisible bool) error
	SetBatch(adminUserID, adminUsername, batchID string, changes []model.PermissionChange) error
	ListAuditLogs(role, startDate, endDate string) ([]model.PermissionAuditLog, error)
	// User-level overrides (user_metric_permissions).
	GetAllUserOverrides() (map[string]map[string]bool, error)
	GetUserOverrides(userID string) (map[string]bool, error)
	SetUserOverride(userID, metricID string, isVisible bool) error
	DeleteUserOverride(userID, metricID string) error
}

type postgresMetricPermissionsRepo struct {
	db *sql.DB
}

func NewPostgresMetricPermissionsRepository(db *sql.DB) MetricPermissionsRepository {
	return &postgresMetricPermissionsRepo{db: db}
}

func (r *postgresMetricPermissionsRepo) GetAll() ([]model.MetricPermission, error) {
	rows, err := r.db.Query(
		`SELECT role_name, metric_id, is_visible FROM role_metric_permissions ORDER BY role_name, metric_id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var perms []model.MetricPermission
	for rows.Next() {
		var p model.MetricPermission
		if err := rows.Scan(&p.RoleName, &p.MetricID, &p.IsVisible); err != nil {
			return nil, err
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func (r *postgresMetricPermissionsRepo) GetForRole(role string) (map[string]bool, error) {
	rows, err := r.db.Query(
		`SELECT metric_id, is_visible FROM role_metric_permissions WHERE role_name = $1`,
		role,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]bool)
	for rows.Next() {
		var metricID string
		var isVisible bool
		if err := rows.Scan(&metricID, &isVisible); err != nil {
			return nil, err
		}
		result[metricID] = isVisible
	}
	return result, rows.Err()
}

func (r *postgresMetricPermissionsRepo) Set(role, metricID string, isVisible bool) error {
	_, err := r.db.Exec(`
		INSERT INTO role_metric_permissions (role_name, metric_id, is_visible)
		VALUES ($1, $2, $3)
		ON CONFLICT (role_name, metric_id) DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_at = NOW()
	`, role, metricID, isVisible)
	return err
}

// SetBatch applies all changes in a single transaction and writes one audit log row per change.
func (r *postgresMetricPermissionsRepo) SetBatch(adminUserID, adminUsername, batchID string, changes []model.PermissionChange) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	for _, ch := range changes {
		// Read current state within the transaction.
		var prevState bool
		err := tx.QueryRow(
			`SELECT is_visible FROM role_metric_permissions WHERE role_name=$1 AND metric_id=$2`,
			ch.RoleName, ch.MetricID,
		).Scan(&prevState)
		if err == sql.ErrNoRows {
			prevState = true // matches the default seeded value
		} else if err != nil {
			return err
		}

		// Skip no-ops.
		if prevState == ch.IsVisible {
			continue
		}

		// Update the permission.
		if _, err = tx.Exec(`
			INSERT INTO role_metric_permissions (role_name, metric_id, is_visible)
			VALUES ($1, $2, $3)
			ON CONFLICT (role_name, metric_id) DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_at = NOW()
		`, ch.RoleName, ch.MetricID, ch.IsVisible); err != nil {
			return err
		}

		action := "activada"
		if !ch.IsVisible {
			action = "desactivada"
		}
		metricLabel := ch.MetricID
		for _, m := range model.AllMetrics {
			if m.ID == ch.MetricID {
				metricLabel = m.Label
				break
			}
		}

		// Insert audit log row.
		if _, err = tx.Exec(`
			INSERT INTO permission_audit_logs
				(admin_user_id, admin_username, batch_id, affected_role, metric_id, metric_name, action, previous_state, new_state)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, adminUserID, adminUsername, batchID, ch.RoleName, ch.MetricID, metricLabel, action, prevState, ch.IsVisible); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ── User-level overrides ──────────────────────────────────────────────────────

func (r *postgresMetricPermissionsRepo) GetAllUserOverrides() (map[string]map[string]bool, error) {
	rows, err := r.db.Query(
		`SELECT user_id, metric_id, is_visible FROM user_metric_permissions ORDER BY user_id, metric_id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]map[string]bool)
	for rows.Next() {
		var userID, metricID string
		var isVisible bool
		if err := rows.Scan(&userID, &metricID, &isVisible); err != nil {
			return nil, err
		}
		if result[userID] == nil {
			result[userID] = make(map[string]bool)
		}
		result[userID][metricID] = isVisible
	}
	return result, rows.Err()
}

func (r *postgresMetricPermissionsRepo) GetUserOverrides(userID string) (map[string]bool, error) {
	rows, err := r.db.Query(
		`SELECT metric_id, is_visible FROM user_metric_permissions WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]bool)
	for rows.Next() {
		var metricID string
		var isVisible bool
		if err := rows.Scan(&metricID, &isVisible); err != nil {
			return nil, err
		}
		result[metricID] = isVisible
	}
	return result, rows.Err()
}

func (r *postgresMetricPermissionsRepo) SetUserOverride(userID, metricID string, isVisible bool) error {
	_, err := r.db.Exec(`
		INSERT INTO user_metric_permissions (user_id, metric_id, is_visible)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, metric_id) DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_at = NOW()
	`, userID, metricID, isVisible)
	return err
}

func (r *postgresMetricPermissionsRepo) DeleteUserOverride(userID, metricID string) error {
	_, err := r.db.Exec(
		`DELETE FROM user_metric_permissions WHERE user_id = $1 AND metric_id = $2`,
		userID, metricID,
	)
	return err
}

// ── Audit logs ────────────────────────────────────────────────────────────────

// ListAuditLogs returns audit log entries, newest first. role/startDate/endDate are optional filters.
func (r *postgresMetricPermissionsRepo) ListAuditLogs(role, startDate, endDate string) ([]model.PermissionAuditLog, error) {
	query := `SELECT id, created_at, admin_user_id, admin_username, batch_id,
	                 affected_role, metric_id, metric_name, action, previous_state, new_state
	          FROM permission_audit_logs WHERE 1=1`
	args := []interface{}{}
	n := 1

	if role != "" {
		query += fmt.Sprintf(" AND affected_role = $%d", n)
		args = append(args, role)
		n++
	}
	if startDate != "" {
		query += fmt.Sprintf(" AND created_at >= $%d::date", n)
		args = append(args, startDate)
		n++
	}
	if endDate != "" {
		query += fmt.Sprintf(" AND created_at < ($%d::date + INTERVAL '1 day')", n)
		args = append(args, endDate)
		n++
	}
	query += " ORDER BY created_at DESC LIMIT 500"

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []model.PermissionAuditLog
	for rows.Next() {
		var l model.PermissionAuditLog
		if err := rows.Scan(
			&l.ID, &l.CreatedAt, &l.AdminUserID, &l.AdminUsername, &l.BatchID,
			&l.AffectedRole, &l.MetricID, &l.MetricName, &l.Action, &l.PreviousState, &l.NewState,
		); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}
