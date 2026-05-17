package repository

import (
	"database/sql"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresBranchGraphRepository struct {
	db *sql.DB
}

func NewPostgresBranchGraphRepository(db *sql.DB) BranchGraphRepository {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS branch_graph (
			from_branch_id    TEXT          NOT NULL,
			to_branch_id      TEXT          NOT NULL,
			distance_km       NUMERIC(10,2) NOT NULL DEFAULT 0,
			avg_transit_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
			observed_count    INTEGER       NOT NULL DEFAULT 0,
			enabled           BOOLEAN       NOT NULL DEFAULT TRUE,
			source            TEXT          NOT NULL DEFAULT 'auto',
			updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
			PRIMARY KEY (from_branch_id, to_branch_id)
		);
		CREATE INDEX IF NOT EXISTS branch_graph_from_idx ON branch_graph(from_branch_id) WHERE enabled = TRUE;
	`)
	if err != nil {
		panic("failed to create branch_graph table: " + err.Error())
	}
	return &postgresBranchGraphRepository{db: db}
}

func (r *postgresBranchGraphRepository) ListEdges() ([]model.BranchEdge, error) {
	rows, err := r.db.Query(`
		SELECT from_branch_id, to_branch_id, distance_km, avg_transit_hours,
		       observed_count, enabled, source, updated_at
		FROM branch_graph
		ORDER BY from_branch_id, to_branch_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.BranchEdge
	for rows.Next() {
		var e model.BranchEdge
		if err := rows.Scan(
			&e.FromBranchID, &e.ToBranchID, &e.DistanceKm, &e.AvgTransitHours,
			&e.ObservedCount, &e.Enabled, &e.Source, &e.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	if result == nil {
		result = []model.BranchEdge{}
	}
	return result, rows.Err()
}

func (r *postgresBranchGraphRepository) GetEdge(from, to string) (model.BranchEdge, bool) {
	var e model.BranchEdge
	err := r.db.QueryRow(`
		SELECT from_branch_id, to_branch_id, distance_km, avg_transit_hours,
		       observed_count, enabled, source, updated_at
		FROM branch_graph
		WHERE from_branch_id = $1 AND to_branch_id = $2`, from, to).
		Scan(&e.FromBranchID, &e.ToBranchID, &e.DistanceKm, &e.AvgTransitHours,
			&e.ObservedCount, &e.Enabled, &e.Source, &e.UpdatedAt)
	if err == sql.ErrNoRows {
		return model.BranchEdge{}, false
	}
	if err != nil {
		return model.BranchEdge{}, false
	}
	return e, true
}

func (r *postgresBranchGraphRepository) UpsertEdge(e model.BranchEdge) error {
	_, err := r.db.Exec(`
		INSERT INTO branch_graph
			(from_branch_id, to_branch_id, distance_km, avg_transit_hours,
			 observed_count, enabled, source, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (from_branch_id, to_branch_id) DO UPDATE SET
			distance_km       = EXCLUDED.distance_km,
			avg_transit_hours = EXCLUDED.avg_transit_hours,
			observed_count    = EXCLUDED.observed_count,
			-- Preservar enabled y source manuales: solo actualiza si source es 'auto'
			enabled    = CASE WHEN branch_graph.source = 'manual' THEN branch_graph.enabled    ELSE EXCLUDED.enabled    END,
			source     = CASE WHEN branch_graph.source = 'manual' THEN branch_graph.source     ELSE EXCLUDED.source     END,
			updated_at = EXCLUDED.updated_at`,
		e.FromBranchID, e.ToBranchID, e.DistanceKm, e.AvgTransitHours,
		e.ObservedCount, e.Enabled, e.Source, time.Now().UTC(),
	)
	return err
}

func (r *postgresBranchGraphRepository) SetEnabled(from, to string, enabled bool) error {
	_, err := r.db.Exec(`
		UPDATE branch_graph
		SET enabled = $3, source = 'manual', updated_at = NOW()
		WHERE from_branch_id = $1 AND to_branch_id = $2`,
		from, to, enabled,
	)
	return err
}

func (r *postgresBranchGraphRepository) DeriveHopAggregates() ([]model.HopAggregate, error) {
	rows, err := r.db.Query(`
		SELECT from_branch_id, to_branch_id,
		       COUNT(*)::int              AS observed_count,
		       AVG(transit_hours)         AS avg_transit_hours
		FROM shipment_hop_metrics
		WHERE arrived_at IS NOT NULL
		  AND transit_hours > 0
		  AND from_branch_id <> ''
		  AND to_branch_id   <> ''
		  AND from_branch_id <> to_branch_id
		GROUP BY from_branch_id, to_branch_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.HopAggregate
	for rows.Next() {
		var a model.HopAggregate
		if err := rows.Scan(&a.FromBranchID, &a.ToBranchID, &a.ObservedCount, &a.AvgTransitHours); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}
