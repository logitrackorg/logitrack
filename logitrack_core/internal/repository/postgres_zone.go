package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresZoneRepository struct {
	db *sql.DB
}

func NewPostgresZoneRepository(db *sql.DB) ZoneRepository {
	return &postgresZoneRepository{db: db}
}

func (r *postgresZoneRepository) List(includeInactive bool) ([]model.Zone, error) {
	query := `SELECT id, name, description, polygon, active, created_by, created_at, updated_at
	          FROM zones`
	if !includeInactive {
		query += ` WHERE active = TRUE`
	}
	query += ` ORDER BY created_at DESC`

	rows, err := r.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var zones []model.Zone
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, z)
	}
	return zones, rows.Err()
}

func (r *postgresZoneRepository) GetByID(id string) (model.Zone, error) {
	row := r.db.QueryRow(`SELECT id, name, description, polygon, active, created_by, created_at, updated_at
	                      FROM zones WHERE id = $1`, id)
	z, err := scanZoneRow(row)
	if err == sql.ErrNoRows {
		return model.Zone{}, fmt.Errorf("zona no encontrada")
	}
	return z, err
}

func (r *postgresZoneRepository) Create(zone model.Zone) error {
	polygonJSON, err := json.Marshal(zone.Polygon)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`INSERT INTO zones (id, name, description, polygon, active, created_by, created_at, updated_at)
	                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		zone.ID, zone.Name, zone.Description, polygonJSON,
		zone.Active, zone.CreatedBy, zone.CreatedAt, zone.UpdatedAt)
	return err
}

func (r *postgresZoneRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM zones WHERE id = $1`, id)
	return err
}

func (r *postgresZoneRepository) Update(id string, zone model.Zone) error {
	polygonJSON, err := json.Marshal(zone.Polygon)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`UPDATE zones SET name=$1, description=$2, polygon=$3, active=$4, updated_at=$5
	                    WHERE id=$6`,
		zone.Name, zone.Description, polygonJSON, zone.Active, zone.UpdatedAt, id)
	return err
}

func (r *postgresZoneRepository) ListActive() ([]model.Zone, error) {
	rows, err := r.db.Query(`SELECT id, name, description, polygon, active, created_by, created_at, updated_at
	                         FROM zones WHERE active = TRUE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var zones []model.Zone
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, z)
	}
	return zones, rows.Err()
}

func scanZone(s *sql.Rows) (model.Zone, error) {
	var z model.Zone
	var polygonJSON []byte
	var createdAt, updatedAt time.Time
	err := s.Scan(&z.ID, &z.Name, &z.Description, &polygonJSON, &z.Active, &z.CreatedBy, &createdAt, &updatedAt)
	if err != nil {
		return model.Zone{}, err
	}
	z.CreatedAt = createdAt
	z.UpdatedAt = updatedAt
	return z, json.Unmarshal(polygonJSON, &z.Polygon)
}

func scanZoneRow(row *sql.Row) (model.Zone, error) {
	var z model.Zone
	var polygonJSON []byte
	var createdAt, updatedAt time.Time
	err := row.Scan(&z.ID, &z.Name, &z.Description, &polygonJSON, &z.Active, &z.CreatedBy, &createdAt, &updatedAt)
	if err != nil {
		return model.Zone{}, err
	}
	z.CreatedAt = createdAt
	z.UpdatedAt = updatedAt
	return z, json.Unmarshal(polygonJSON, &z.Polygon)
}
