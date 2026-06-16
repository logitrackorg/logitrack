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
	if route.Status == "" {
		route.Status = model.RouteStatusPending
	}
	_, err = r.db.Exec(`
		INSERT INTO routes (id, date, driver_id, shipment_ids, created_by, created_at, status, started_at, suggested_start_time)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		route.ID, route.Date.String(), route.DriverID, ids, route.CreatedBy, route.CreatedAt,
		string(route.Status), route.StartedAt, route.SuggestedStartTime,
	)
	return route, err
}

func (r *postgresRouteRepository) Update(route model.Route) error {
	ids, err := json.Marshal(route.ShipmentIDs)
	if err != nil {
		return err
	}
	res, err := r.db.Exec(`
		UPDATE routes SET shipment_ids = $1, status = $2, started_at = $3, suggested_start_time = $4 WHERE id = $5`,
		ids, string(route.Status), route.StartedAt, route.SuggestedStartTime, route.ID,
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

func (r *postgresRouteRepository) UpdateStatus(id string, status model.RouteStatus, startedAt *time.Time) error {
	res, err := r.db.Exec(`
		UPDATE routes SET status = $1, started_at = $2 WHERE id = $3`,
		string(status), startedAt, id,
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
		SELECT id, date, driver_id, shipment_ids, created_by, created_at, status, started_at, suggested_start_time
		FROM routes
		WHERE driver_id = $1 AND date = $2`,
		driverID, date.String(),
	)
	return scanRoute(row)
}

func (r *postgresRouteRepository) GetByID(id string) (model.Route, error) {
	row := r.db.QueryRow(`
		SELECT id, date, driver_id, shipment_ids, created_by, created_at, status, started_at, suggested_start_time
		FROM routes WHERE id = $1`, id)
	return scanRoute(row)
}

func (r *postgresRouteRepository) ListByDateRange(from, to time.Time) []model.Route {
	rows, err := r.db.Query(`
		SELECT id, date, driver_id, shipment_ids, created_by, created_at, status, started_at, suggested_start_time
		FROM routes WHERE date >= $1 AND date <= $2
		ORDER BY date ASC`,
		from.Format("2006-01-02"), to.Format("2006-01-02"),
	)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var result []model.Route
	for rows.Next() {
		route, err := scanRouteRow(rows)
		if err != nil {
			continue
		}
		result = append(result, route)
	}
	return result
}

func (r *postgresRouteRepository) RemoveShipmentFromDate(trackingID string, date model.DateOnly) error {
	rows, err := r.db.Query(`
		SELECT id, date, driver_id, shipment_ids, created_by, created_at, status, started_at, suggested_start_time
		FROM routes WHERE date = $1 AND shipment_ids @> jsonb_build_array($2::text)`,
		date.String(), trackingID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	var toUpdate []model.Route
	for rows.Next() {
		route, err := scanRouteRow(rows)
		if err != nil {
			continue
		}
		filtered := route.ShipmentIDs[:0]
		for _, id := range route.ShipmentIDs {
			if id != trackingID {
				filtered = append(filtered, id)
			}
		}
		route.ShipmentIDs = filtered
		toUpdate = append(toUpdate, route)
	}

	for _, route := range toUpdate {
		if err := r.Update(route); err != nil {
			return err
		}
	}
	return nil
}

func scanRoute(row *sql.Row) (model.Route, error) {
	var (
		route        model.Route
		dateStr      string
		idsJSON      []byte
		ts           time.Time
		statusStr    string
		startedAt    sql.NullTime
		suggestedAt  sql.NullTime
	)
	err := row.Scan(&route.ID, &dateStr, &route.DriverID, &idsJSON, &route.CreatedBy, &ts, &statusStr, &startedAt, &suggestedAt)
	if err == sql.ErrNoRows {
		return model.Route{}, fmt.Errorf("route not found")
	}
	if err != nil {
		return model.Route{}, err
	}
	return buildRoute(route, dateStr, idsJSON, ts, statusStr, startedAt, suggestedAt)
}

func scanRouteRow(rows *sql.Rows) (model.Route, error) {
	var (
		route        model.Route
		dateStr      string
		idsJSON      []byte
		ts           time.Time
		statusStr    string
		startedAt    sql.NullTime
		suggestedAt  sql.NullTime
	)
	if err := rows.Scan(&route.ID, &dateStr, &route.DriverID, &idsJSON, &route.CreatedBy, &ts, &statusStr, &startedAt, &suggestedAt); err != nil {
		return model.Route{}, err
	}
	return buildRoute(route, dateStr, idsJSON, ts, statusStr, startedAt, suggestedAt)
}

func buildRoute(route model.Route, dateStr string, idsJSON []byte, ts time.Time, statusStr string, startedAt, suggestedAt sql.NullTime) (model.Route, error) {
	route.CreatedAt = ts
	route.Status = model.RouteStatus(statusStr)
	if startedAt.Valid {
		t := startedAt.Time
		route.StartedAt = &t
	}
	if suggestedAt.Valid {
		t := suggestedAt.Time
		route.SuggestedStartTime = &t
	}

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
