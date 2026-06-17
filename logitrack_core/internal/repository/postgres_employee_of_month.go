package repository

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

// EmployeeOfMonthRepository persists monthly employee ranking results.
type EmployeeOfMonthRepository interface {
	UpsertWinner(w model.EmployeeOfMonthWinner) error
	ListByPeriod(period time.Time, branchID string) ([]model.EmployeeOfMonthWinner, error)
	ListByUser(userID string) ([]model.Award, error)
}

type postgresEmployeeOfMonthRepository struct {
	db *sql.DB
}

func NewPostgresEmployeeOfMonthRepository(db *sql.DB) EmployeeOfMonthRepository {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS employee_of_month_winners (
			id           TEXT PRIMARY KEY,
			period       DATE NOT NULL,
			category     TEXT NOT NULL,
			branch_id    TEXT NOT NULL DEFAULT '',
			has_winner   BOOLEAN NOT NULL,
			user_id      TEXT,
			score        NUMERIC(5,2),
			activity_count INT NOT NULL DEFAULT 0,
			computed_at  TIMESTAMPTZ NOT NULL,
			UNIQUE (period, category, branch_id)
		);
		CREATE INDEX IF NOT EXISTS idx_eom_user ON employee_of_month_winners(user_id) WHERE user_id IS NOT NULL;
	`)
	if err != nil {
		panic("failed to create employee_of_month_winners table: " + err.Error())
	}
	return &postgresEmployeeOfMonthRepository{db: db}
}

func (r *postgresEmployeeOfMonthRepository) UpsertWinner(w model.EmployeeOfMonthWinner) error {
	if w.ID == "" {
		w.ID = uuid.New().String()
	}
	period := w.Period.UTC().Truncate(24 * time.Hour)
	_, err := r.db.Exec(`
		INSERT INTO employee_of_month_winners (id, period, category, branch_id, has_winner, user_id, score, activity_count, computed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (period, category, branch_id) DO UPDATE SET
			has_winner     = EXCLUDED.has_winner,
			user_id        = EXCLUDED.user_id,
			score          = EXCLUDED.score,
			activity_count = EXCLUDED.activity_count,
			computed_at    = EXCLUDED.computed_at`,
		w.ID, period, string(w.Category), w.BranchID, w.HasWinner,
		nullableStr(w.UserID), nullableFloat64(w.Score), w.ActivityCount, clock.Now(),
	)
	return err
}

func (r *postgresEmployeeOfMonthRepository) ListByPeriod(period time.Time, branchID string) ([]model.EmployeeOfMonthWinner, error) {
	p := period.UTC().Truncate(24 * time.Hour)
	var rows *sql.Rows
	var err error
	if branchID == "" {
		rows, err = r.db.Query(`
			SELECT id, period, category, branch_id, has_winner, user_id, score, activity_count, computed_at
			FROM employee_of_month_winners
			WHERE period = $1
			ORDER BY category, branch_id`, p)
	} else {
		rows, err = r.db.Query(`
			SELECT id, period, category, branch_id, has_winner, user_id, score, activity_count, computed_at
			FROM employee_of_month_winners
			WHERE period = $1 AND (branch_id = $2 OR branch_id = '')
			ORDER BY category, branch_id`, p, branchID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanWinners(rows)
}

func (r *postgresEmployeeOfMonthRepository) ListByUser(userID string) ([]model.Award, error) {
	rows, err := r.db.Query(`
		SELECT category, period, score, branch_id
		FROM employee_of_month_winners
		WHERE user_id = $1 AND has_winner = true
		ORDER BY period DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var awards []model.Award
	for rows.Next() {
		var a model.Award
		var score sql.NullFloat64
		if err := rows.Scan(&a.Category, &a.Period, &score, &a.BranchID); err != nil {
			return nil, err
		}
		if score.Valid {
			a.Score = score.Float64
		}
		awards = append(awards, a)
	}
	return awards, rows.Err()
}

func scanWinners(rows *sql.Rows) ([]model.EmployeeOfMonthWinner, error) {
	var result []model.EmployeeOfMonthWinner
	for rows.Next() {
		var w model.EmployeeOfMonthWinner
		var userID sql.NullString
		var score sql.NullFloat64
		if err := rows.Scan(&w.ID, &w.Period, &w.Category, &w.BranchID, &w.HasWinner,
			&userID, &score, &w.ActivityCount, &w.ComputedAt); err != nil {
			return nil, err
		}
		if userID.Valid {
			w.UserID = userID.String
		}
		if score.Valid {
			v := score.Float64
			w.Score = &v
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func nullableFloat64(f *float64) interface{} {
	if f == nil {
		return nil
	}
	return *f
}
