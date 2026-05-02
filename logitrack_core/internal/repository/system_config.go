package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type SystemConfigRepository interface {
	Get() model.SystemConfig
	Update(cfg model.SystemConfig) error
}

type postgresSystemConfigRepository struct {
	db *sql.DB
}

func NewPostgresSystemConfigRepository(db *sql.DB) SystemConfigRepository {
	return &postgresSystemConfigRepository{db: db}
}

func (r *postgresSystemConfigRepository) Get() model.SystemConfig {
	var cfg model.SystemConfig
	err := r.db.QueryRow(`SELECT max_delivery_attempts FROM system_config WHERE id = 1`).
		Scan(&cfg.MaxDeliveryAttempts)
	if err != nil {
		return model.DefaultSystemConfig()
	}
	return cfg
}

func (r *postgresSystemConfigRepository) Update(cfg model.SystemConfig) error {
	_, err := r.db.Exec(
		`UPDATE system_config SET max_delivery_attempts = $1 WHERE id = 1`,
		cfg.MaxDeliveryAttempts,
	)
	return err
}
