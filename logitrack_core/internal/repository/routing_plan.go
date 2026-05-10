package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

// RoutingPlanRepository persiste el plan global de ruteo del día (singleton por plan_date).
type RoutingPlanRepository interface {
	// GetByDate devuelve el plan de una fecha (formato YYYY-MM-DD). Devuelve nil si no existe.
	GetByDate(date string) (*model.GlobalRoutingPlan, error)
	// Upsert guarda o sobreescribe el plan del día. Si ya existe un plan para esa fecha
	// y su status es "applied", retorna error para proteger un plan ya ejecutado.
	Upsert(plan *model.GlobalRoutingPlan) error
	// UpdateStatus cambia el status del plan de una fecha.
	UpdateStatus(date string, status model.PlanStatus) error
	// MarkApplied marca el plan como applied y registra quién lo aplicó.
	MarkApplied(date string, appliedBy string, appliedAt time.Time) error
}

type postgresRoutingPlanRepository struct {
	db *sql.DB
}

func NewPostgresRoutingPlanRepository(db *sql.DB) RoutingPlanRepository {
	return &postgresRoutingPlanRepository{db: db}
}

// planPayload es la estructura que se persiste en la columna payload JSONB.
// Incluye BranchPlans (con los applied flags de cada ítem) y AppliedBranches.
type planPayload struct {
	BranchPlans     []model.BranchPlan `json:"branch_plans"`
	AppliedBranches []string           `json:"applied_branches"`
}

func (r *postgresRoutingPlanRepository) GetByDate(date string) (*model.GlobalRoutingPlan, error) {
	var plan model.GlobalRoutingPlan
	var payloadJSON, logJSON []byte
	var appliedAt sql.NullTime
	var appliedBy sql.NullString

	err := r.db.QueryRow(`
		SELECT id, plan_date, status, payload, generated_at, applied_at, applied_by, generation_log
		FROM routing_plans WHERE plan_date = $1`, date).
		Scan(
			&plan.ID, &plan.PlanDate, &plan.Status,
			&payloadJSON, &plan.GeneratedAt,
			&appliedAt, &appliedBy,
			&logJSON,
		)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("routing_plans get: %w", err)
	}

	if appliedAt.Valid {
		t := appliedAt.Time
		plan.AppliedAt = &t
	}
	plan.AppliedBy = appliedBy.String

	// Intentar deserializar con el formato nuevo (planPayload).
	// Si falla o el campo branch_plans no existe, intentar con el formato legacy ([]BranchPlan).
	var pp planPayload
	if err := json.Unmarshal(payloadJSON, &pp); err == nil && pp.BranchPlans != nil {
		plan.BranchPlans = pp.BranchPlans
		plan.AppliedBranches = pp.AppliedBranches
	} else {
		// Formato legacy: el payload era directamente []BranchPlan.
		if err2 := json.Unmarshal(payloadJSON, &plan.BranchPlans); err2 != nil {
			return nil, fmt.Errorf("routing_plans payload unmarshal: %w", err2)
		}
	}
	if plan.AppliedBranches == nil {
		plan.AppliedBranches = []string{}
	}

	if err := json.Unmarshal(logJSON, &plan.Log); err != nil {
		return nil, fmt.Errorf("routing_plans log unmarshal: %w", err)
	}

	return &plan, nil
}

func (r *postgresRoutingPlanRepository) Upsert(plan *model.GlobalRoutingPlan) error {
	pp := planPayload{
		BranchPlans:     plan.BranchPlans,
		AppliedBranches: plan.AppliedBranches,
	}
	if pp.AppliedBranches == nil {
		pp.AppliedBranches = []string{}
	}
	payloadJSON, err := json.Marshal(pp)
	if err != nil {
		return fmt.Errorf("routing_plans payload marshal: %w", err)
	}
	logJSON, err := json.Marshal(plan.Log)
	if err != nil {
		return fmt.Errorf("routing_plans log marshal: %w", err)
	}

	_, err = r.db.Exec(`
		INSERT INTO routing_plans (id, plan_date, status, payload, generated_at, generation_log)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (plan_date) DO UPDATE SET
			id             = EXCLUDED.id,
			status         = CASE WHEN routing_plans.status = 'applied' THEN routing_plans.status ELSE EXCLUDED.status END,
			payload        = CASE WHEN routing_plans.status = 'applied' THEN routing_plans.payload ELSE EXCLUDED.payload END,
			generated_at   = CASE WHEN routing_plans.status = 'applied' THEN routing_plans.generated_at ELSE EXCLUDED.generated_at END,
			generation_log = CASE WHEN routing_plans.status = 'applied' THEN routing_plans.generation_log ELSE EXCLUDED.generation_log END`,
		plan.ID, plan.PlanDate, string(plan.Status),
		payloadJSON, plan.GeneratedAt, logJSON,
	)
	return err
}

func (r *postgresRoutingPlanRepository) UpdateStatus(date string, status model.PlanStatus) error {
	_, err := r.db.Exec(
		`UPDATE routing_plans SET status = $1 WHERE plan_date = $2`,
		string(status), date,
	)
	return err
}

func (r *postgresRoutingPlanRepository) MarkApplied(date string, appliedBy string, appliedAt time.Time) error {
	_, err := r.db.Exec(
		`UPDATE routing_plans SET status = 'applied', applied_at = $1, applied_by = $2 WHERE plan_date = $3`,
		appliedAt, appliedBy, date,
	)
	return err
}
