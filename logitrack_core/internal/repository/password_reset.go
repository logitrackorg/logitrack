package repository

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
)

type PasswordResetToken struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

type PasswordResetRepository interface {
	Create(userID, tokenHash string, expiresAt time.Time) error
	FindValidByUser(userID string) (*PasswordResetToken, error)
	MarkUsed(id string) error
	CountRecentByUser(userID string, since time.Time) (int, error)
}

type postgresPasswordResetRepository struct {
	db *sql.DB
}

func NewPostgresPasswordResetRepository(db *sql.DB) PasswordResetRepository {
	return &postgresPasswordResetRepository{db: db}
}

func (r *postgresPasswordResetRepository) Create(userID, tokenHash string, expiresAt time.Time) error {
	_, err := r.db.Exec(
		`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		uuid.NewString(), userID, tokenHash, expiresAt, clock.Now().UTC(),
	)
	return err
}

func (r *postgresPasswordResetRepository) FindValidByUser(userID string) (*PasswordResetToken, error) {
	row := r.db.QueryRow(
		`SELECT id, user_id, token_hash, expires_at, used_at, created_at
		 FROM password_reset_tokens
		 WHERE user_id = $1
		   AND used_at IS NULL
		   AND expires_at > $2
		 ORDER BY created_at DESC
		 LIMIT 1`,
		userID, clock.Now().UTC(),
	)
	var t PasswordResetToken
	var usedAt sql.NullTime
	if err := row.Scan(&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &usedAt, &t.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if usedAt.Valid {
		t.UsedAt = &usedAt.Time
	}
	return &t, nil
}

func (r *postgresPasswordResetRepository) MarkUsed(id string) error {
	_, err := r.db.Exec(
		`UPDATE password_reset_tokens SET used_at = $1 WHERE id = $2`,
		clock.Now().UTC(), id,
	)
	return err
}

func (r *postgresPasswordResetRepository) CountRecentByUser(userID string, since time.Time) (int, error) {
	var count int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM password_reset_tokens
		 WHERE user_id = $1 AND created_at >= $2`,
		userID, since,
	).Scan(&count)
	return count, err
}
