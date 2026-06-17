package repository

import (
	"database/sql"
	"encoding/json"

	"github.com/logitrack/core/internal/model"
)

type postgresRegionRepository struct {
	db *sql.DB
}

func NewPostgresRegionRepository(db *sql.DB) RegionRepository {
	return &postgresRegionRepository{db: db}
}

func (r *postgresRegionRepository) List() ([]model.Region, error) {
	rows, err := r.db.Query(
		`SELECT id, name, type, coordinates FROM regions ORDER BY type ASC, name ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.Region
	for rows.Next() {
		var reg model.Region
		var coordsJSON []byte
		if err := rows.Scan(&reg.ID, &reg.Name, &reg.Type, &coordsJSON); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(coordsJSON, &reg.Coordinates); err != nil {
			return nil, err
		}
		out = append(out, reg)
	}
	return out, rows.Err()
}

func (r *postgresRegionRepository) Create(reg model.Region) error {
	coordsJSON, err := json.Marshal(reg.Coordinates)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(
		`INSERT INTO regions (id, name, type, coordinates) VALUES ($1, $2, $3, $4)`,
		reg.ID, reg.Name, reg.Type, coordsJSON,
	)
	return err
}

func (r *postgresRegionRepository) CountByType(regionType string) (int, error) {
	var count int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM regions WHERE type = $1`, regionType).Scan(&count)
	return count, err
}
