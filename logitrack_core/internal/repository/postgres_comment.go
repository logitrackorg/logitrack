package repository

import (
	"database/sql"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresCommentRepository struct {
	db *sql.DB
}

func NewPostgresCommentRepository(db *sql.DB) CommentRepository {
	return &postgresCommentRepository{db: db}
}

func (r *postgresCommentRepository) AddComment(comment model.ShipmentComment) error {
	_, err := r.db.Exec(`
		INSERT INTO comments (id, tracking_id, author, body, created_at)
		VALUES ($1, $2, $3, $4, $5)`,
		comment.ID, comment.TrackingID, comment.Author, comment.Body, comment.CreatedAt,
	)
	return err
}

func (r *postgresCommentRepository) GetComments(trackingID string) ([]model.ShipmentComment, error) {
	rows, err := r.db.Query(`
		SELECT id, tracking_id, author, body, created_at
		FROM comments
		WHERE tracking_id = $1
		ORDER BY created_at DESC`,
		trackingID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comments []model.ShipmentComment
	for rows.Next() {
		var c model.ShipmentComment
		var ts time.Time
		if err := rows.Scan(&c.ID, &c.TrackingID, &c.Author, &c.Body, &ts); err != nil {
			return nil, err
		}
		c.CreatedAt = ts
		comments = append(comments, c)
	}
	return comments, rows.Err()
}
