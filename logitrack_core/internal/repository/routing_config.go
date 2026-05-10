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
	var strategy string
	err := r.db.QueryRow(`
		SELECT sla_force_horizon_hours, priority_force_threshold,
		       min_fill_rate, enforce_time_windows,
		       morning_window_start_hour, morning_window_end_hour,
		       afternoon_window_start_hour, afternoon_window_end_hour,
		       service_time_minutes, avg_speed_kmh,
		       last_mile_packing_strategy
		FROM routing_config WHERE id = 1`).
		Scan(
			&cfg.SLAForceHorizonHours, &cfg.PriorityForceThreshold,
			&cfg.MinFillRate, &cfg.EnforceTimeWindows,
			&cfg.MorningWindowStartHour, &cfg.MorningWindowEndHour,
			&cfg.AfternoonWindowStartHour, &cfg.AfternoonWindowEndHour,
			&cfg.ServiceTimeMinutes, &cfg.AvgSpeedKmh,
			&strategy,
		)
	if err != nil {
		return model.DefaultRoutingConfig()
	}
	cfg.LastMilePackingStrategy = model.LastMilePackingStrategy(strategy)
	return cfg
}

func (r *postgresRoutingConfigRepository) Update(cfg model.RoutingConfig) error {
	_, err := r.db.Exec(`
		UPDATE routing_config SET
			sla_force_horizon_hours        = $1,
			priority_force_threshold       = $2,
			min_fill_rate                  = $3,
			enforce_time_windows           = $4,
			morning_window_start_hour      = $5,
			morning_window_end_hour        = $6,
			afternoon_window_start_hour    = $7,
			afternoon_window_end_hour      = $8,
			service_time_minutes           = $9,
			avg_speed_kmh                  = $10,
			last_mile_packing_strategy     = $11
		WHERE id = 1`,
		cfg.SLAForceHorizonHours, cfg.PriorityForceThreshold,
		cfg.MinFillRate, cfg.EnforceTimeWindows,
		cfg.MorningWindowStartHour, cfg.MorningWindowEndHour,
		cfg.AfternoonWindowStartHour, cfg.AfternoonWindowEndHour,
		cfg.ServiceTimeMinutes, cfg.AvgSpeedKmh,
		string(cfg.LastMilePackingStrategy),
	)
	return err
}
