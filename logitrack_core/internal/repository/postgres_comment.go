package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type postgresCommentRepository struct {
	db *sql.DB
}

func NewPostgresCommentRepository(db *sql.DB) CommentRepository {
	db.Exec(`CREATE TABLE IF NOT EXISTS shipment_comments (
		id          VARCHAR(50)  PRIMARY KEY,
		tracking_id VARCHAR(50)  NOT NULL,
		author      VARCHAR(100) NOT NULL,
		body        TEXT         NOT NULL,
		created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
	)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_comments_tracking_id ON shipment_comments(tracking_id)`)
	return &postgresCommentRepository{db: db}
}

func (r *postgresCommentRepository) AddComment(comment model.ShipmentComment) error {
	_, err := r.db.Exec(
		`INSERT INTO shipment_comments (id, tracking_id, author, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
		comment.ID, comment.TrackingID, comment.Author, comment.Body, comment.CreatedAt,
	)
	return err
}

func (r *postgresCommentRepository) GetComments(trackingID string) ([]model.ShipmentComment, error) {
	rows, err := r.db.Query(
		`SELECT id, tracking_id, author, body, created_at FROM shipment_comments WHERE tracking_id = $1 ORDER BY created_at DESC`,
		trackingID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []model.ShipmentComment
	for rows.Next() {
		var c model.ShipmentComment
		if err := rows.Scan(&c.ID, &c.TrackingID, &c.Author, &c.Body, &c.CreatedAt); err == nil {
			result = append(result, c)
		}
	}
	return result, nil
}
