package repository

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

// ErrAutoReportScheduleNotFound se devuelve cuando un schedule no existe.
var ErrAutoReportScheduleNotFound = errors.New("auto report schedule no encontrado")

// AutoReportRepository expone las operaciones de persistencia de reportes automáticos.
type AutoReportRepository interface {
	CreateSchedule(s model.AutoReportSchedule) error
	UpdateSchedule(s model.AutoReportSchedule) error
	DeleteSchedule(id string) error
	GetSchedule(id string) (model.AutoReportSchedule, error)
	ListSchedules() ([]model.AutoReportSchedule, error)
	ListActiveSchedules() ([]model.AutoReportSchedule, error)
	MarkScheduleRun(id string, at time.Time) error

	CreateGenerated(r model.GeneratedReport) error
	GetGenerated(id string) (model.GeneratedReport, error)
	ListGenerated(limit int) ([]model.GeneratedReport, error)
}

type postgresAutoReportRepository struct {
	db *sql.DB
}

// NewPostgresAutoReportRepository devuelve un repo respaldado por PostgreSQL.
func NewPostgresAutoReportRepository(db *sql.DB) AutoReportRepository {
	return &postgresAutoReportRepository{db: db}
}

func (r *postgresAutoReportRepository) CreateSchedule(s model.AutoReportSchedule) error {
	metrics, err := json.Marshal(s.Metrics)
	if err != nil {
		return fmt.Errorf("marshal metrics: %w", err)
	}
	_, err = r.db.Exec(`
		INSERT INTO auto_report_schedules
		  (id, owner_user_id, name, frequency, time_of_day, day_of_week, day_of_month,
		   metrics, branch_id, email, active, created_at, updated_at, last_run_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
	`, s.ID, s.OwnerUserID, s.Name, string(s.Frequency), s.TimeOfDay, s.DayOfWeek, s.DayOfMonth,
		metrics, s.BranchID, s.Email, s.Active, s.CreatedAt, s.UpdatedAt, s.LastRunAt)
	if err != nil {
		return fmt.Errorf("insert auto report schedule: %w", err)
	}
	return nil
}

func (r *postgresAutoReportRepository) UpdateSchedule(s model.AutoReportSchedule) error {
	metrics, err := json.Marshal(s.Metrics)
	if err != nil {
		return fmt.Errorf("marshal metrics: %w", err)
	}
	res, err := r.db.Exec(`
		UPDATE auto_report_schedules SET
		  name=$2, frequency=$3, time_of_day=$4, day_of_week=$5, day_of_month=$6,
		  metrics=$7, branch_id=$8, email=$9, active=$10, updated_at=$11
		WHERE id=$1
	`, s.ID, s.Name, string(s.Frequency), s.TimeOfDay, s.DayOfWeek, s.DayOfMonth,
		metrics, s.BranchID, s.Email, s.Active, s.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update auto report schedule: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrAutoReportScheduleNotFound
	}
	return nil
}

func (r *postgresAutoReportRepository) DeleteSchedule(id string) error {
	res, err := r.db.Exec(`DELETE FROM auto_report_schedules WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("delete auto report schedule: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrAutoReportScheduleNotFound
	}
	return nil
}

func (r *postgresAutoReportRepository) GetSchedule(id string) (model.AutoReportSchedule, error) {
	row := r.db.QueryRow(`
		SELECT id, owner_user_id, name, frequency, time_of_day, day_of_week, day_of_month,
		       metrics, branch_id, email, active, created_at, updated_at, last_run_at
		FROM auto_report_schedules
		WHERE id=$1
	`, id)
	s, err := scanSchedule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.AutoReportSchedule{}, ErrAutoReportScheduleNotFound
	}
	return s, err
}

func (r *postgresAutoReportRepository) ListSchedules() ([]model.AutoReportSchedule, error) {
	return r.querySchedules(`
		SELECT id, owner_user_id, name, frequency, time_of_day, day_of_week, day_of_month,
		       metrics, branch_id, email, active, created_at, updated_at, last_run_at
		FROM auto_report_schedules
		ORDER BY created_at DESC
	`)
}

func (r *postgresAutoReportRepository) ListActiveSchedules() ([]model.AutoReportSchedule, error) {
	return r.querySchedules(`
		SELECT id, owner_user_id, name, frequency, time_of_day, day_of_week, day_of_month,
		       metrics, branch_id, email, active, created_at, updated_at, last_run_at
		FROM auto_report_schedules
		WHERE active = TRUE
	`)
}

func (r *postgresAutoReportRepository) querySchedules(query string) ([]model.AutoReportSchedule, error) {
	rows, err := r.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("query auto report schedules: %w", err)
	}
	defer rows.Close()

	out := []model.AutoReportSchedule{}
	for rows.Next() {
		s, err := scanSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}
	return out, nil
}

func (r *postgresAutoReportRepository) MarkScheduleRun(id string, at time.Time) error {
	_, err := r.db.Exec(`UPDATE auto_report_schedules SET last_run_at=$2 WHERE id=$1`, id, at)
	if err != nil {
		return fmt.Errorf("mark schedule run: %w", err)
	}
	return nil
}

func (r *postgresAutoReportRepository) CreateGenerated(g model.GeneratedReport) error {
	snapshot, err := json.Marshal(g.Snapshot)
	if err != nil {
		return fmt.Errorf("marshal snapshot: %w", err)
	}
	_, err = r.db.Exec(`
		INSERT INTO auto_report_generated
		  (id, schedule_id, schedule_name, frequency, period_from, period_to,
		   branch_id, email, generated_at, has_data, snapshot)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, g.ID, g.ScheduleID, g.ScheduleName, string(g.Frequency), g.PeriodFrom, g.PeriodTo,
		g.BranchID, g.Email, g.GeneratedAt, g.HasData, snapshot)
	if err != nil {
		return fmt.Errorf("insert generated report: %w", err)
	}
	return nil
}

