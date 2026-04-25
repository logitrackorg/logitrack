package repository

import (
	"database/sql"

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
		`INSERT INTO access_logs (id, username, user_id, event_type, timestamp)
		 VALUES ($1, $2, $3, $4, $5)`,
		entry.ID, entry.Username, entry.UserID, string(entry.EventType), entry.Timestamp,
	)
	return err
}

func (r *postgresAccessLogRepository) List(limit int) ([]model.AccessLog, error) {
	rows, err := r.db.Query(
		`SELECT id, username, user_id, event_type, timestamp
		 FROM access_logs
		 ORDER BY timestamp DESC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.AccessLog
	for rows.Next() {
		var e model.AccessLog
		var eventType string
		if err := rows.Scan(&e.ID, &e.Username, &e.UserID, &eventType, &e.Timestamp); err != nil {
			return nil, err
		}
		e.EventType = model.AccessEventType(eventType)
		result = append(result, e)
	}
	return result, nil
}
