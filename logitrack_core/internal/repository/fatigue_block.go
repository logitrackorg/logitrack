package repository

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type FatigueBlock struct {
	ID          string
	DriverID    string
	TripID      *string
	BlockedAt   time.Time
	UnblockedAt *time.Time
	UnblockedBy *string
}

type FatigueBlockRepository interface {
	Create(driverID string, tripID *string) error
	GetActive(driverID string) (*FatigueBlock, error)
	Unblock(driverID, unblockedBy string) error
}

type postgresFatigueBlockRepository struct {
	db *sql.DB
}

func NewPostgresFatigueBlockRepository(db *sql.DB) FatigueBlockRepository {
	return &postgresFatigueBlockRepository{db: db}
}

func (r *postgresFatigueBlockRepository) Create(driverID string, tripID *string) error {
	_, err := r.db.Exec(`
		INSERT INTO fatigue_blocks (id, driver_id, trip_id, blocked_at)
		VALUES ($1, $2, $3, NOW())`,
		uuid.NewString(), driverID, tripID,
	)
	return err
}

func (r *postgresFatigueBlockRepository) GetActive(driverID string) (*FatigueBlock, error) {
	row := r.db.QueryRow(`
		SELECT id, driver_id, trip_id, blocked_at, unblocked_at, unblocked_by
		FROM fatigue_blocks
		WHERE driver_id = $1 AND unblocked_at IS NULL
		ORDER BY blocked_at DESC
		LIMIT 1`, driverID)

	var b FatigueBlock
	var tripID sql.NullString
	var unblockedAt sql.NullTime
	var unblockedBy sql.NullString
	err := row.Scan(&b.ID, &b.DriverID, &tripID, &b.BlockedAt, &unblockedAt, &unblockedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if tripID.Valid {
		b.TripID = &tripID.String
	}
	if unblockedAt.Valid {
		b.UnblockedAt = &unblockedAt.Time
	}
	if unblockedBy.Valid {
		b.UnblockedBy = &unblockedBy.String
	}
	return &b, nil
}

func (r *postgresFatigueBlockRepository) Unblock(driverID, unblockedBy string) error {
	_, err := r.db.Exec(`
		UPDATE fatigue_blocks
		SET unblocked_at = NOW(), unblocked_by = $2
		WHERE driver_id = $1 AND unblocked_at IS NULL`,
		driverID, unblockedBy,
	)
	return err
}
