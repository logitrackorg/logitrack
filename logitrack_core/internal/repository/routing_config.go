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
		       min_fill_rate, max_shipments_per_driver, max_weight_kg_per_driver,
		       enforce_time_windows, morning_window_start_hour, morning_window_end_hour,
		       afternoon_window_start_hour, afternoon_window_end_hour,
		       service_time_minutes, avg_speed_kmh
		FROM routing_config WHERE id = 1`).
		Scan(
			&cfg.SLAForceHorizonHours, &cfg.PriorityForceThreshold,
			&cfg.MinFillRate, &cfg.MaxShipmentsPerDriver, &cfg.MaxWeightKgPerDriver,
			&cfg.EnforceTimeWindows, &cfg.MorningWindowStartHour, &cfg.MorningWindowEndHour,
			&cfg.AfternoonWindowStartHour, &cfg.AfternoonWindowEndHour,
			&cfg.ServiceTimeMinutes, &cfg.AvgSpeedKmh,
		)
	if err != nil {
		return model.DefaultRoutingConfig()
	}
	return cfg
}

func (r *postgresRoutingConfigRepository) Update(cfg model.RoutingConfig) error {
	_, err := r.db.Exec(`
		UPDATE routing_config SET
			sla_force_horizon_hours        = $1,
			priority_force_threshold       = $2,
			min_fill_rate                  = $3,
			max_shipments_per_driver       = $4,
			max_weight_kg_per_driver       = $5,
			enforce_time_windows           = $6,
			morning_window_start_hour      = $7,
			morning_window_end_hour        = $8,
			afternoon_window_start_hour    = $9,
			afternoon_window_end_hour      = $10,
			service_time_minutes           = $11,
			avg_speed_kmh                  = $12
		WHERE id = 1`,
		cfg.SLAForceHorizonHours, cfg.PriorityForceThreshold,
		cfg.MinFillRate, cfg.MaxShipmentsPerDriver, cfg.MaxWeightKgPerDriver,
		cfg.EnforceTimeWindows, cfg.MorningWindowStartHour, cfg.MorningWindowEndHour,
		cfg.AfternoonWindowStartHour, cfg.AfternoonWindowEndHour,
		cfg.ServiceTimeMinutes, cfg.AvgSpeedKmh,
	)
	return err
}
