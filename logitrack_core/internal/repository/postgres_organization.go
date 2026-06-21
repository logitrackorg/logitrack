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
		SELECT id, name, cuit, address, phone, email, track_url,
		       primary_color, accent_color, sidebar_color, logo_url, font_family,
		       updated_at, updated_by
		FROM organization_config WHERE id = 1
	`)
	var cfg model.OrganizationConfig
	err := row.Scan(&cfg.ID, &cfg.Name, &cfg.CUIT, &cfg.Address, &cfg.Phone, &cfg.Email, &cfg.TrackURL,
		&cfg.PrimaryColor, &cfg.AccentColor, &cfg.SidebarColor, &cfg.LogoURL, &cfg.FontFamily,
		&cfg.UpdatedAt, &cfg.UpdatedBy)
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
		INSERT INTO organization_config (id, name, cuit, address, phone, email, track_url, primary_color, accent_color, sidebar_color, logo_url, font_family, updated_at, updated_by)
		VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
		ON CONFLICT (id) DO UPDATE SET
			name          = EXCLUDED.name,
			cuit          = EXCLUDED.cuit,
			address       = EXCLUDED.address,
			phone         = EXCLUDED.phone,
			email         = EXCLUDED.email,
			track_url     = EXCLUDED.track_url,
			primary_color = EXCLUDED.primary_color,
			accent_color  = EXCLUDED.accent_color,
			sidebar_color = EXCLUDED.sidebar_color,
			logo_url      = EXCLUDED.logo_url,
			font_family   = EXCLUDED.font_family,
			updated_at    = NOW(),
			updated_by    = EXCLUDED.updated_by
		RETURNING id, name, cuit, address, phone, email, track_url, primary_color, accent_color, sidebar_color, logo_url, font_family, updated_at, updated_by
	`, config.Name, config.CUIT, config.Address, config.Phone, config.Email, config.TrackURL,
		config.PrimaryColor, config.AccentColor, config.SidebarColor, config.LogoURL, config.FontFamily, config.UpdatedBy)

	var cfg model.OrganizationConfig
	err := row.Scan(&cfg.ID, &cfg.Name, &cfg.CUIT, &cfg.Address, &cfg.Phone, &cfg.Email, &cfg.TrackURL,
		&cfg.PrimaryColor, &cfg.AccentColor, &cfg.SidebarColor, &cfg.LogoURL, &cfg.FontFamily,
		&cfg.UpdatedAt, &cfg.UpdatedBy)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
