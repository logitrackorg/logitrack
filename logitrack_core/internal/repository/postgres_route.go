package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresRouteRepository struct {
	db *sql.DB
}

func NewPostgresRouteRepository(db *sql.DB) RouteRepository {
	return &postgresRouteRepository{db: db}
}

func (r *postgresRouteRepository) Create(route model.Route) (model.Route, error) {
	ids, err := json.Marshal(route.ShipmentIDs)
	if err != nil {
		return model.Route{}, err
	}
	_, err = r.db.Exec(`
		INSERT INTO routes (id, date, driver_id, shipment_ids, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		route.ID, route.Date.String(), route.DriverID, ids, route.CreatedBy, route.CreatedAt,
	)
	return route, err
}

func (r *postgresRouteRepository) Update(route model.Route) error {
	ids, err := json.Marshal(route.ShipmentIDs)
	if err != nil {
		return err
	}
	res, err := r.db.Exec(`
		UPDATE routes SET shipment_ids = $1 WHERE id = $2`,
		ids, route.ID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("route not found")
	}
	return nil
}

func (r *postgresRouteRepository) GetByDriverAndDate(driverID string, date model.DateOnly) (model.Route, error) {
	row := r.db.QueryRow(`
		SELECT id, date, driver_id, shipment_ids, created_by, created_at
		FROM routes
		WHERE driver_id = $1 AND date = $2`,
		driverID, date.String(),
	)
	return scanRoute(row)
}

func (r *postgresRouteRepository) GetByID(id string) (model.Route, error) {
	row := r.db.QueryRow(`
		SELECT id, date, driver_id, shipment_ids, created_by, created_at
		FROM routes WHERE id = $1`, id)
	return scanRoute(row)
}

func scanRoute(row *sql.Row) (model.Route, error) {
	var (
		route   model.Route
		dateStr string
		idsJSON []byte
		ts      time.Time
	)
	err := row.Scan(&route.ID, &dateStr, &route.DriverID, &idsJSON, &route.CreatedBy, &ts)
	if err == sql.ErrNoRows {
		return model.Route{}, fmt.Errorf("route not found")
	}
	if err != nil {
		return model.Route{}, err
	}
	route.CreatedAt = ts

	var d model.DateOnly
	if err := json.Unmarshal([]byte(`"`+dateStr+`"`), &d); err != nil {
		return model.Route{}, fmt.Errorf("parse route date: %w", err)
	}
	route.Date = d

	if err := json.Unmarshal(idsJSON, &route.ShipmentIDs); err != nil {
		return model.Route{}, err
	}
	return route, nil
}