func (r *postgresAutoReportRepository) GetGenerated(id string) (model.GeneratedReport, error) {
	row := r.db.QueryRow(`
		SELECT id, schedule_id, schedule_name, frequency, period_from, period_to,
		       branch_id, email, generated_at, has_data, snapshot
		FROM auto_report_generated
		WHERE id=$1
	`, id)
	g, err := scanGenerated(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.GeneratedReport{}, ErrAutoReportScheduleNotFound
	}
	return g, err
}

func (r *postgresAutoReportRepository) ListGenerated(limit int) ([]model.GeneratedReport, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.Query(`
		SELECT id, schedule_id, schedule_name, frequency, period_from, period_to,
		       branch_id, email, generated_at, has_data, snapshot
		FROM auto_report_generated
		ORDER BY generated_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query generated reports: %w", err)
	}
	defer rows.Close()

	out := []model.GeneratedReport{}
	for rows.Next() {
		g, err := scanGenerated(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}
	return out, nil
}

// scanner es la interface común entre *sql.Row y *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanSchedule(row scanner) (model.AutoReportSchedule, error) {
	var s model.AutoReportSchedule
	var frequency string
	var dayOfWeek, dayOfMonth sql.NullInt64
	var metricsRaw []byte
	var lastRun sql.NullTime
	if err := row.Scan(&s.ID, &s.OwnerUserID, &s.Name, &frequency, &s.TimeOfDay,
		&dayOfWeek, &dayOfMonth, &metricsRaw, &s.BranchID, &s.Email, &s.Active,
		&s.CreatedAt, &s.UpdatedAt, &lastRun); err != nil {
		return model.AutoReportSchedule{}, fmt.Errorf("scan auto report schedule: %w", err)
	}
	s.Frequency = model.ReportFrequency(frequency)
	if dayOfWeek.Valid {
		v := int(dayOfWeek.Int64)
		s.DayOfWeek = &v
	}
	if dayOfMonth.Valid {
		v := int(dayOfMonth.Int64)
		s.DayOfMonth = &v
	}
	if lastRun.Valid {
		t := lastRun.Time
		s.LastRunAt = &t
	}
	if len(metricsRaw) > 0 {
		if err := json.Unmarshal(metricsRaw, &s.Metrics); err != nil {
			return model.AutoReportSchedule{}, fmt.Errorf("unmarshal metrics: %w", err)
		}
	}
	if s.Metrics == nil {
		s.Metrics = []model.ReportMetric{}
	}
	return s, nil
}

func scanGenerated(row scanner) (model.GeneratedReport, error) {
	var g model.GeneratedReport
	var frequency string
	var snapshotRaw []byte
	if err := row.Scan(&g.ID, &g.ScheduleID, &g.ScheduleName, &frequency, &g.PeriodFrom, &g.PeriodTo,
		&g.BranchID, &g.Email, &g.GeneratedAt, &g.HasData, &snapshotRaw); err != nil {
		return model.GeneratedReport{}, fmt.Errorf("scan generated report: %w", err)
	}
	g.Frequency = model.ReportFrequency(frequency)
	if len(snapshotRaw) > 0 {
		if err := json.Unmarshal(snapshotRaw, &g.Snapshot); err != nil {
			return model.GeneratedReport{}, fmt.Errorf("unmarshal snapshot: %w", err)
		}
	}
	if g.Snapshot == nil {
		g.Snapshot = map[string]any{}
	}
	return g, nil
}
