package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type RoutingConfigRepository interface {
	Get() model.RoutingConfig
	Update(cfg model.RoutingConfig) error
}

type postgresRoutingConfigRepository struct {
	db *sql.DB
}

func NewPostgresRoutingConfigRepository(db *sql.DB) RoutingConfigRepository {
	return &postgresRoutingConfigRepository{db: db}
}

func (r *postgresRoutingConfigRepository) Get() model.RoutingConfig {
	var cfg model.RoutingConfig
	err := r.db.QueryRow(`
		SELECT sla_force_horizon_hours, priority_force_threshold,
		       min_fill_rate, max_shipments_per_driver, max_weight_kg_per_driver
		FROM routing_config WHERE id = 1`).
		Scan(
			&cfg.SLAForceHorizonHours, &cfg.PriorityForceThreshold,
			&cfg.MinFillRate, &cfg.MaxShipmentsPerDriver, &cfg.MaxWeightKgPerDriver,
		)
	if err != nil {
		return model.DefaultRoutingConfig()
	}
	return cfg
}

func (r *postgresRoutingConfigRepository) Update(cfg model.RoutingConfig) error {
	_, err := r.db.Exec(`
		UPDATE routing_config SET
			sla_force_horizon_hours  = $1,
			priority_force_threshold = $2,
			min_fill_rate            = $3,
			max_shipments_per_driver = $4,
			max_weight_kg_per_driver = $5
		WHERE id = 1`,
		cfg.SLAForceHorizonHours, cfg.PriorityForceThreshold,
		cfg.MinFillRate, cfg.MaxShipmentsPerDriver, cfg.MaxWeightKgPerDriver,
	)
	return err
}
