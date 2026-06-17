package repository

import (
	"database/sql"
	"fmt" 
	"strings" 

	"github.com/logitrack/core/internal/model"
)

type postgresAccessLogRepository struct {
	db *sql.DB
}

func NewPostgresAccessLogRepository(db *sql.DB) AccessLogRepository {
	return &postgresAccessLogRepository{db: db}
}

func (r *postgresAccessLogRepository) Log(entry model.AccessLog) error {
	_, err := r.db.Exec(
		`INSERT INTO access_logs 
			(id, username, user_id, role, event_type, ip_address, country, city, result, failure_reason, timestamp)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		entry.ID,
		entry.Username,
		entry.UserID,
		entry.Role,
		string(entry.EventType),
		entry.IPAddress,
		entry.Country,
		entry.City,
		entry.Result,
		entry.FailureReason,
		entry.Timestamp,
	)
	return err
}

func (r *postgresAccessLogRepository) List(limit int) ([]model.AccessLog, error) {
	return r.ListFiltered(model.AccessLogFilter{Limit: limit})
}

func (r *postgresAccessLogRepository) ListFiltered(filter model.AccessLogFilter) ([]model.AccessLog, error) {
	where := []string{"1=1"}
	args := []interface{}{}
	idx := 1

	if filter.Username != "" {
		where = append(where, fmt.Sprintf("username ILIKE $%d", idx))
		args = append(args, "%"+filter.Username+"%")
		idx++
	}
	if filter.DateFrom != "" {
		where = append(where, fmt.Sprintf("timestamp >= $%d", idx))
		args = append(args, filter.DateFrom)
		idx++
	}
	if filter.DateTo != "" {
		where = append(where, fmt.Sprintf("timestamp <= $%d", idx))
		args = append(args, filter.DateTo+" 23:59:59")
		idx++
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 500
	}
	args = append(args, limit)

	query := fmt.Sprintf(`
		SELECT id, username, user_id, role, event_type,
		       COALESCE(ip_address,''), COALESCE(country,''), COALESCE(city,''),
		       COALESCE(result,''), COALESCE(failure_reason,''), timestamp
		FROM access_logs
		WHERE %s
		ORDER BY timestamp DESC
		LIMIT $%d`,
		strings.Join(where, " AND "), idx,
	)

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.AccessLog
	for rows.Next() {
		var e model.AccessLog
		var eventType string
		if err := rows.Scan(
			&e.ID, &e.Username, &e.UserID, &e.Role,
			&eventType, &e.IPAddress, &e.Country, &e.City,
			&e.Result, &e.FailureReason, &e.Timestamp,
		); err != nil {
			return nil, err
		}
		e.EventType = model.AccessEventType(eventType)
		result = append(result, e)
	}
	return result, nil
}