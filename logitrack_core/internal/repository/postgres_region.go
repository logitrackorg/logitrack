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

func (r *postgresRegionRepository) UpdateCoordinatesByName(name string, coords []model.LatLng) error {
	coordsJSON, err := json.Marshal(coords)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(
		`UPDATE regions SET coordinates = $1 WHERE name = $2`,
		coordsJSON, name,
	)
	return err
}

// Update renames and re-draws a custom region. The `type = 'custom'` guard
// makes predefined regions immutable; a 0-row result (unknown id or predefined
// region) is reported as sql.ErrNoRows so the handler can answer 404.
func (r *postgresRegionRepository) Update(id, name string, coords []model.LatLng) error {
	coordsJSON, err := json.Marshal(coords)
	if err != nil {
		return err
	}
	res, err := r.db.Exec(
		`UPDATE regions SET name = $1, coordinates = $2 WHERE id = $3 AND type = $4`,
		name, coordsJSON, id, model.RegionTypeCustom,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}
