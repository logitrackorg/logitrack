package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type postgresOrganizationRepository struct {
	db *sql.DB
}

func NewPostgresOrganizationRepository(db *sql.DB) OrganizationRepository {
	return &postgresOrganizationRepository{db: db}
}

func (r *postgresOrganizationRepository) Get() (*model.OrganizationConfig, error) {
	row := r.db.QueryRow(`
		SELECT id, name, cuit, address, phone, email, updated_at, updated_by
		FROM organization_config WHERE id = 1
	`)
	var cfg model.OrganizationConfig
	err := row.Scan(&cfg.ID, &cfg.Name, &cfg.CUIT, &cfg.Address, &cfg.Phone, &cfg.Email, &cfg.UpdatedAt, &cfg.UpdatedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (r *postgresOrganizationRepository) Upsert(config model.OrganizationConfig) (*model.OrganizationConfig, error) {
	row := r.db.QueryRow(`
		INSERT INTO organization_config (id, name, cuit, address, phone, email, updated_at, updated_by)
		VALUES (1, $1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (id) DO UPDATE SET
			name       = EXCLUDED.name,
			cuit       = EXCLUDED.cuit,
			address    = EXCLUDED.address,
			phone      = EXCLUDED.phone,
			email      = EXCLUDED.email,
			updated_at = NOW(),
			updated_by = EXCLUDED.updated_by
		RETURNING id, name, cuit, address, phone, email, updated_at, updated_by
	`, config.Name, config.CUIT, config.Address, config.Phone, config.Email, config.UpdatedBy)

	var cfg model.OrganizationConfig
	err := row.Scan(&cfg.ID, &cfg.Name, &cfg.CUIT, &cfg.Address, &cfg.Phone, &cfg.Email, &cfg.UpdatedAt, &cfg.UpdatedBy)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
