package repository

import (
	"database/sql"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
)

type postgresRoutingMetricsRepository struct {
	db *sql.DB
}

func NewPostgresRoutingMetricsRepository(db *sql.DB) RoutingMetricsRepository {
	return &postgresRoutingMetricsRepository{db: db}
}

func (r *postgresRoutingMetricsRepository) SavePlanMetric(m model.PlanMetric) error {
	_, err := r.db.Exec(`
		INSERT INTO routing_plan_metrics
			(id, branch_id, generated_at, generation_time_ms,
			 last_mile_count, inter_branch_count, unassigned_count,
			 vrp_used, window_coverage_pct, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		m.ID, m.BranchID, m.GeneratedAt, m.GenerationTimeMs,
		m.LastMileCount, m.InterBranchCount, m.UnassignedCount,
		m.VRPUsed, m.WindowCoveragePct, m.CreatedAt,
	)
	return err
}

func (r *postgresRoutingMetricsRepository) SaveApplyMetric(m model.ApplyMetric) error {
	_, err := r.db.Exec(`
		INSERT INTO routing_apply_metrics
			(id, branch_id, applied_at, applied_by,
			 applied_count, failed_count, drift_count,
			 manual_override_count, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		m.ID, m.BranchID, m.AppliedAt, m.AppliedBy,
		m.AppliedCount, m.FailedCount, m.DriftCount,
		m.ManualOverrideCount, m.CreatedAt,
	)
	return err
}

func (r *postgresRoutingMetricsRepository) SaveHopMetric(m model.ShipmentHopMetric) error {
	_, err := r.db.Exec(`
		INSERT INTO shipment_hop_metrics
			(id, tracking_id, from_branch_id, to_branch_id,
			 departed_at, arrived_at, transit_hours, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		m.ID, m.TrackingID, m.FromBranchID, m.ToBranchID,
		m.DepartedAt, m.ArrivedAt, m.TransitHours, m.CreatedAt,
	)
	return err
}

func (r *postgresRoutingMetricsRepository) IncrementODVolume(originBranch, destBranch, date string, count int, weightKg float64) error {
	_, err := r.db.Exec(`
		INSERT INTO od_pair_daily_volume
			(id, origin_branch_id, destination_branch_id, date,
			 shipment_count, total_weight_kg, updated_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
		ON CONFLICT (origin_branch_id, destination_branch_id, date)
		DO UPDATE SET
			shipment_count  = od_pair_daily_volume.shipment_count  + EXCLUDED.shipment_count,
			total_weight_kg = od_pair_daily_volume.total_weight_kg + EXCLUDED.total_weight_kg,
			updated_at      = NOW()`,
		originBranch, destBranch, date, count, weightKg,
	)
	return err
}

func (r *postgresRoutingMetricsRepository) ListPlanMetrics(branchID string, from, to time.Time) ([]model.PlanMetric, error) {
	q := `SELECT id, branch_id, generated_at, generation_time_ms,
	             last_mile_count, inter_branch_count, unassigned_count,
	             vrp_used, window_coverage_pct, created_at
	      FROM routing_plan_metrics
	      WHERE ($1 = '' OR branch_id = $1)
	        AND generated_at >= $2 AND generated_at <= $3
	      ORDER BY generated_at DESC`

	rows, err := r.db.Query(q, branchID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.PlanMetric
	for rows.Next() {
		var m model.PlanMetric
		if err := rows.Scan(
			&m.ID, &m.BranchID, &m.GeneratedAt, &m.GenerationTimeMs,
			&m.LastMileCount, &m.InterBranchCount, &m.UnassignedCount,
			&m.VRPUsed, &m.WindowCoveragePct, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (r *postgresRoutingMetricsRepository) ListApplyMetrics(branchID string, from, to time.Time) ([]model.ApplyMetric, error) {
	q := `SELECT id, branch_id, applied_at, applied_by,
	             applied_count, failed_count, drift_count,
	             manual_override_count, created_at
	      FROM routing_apply_metrics
	      WHERE ($1 = '' OR branch_id = $1)
	        AND applied_at >= $2 AND applied_at <= $3
	      ORDER BY applied_at DESC`

	rows, err := r.db.Query(q, branchID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.ApplyMetric
	for rows.Next() {
		var m model.ApplyMetric
		if err := rows.Scan(
			&m.ID, &m.BranchID, &m.AppliedAt, &m.AppliedBy,
			&m.AppliedCount, &m.FailedCount, &m.DriftCount,
			&m.ManualOverrideCount, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (r *postgresRoutingMetricsRepository) ListHopMetrics(branchID string, from, to time.Time) ([]model.ShipmentHopMetric, error) {
	q := `SELECT id, tracking_id, from_branch_id, to_branch_id,
	             departed_at, arrived_at, transit_hours, created_at
	      FROM shipment_hop_metrics
	      WHERE ($1 = '' OR from_branch_id = $1)
	        AND departed_at >= $2 AND departed_at <= $3
	      ORDER BY departed_at DESC`

	rows, err := r.db.Query(q, branchID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.ShipmentHopMetric
	for rows.Next() {
		var m model.ShipmentHopMetric
		if err := rows.Scan(
			&m.ID, &m.TrackingID, &m.FromBranchID, &m.ToBranchID,
			&m.DepartedAt, &m.ArrivedAt, &m.TransitHours, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (r *postgresRoutingMetricsRepository) ListODVolume(originBranch, destBranch string, from, to time.Time) ([]model.ODPairVolume, error) {
	// date::text fuerza formato YYYY-MM-DD en lugar de TIMESTAMPTZ con tiempo,
	// que es lo que lib/pq devolvería por default y rompe time.Parse("2006-01-02").
	q := `SELECT id, origin_branch_id, destination_branch_id, date::text,
	             shipment_count, total_weight_kg, updated_at
	      FROM od_pair_daily_volume
	      WHERE ($1 = '' OR origin_branch_id = $1)
	        AND ($2 = '' OR destination_branch_id = $2)
	        AND date >= $3::date AND date <= $4::date
	      ORDER BY date DESC, origin_branch_id, destination_branch_id`

	rows, err := r.db.Query(q, originBranch, destBranch, from.Format("2006-01-02"), to.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.ODPairVolume
	for rows.Next() {
		var m model.ODPairVolume
		if err := rows.Scan(
			&m.ID, &m.OriginBranchID, &m.DestinationBranchID, &m.Date,
			&m.ShipmentCount, &m.TotalWeightKg, &m.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (r *postgresRoutingMetricsRepository) GetSummary(branchID string, from, to time.Time) ([]model.RoutingMetricsSummary, error) {
	q := `
		WITH plan_agg AS (
			SELECT
				generated_at::date                               AS day,
				branch_id,
				COUNT(*)::int                                    AS plan_count,
				AVG(generation_time_ms)                          AS avg_gen_ms,
				AVG(
					CASE WHEN (last_mile_count + inter_branch_count + unassigned_count) > 0
					     THEN unassigned_count::float /
					          (last_mile_count + inter_branch_count + unassigned_count)
					     ELSE 0 END
				) * 100                                          AS avg_unassigned_pct,
				AVG(window_coverage_pct)                         AS avg_window_cov
			FROM routing_plan_metrics
			WHERE ($1 = '' OR branch_id = $1)
			  AND generated_at >= $2 AND generated_at <= $3
			GROUP BY day, branch_id
		),
		apply_agg AS (
			SELECT
				applied_at::date  AS day,
				branch_id,
				SUM(applied_count)::int AS total_applied,
				SUM(failed_count)::int  AS total_failed,
				SUM(drift_count)::int   AS total_drift,
				AVG(manual_override_count) AS avg_override
			FROM routing_apply_metrics
			WHERE ($1 = '' OR branch_id = $1)
			  AND applied_at >= $2 AND applied_at <= $3
			GROUP BY day, branch_id
		)
		SELECT
			COALESCE(p.day, a.day)::text                 AS date,
			COALESCE(p.branch_id, a.branch_id)           AS branch_id,
			COALESCE(p.avg_gen_ms, 0)                    AS avg_gen_time_ms,
			COALESCE(p.avg_unassigned_pct, 0)            AS avg_unassigned_pct,
			COALESCE(p.avg_window_cov, 0)                AS avg_window_coverage_pct,
			COALESCE(a.total_applied, 0)                 AS total_applied,
			COALESCE(a.total_failed, 0)                  AS total_failed,
			COALESCE(a.total_drift, 0)                   AS total_drift,
			COALESCE(a.avg_override, 0)                  AS avg_override_count,
			COALESCE(p.plan_count, 0)                    AS plan_count
		FROM plan_agg p
		FULL OUTER JOIN apply_agg a
			ON p.day = a.day AND p.branch_id = a.branch_id
		ORDER BY date DESC, branch_id`

	rows, err := r.db.Query(q, branchID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.RoutingMetricsSummary
	for rows.Next() {
		var s model.RoutingMetricsSummary
		if err := rows.Scan(
			&s.Date, &s.BranchID,
			&s.AvgGenTimeMs, &s.AvgUnassignedPct, &s.AvgWindowCovPct,
			&s.TotalApplied, &s.TotalFailed, &s.TotalDrift,
			&s.AvgOverrideCount, &s.PlanCount,
		); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

// BackfillODVolume reconstruye od_pair_daily_volume desde la tabla shipments.
// Excluye drafts y envíos sin destino. Idempotente vía ON CONFLICT.
func (r *postgresRoutingMetricsRepository) BackfillODVolume() (int, error) {
	rows, err := r.db.Query(`
		SELECT
			origin_branch_id,
			final_branch_id,
			created_at::date::text AS date,
			COUNT(*)::int           AS cnt,
			COALESCE(SUM(weight_kg), 0) AS total_weight
		FROM shipments
		WHERE origin_branch_id <> ''
		  AND final_branch_id  <> ''
		  AND final_branch_id  <> origin_branch_id
		  AND status           <> 'draft'
		GROUP BY 1, 2, 3
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var origin, dest, date string
		var cnt int
		var weight float64
		if err := rows.Scan(&origin, &dest, &date, &cnt, &weight); err != nil {
			return count, err
		}
		_, err := r.db.Exec(`
			INSERT INTO od_pair_daily_volume
				(id, origin_branch_id, destination_branch_id, date,
				 shipment_count, total_weight_kg, updated_at)
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
			ON CONFLICT (origin_branch_id, destination_branch_id, date)
			DO UPDATE SET
				shipment_count  = EXCLUDED.shipment_count,
				total_weight_kg = EXCLUDED.total_weight_kg,
				updated_at      = NOW()`,
			origin, dest, date, cnt, weight,
		)
		if err != nil {
			return count, err
		}
		count++
	}
	return count, rows.Err()
}

// BackfillHops reconstruye shipment_hop_metrics desde la tabla events.
// Un hop es: loaded(branch A) → at_hub(branch B) con A != B.
// Idempotente vía deduplicación por (tracking_id, departed_at).
func (r *postgresRoutingMetricsRepository) BackfillHops() (int, error) {
	// Truncar e re-poblar: la lógica del state machine es la fuente de verdad,
	// y al ser idempotente conviene siempre regenerar desde cero. Volumen acotado.
	if _, err := r.db.Exec(`TRUNCATE TABLE shipment_hop_metrics`); err != nil {
		return 0, err
	}

	rows, err := r.db.Query(`
		SELECT
			tracking_id, timestamp, version,
			payload->>'ToStatus'  AS to_status,
			payload->>'Location'  AS location
		FROM events
		WHERE event_type = 'status_changed'
		  AND payload->>'ToStatus' IN ('loaded', 'in_transit', 'at_hub', 'at_origin_hub')
		ORDER BY tracking_id, version
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type pending struct {
		fromBranch string
		departedAt time.Time
	}
	lastHub := map[string]string{}
	open := map[string]*pending{}

	type hopRow struct {
		trackingID   string
		fromBranch   string
		toBranch     string
		departedAt   time.Time
		arrivedAt    *time.Time
		transitHours *float64
	}
	var hops []hopRow

	for rows.Next() {
		var tid, toStatus, loc string
		var ts time.Time
		var version int
		if err := rows.Scan(&tid, &ts, &version, &toStatus, &loc); err != nil {
			return 0, err
		}

		switch toStatus {
		case "at_hub", "at_origin_hub":
			if p, ok := open[tid]; ok {
				if p.fromBranch != "" && p.fromBranch != loc {
					th := ts.Sub(p.departedAt).Hours()
					arr := ts
					hops = append(hops, hopRow{
						trackingID:   tid,
						fromBranch:   p.fromBranch,
						toBranch:     loc,
						departedAt:   p.departedAt,
						arrivedAt:    &arr,
						transitHours: &th,
					})
				}
				delete(open, tid)
			}
			lastHub[tid] = loc

		case "loaded":
			from := lastHub[tid]
			if from == "" {
				from = loc
			}
			open[tid] = &pending{fromBranch: from, departedAt: ts}
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, h := range hops {
		_, err := r.db.Exec(`
			INSERT INTO shipment_hop_metrics
				(id, tracking_id, from_branch_id, to_branch_id,
				 departed_at, arrived_at, transit_hours, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
			uuid.NewString(), h.trackingID, h.fromBranch, h.toBranch,
			h.departedAt, h.arrivedAt, h.transitHours,
		)
		if err != nil {
			log.Printf("[backfill] error guardando hop %s: %v", h.trackingID, err)
		}
	}
	return len(hops), nil
}
