package repository

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
)

type postgresNotificationRepository struct {
	db *sql.DB
}

// NewPostgresNotificationRepository creates a new PostgreSQL-backed NotificationRepository.
func NewPostgresNotificationRepository(db *sql.DB) NotificationRepository {
	return &postgresNotificationRepository{db: db}
}

func (r *postgresNotificationRepository) Create(n model.Notification) error {
	if n.ID == "" {
		n.ID = uuid.NewString()
	}
	_, err := r.db.Exec(
		`INSERT INTO notifications (id, user_id, type, title, body, resource_id, read_at, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		n.ID, n.UserID, string(n.Type), n.Title, n.Body, n.ResourceID, n.ReadAt, n.CreatedAt,
	)
	return err
}

func (r *postgresNotificationRepository) ListByUser(userID string, filters NotificationFilters) ([]model.Notification, int, error) {
	args := []interface{}{userID}
	conditions := []string{"user_id = $1"}
	argIdx := 2

	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(title ILIKE $%d OR body ILIKE $%d)", argIdx, argIdx))
		args = append(args, "%"+filters.Search+"%")
		argIdx++
	}
	if filters.DateFrom != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", argIdx))
		args = append(args, *filters.DateFrom)
		argIdx++
	}
	if filters.DateTo != nil {
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", argIdx))
		args = append(args, *filters.DateTo)
		argIdx++
	}

	where := "WHERE " + strings.Join(conditions, " AND ")

	// Count total
	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM notifications %s", where)
	if err := r.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Fetch rows
	limit := filters.Limit
	if limit <= 0 {
		limit = 20
	}
	offset := filters.Offset
	if offset < 0 {
		offset = 0
	}

	// Priority ordering derived from notification type (no DB column needed).
	// Lower number = shown first. Unread notifications always surface above read ones.
	//   1 — critical : fatigue_alert, sla_expired
	//   2 — high     : sla_risk, return_completed, chatbot_pickup_requested
	//   3 — normal   : everything else
	const priorityCase = `
		CASE type
			WHEN 'fatigue_alert'            THEN 1
			WHEN 'sla_expired'              THEN 1
			WHEN 'sla_risk'                 THEN 2
			WHEN 'return_completed'         THEN 2
			WHEN 'chatbot_pickup_requested' THEN 2
			ELSE                                 3
		END`

	listQuery := fmt.Sprintf(
		"SELECT id, user_id, type, title, body, resource_id, read_at, created_at FROM notifications %s ORDER BY (read_at IS NULL) DESC, %s ASC, created_at DESC LIMIT $%d OFFSET $%d",
		where, priorityCase, argIdx, argIdx+1,
	)
	args = append(args, limit, offset)

	rows, err := r.db.Query(listQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var notifications []model.Notification
	for rows.Next() {
		var n model.Notification
		var notifType string
		if err := rows.Scan(&n.ID, &n.UserID, &notifType, &n.Title, &n.Body, &n.ResourceID, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, 0, err
		}
		n.Type = model.NotificationType(notifType)
		notifications = append(notifications, n)
	}
	if notifications == nil {
		notifications = []model.Notification{}
	}
	return notifications, total, nil
}

func (r *postgresNotificationRepository) UnreadCount(userID string) (int, error) {
	var count int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
		userID,
	).Scan(&count)
	return count, err
}

func (r *postgresNotificationRepository) MarkRead(id, userID string) error {
	_, err := r.db.Exec(
		`UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
		id, userID,
	)
	return err
}

func (r *postgresNotificationRepository) MarkAllRead(userID string) error {
	_, err := r.db.Exec(
		`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
		userID,
	)
	return err
}

func (r *postgresNotificationRepository) ExistsRecent(notifType model.NotificationType, resourceID string, since time.Time) (bool, error) {
	var exists bool
	err := r.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM notifications WHERE type = $1 AND resource_id = $2 AND created_at > $3)`,
		string(notifType), resourceID, since,
	).Scan(&exists)
	return exists, err
}

func (r *postgresNotificationRepository) ExistsForUser(notifType model.NotificationType, resourceID, userID string, since time.Time) (bool, error) {
	var exists bool
	err := r.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM notifications WHERE type = $1 AND resource_id = $2 AND user_id = $3 AND created_at > $4)`,
		string(notifType), resourceID, userID, since,
	).Scan(&exists)
	return exists, err
}

func (r *postgresNotificationRepository) GetAdmins() ([]model.User, error) {
	rows, err := r.db.Query(
		`SELECT id FROM users WHERE role = $1 AND status = 'activo'`,
		string(model.RoleAdmin),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

func (r *postgresNotificationRepository) GetUsersByBranchAndRoles(branchID string, roles []model.Role) ([]model.User, error) {
	// Convert []model.Role to []string for pq.Array or manual IN clause
	roleStrings := make([]string, len(roles))
	for i, role := range roles {
		roleStrings[i] = string(role)
	}

	// Build $2, $3, ... placeholders for roles
	placeholders := make([]string, len(roleStrings))
	args := make([]interface{}, 0, 1+len(roleStrings))
	args = append(args, branchID)
	for i, r := range roleStrings {
		placeholders[i] = fmt.Sprintf("$%d", i+2)
		args = append(args, r)
	}

	query := fmt.Sprintf(
		`SELECT id FROM users WHERE branch_id = $1 AND role IN (%s) AND status = 'activo'`,
		strings.Join(placeholders, ", "),
	)

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}
