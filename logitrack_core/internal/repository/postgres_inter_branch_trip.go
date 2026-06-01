package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

type postgresInterBranchTripRepository struct {
	db *sql.DB
}

func NewPostgresInterBranchTripRepository(db *sql.DB) InterBranchTripRepository {
	return &postgresInterBranchTripRepository{db: db}
}

func (r *postgresInterBranchTripRepository) Create(trip model.InterBranchTrip) error {
	ids, _ := json.Marshal(trip.ShipmentIDs)
	stopsJSON, _ := json.Marshal(trip.Stops)
	if trip.Stops == nil {
		stopsJSON = []byte("[]")
	}
	kind := string(trip.Kind)
	if kind == "" {
		kind = string(model.TripKindInterBranch)
	}
	_, err := r.db.Exec(`
		INSERT INTO inter_branch_trips
			(id, kind, driver_id, vehicle_id, license_plate, origin_branch_id, destination_branch_id,
			 shipment_ids, status, total_weight_kg, created_by, created_at,
			 stops, current_stop_index, scheduled_departure_at, estimated_arrival_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		trip.ID, kind, trip.DriverID, trip.VehicleID, trip.LicensePlate,
		trip.OriginBranchID, trip.DestinationBranchID,
		ids, string(trip.Status), trip.TotalWeightKg,
		trip.CreatedBy, trip.CreatedAt,
		stopsJSON, trip.CurrentStopIndex,
		trip.ScheduledDepartureAt, trip.EstimatedArrivalAt,
	)
	return err
}

const tripSelectCols = `id, kind, driver_id, vehicle_id, license_plate, origin_branch_id, destination_branch_id,
	shipment_ids, status, total_weight_kg, created_by, created_at,
	started_at, completed_at, finished_by_user_id, stops, current_stop_index,
	scheduled_departure_at, estimated_arrival_at`

func (r *postgresInterBranchTripRepository) GetByID(id string) (model.InterBranchTrip, bool) {
	row := r.db.QueryRow(`SELECT `+tripSelectCols+` FROM inter_branch_trips WHERE id = $1`, id)
	t, err := scanTrip(row.Scan)
	if err != nil {
		return model.InterBranchTrip{}, false
	}
	return t, true
}

func (r *postgresInterBranchTripRepository) GetActiveByDriver(driverID string) (model.InterBranchTrip, bool) {
	row := r.db.QueryRow(`
		SELECT `+tripSelectCols+`
		FROM inter_branch_trips
		WHERE driver_id = $1 AND status IN ('pendiente','en_transito')
		ORDER BY created_at DESC LIMIT 1`, driverID)
	t, err := scanTrip(row.Scan)
	if err != nil {
		return model.InterBranchTrip{}, false
	}
	return t, true
}

func (r *postgresInterBranchTripRepository) GetActiveByVehicle(vehicleID string) (model.InterBranchTrip, bool) {
	row := r.db.QueryRow(`
		SELECT `+tripSelectCols+`
		FROM inter_branch_trips
		WHERE vehicle_id = $1 AND status IN ('pendiente','en_transito')
		ORDER BY created_at DESC LIMIT 1`, vehicleID)
	t, err := scanTrip(row.Scan)
	if err != nil {
		return model.InterBranchTrip{}, false
	}
	return t, true
}

func (r *postgresInterBranchTripRepository) AdvanceStop(tripID string, stopIndex int, completedByUserID string) error {
	now := clock.Now()
	// Patch the JSON for the given stop with completed_at + completed_by_user_id,
	// then increment current_stop_index — all in one statement.
	q := `
		UPDATE inter_branch_trips
		SET stops = jsonb_set(
			jsonb_set(stops, ARRAY[$2::text, 'completed_at'], to_jsonb($3::timestamptz), true),
			ARRAY[$2::text, 'completed_by_user_id'], to_jsonb($4::text), true),
			current_stop_index = current_stop_index + 1
		WHERE id = $1`
	_, err := r.db.Exec(q, tripID, fmt.Sprintf("%d", stopIndex), now, completedByUserID)
	return err
}

func (r *postgresInterBranchTripRepository) ClaimByDriver(tripID, driverID string) (bool, error) {
	res, err := r.db.Exec(
		`UPDATE inter_branch_trips SET driver_id = $1 WHERE id = $2 AND driver_id IS NULL`,
		driverID, tripID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (r *postgresInterBranchTripRepository) ReleaseDriver(tripID string) error {
	_, err := r.db.Exec(`UPDATE inter_branch_trips SET driver_id = NULL WHERE id = $1`, tripID)
	return err
}

func (r *postgresInterBranchTripRepository) MarkStopUnloaded(tripID string, stopIdx int, ts time.Time, byUserID string) error {
	patch := fmt.Sprintf(`{"unloaded_at": "%s", "unloaded_by": "%s"}`, ts.UTC().Format("2006-01-02T15:04:05Z"), byUserID)
	_, err := r.db.Exec(`
		UPDATE inter_branch_trips
		SET stops = jsonb_set(stops, $1::text[], stops->$2::int || $3::jsonb, false)
		WHERE id = $4`,
		fmt.Sprintf("{%d}", stopIdx), stopIdx, patch, tripID)
	return err
}

func (r *postgresInterBranchTripRepository) UpdateStatus(id string, status model.TripStatus) error {
	_, err := r.db.Exec(`UPDATE inter_branch_trips SET status = $1 WHERE id = $2`, string(status), id)
	return err
}

func (r *postgresInterBranchTripRepository) SetDriver(id string, driverID string) error {
	_, err := r.db.Exec(`UPDATE inter_branch_trips SET driver_id = $1 WHERE id = $2`, driverID, id)
	return err
}

func (r *postgresInterBranchTripRepository) SetStartedAt(id string) error {
	now := clock.Now()
	_, err := r.db.Exec(`UPDATE inter_branch_trips SET started_at = $1, status = 'en_transito' WHERE id = $2`, now, id)
	return err
}

func (r *postgresInterBranchTripRepository) SetCompleted(id string, finishedByUserID string) error {
	now := clock.Now()
	_, err := r.db.Exec(`
		UPDATE inter_branch_trips
		SET completed_at = $1, finished_by_user_id = $2, status = 'completado'
		WHERE id = $3`, now, finishedByUserID, id)
	return err
}

func (r *postgresInterBranchTripRepository) AddShipment(tripID, shipmentID string) error {
	_, err := r.db.Exec(`
		UPDATE inter_branch_trips
		SET shipment_ids = array_append(COALESCE(shipment_ids, '{}'), $1)
		WHERE id = $2 AND NOT ($1 = ANY(COALESCE(shipment_ids, '{}')))`,
		shipmentID, tripID)
	return err
}

func (r *postgresInterBranchTripRepository) ListByDestinationBranch(branchID string) []model.InterBranchTrip {
	return r.listWhere(`destination_branch_id = $1 AND status NOT IN ('cancelado') ORDER BY created_at DESC`, branchID)
}

func (r *postgresInterBranchTripRepository) ListByOriginBranch(branchID string) []model.InterBranchTrip {
	return r.listWhere(`origin_branch_id = $1 AND status NOT IN ('cancelado') ORDER BY created_at DESC`, branchID)
}

func (r *postgresInterBranchTripRepository) ListByStopBranch(branchID string) []model.InterBranchTrip {
	// JSONB containment: stops contiene un objeto con branch_id = branchID
	jsonbFilter := fmt.Sprintf(`[{"branch_id":"%s"}]`, branchID)
	return r.listWhere(
		`stops @> $1::jsonb AND status NOT IN ('cancelado') ORDER BY created_at DESC`,
		jsonbFilter,
	)
}

func (r *postgresInterBranchTripRepository) ListAllActive() []model.InterBranchTrip {
	return r.listWhere(`status IN ('pendiente','en_transito') ORDER BY created_at DESC`)
}

func (r *postgresInterBranchTripRepository) ListByDateRange(from, to time.Time) []model.InterBranchTrip {
	return r.listWhere(
		`COALESCE(scheduled_departure_at, created_at) >= $1
		 AND COALESCE(scheduled_departure_at, created_at) < $2
		 AND status != 'cancelado'
		 ORDER BY COALESCE(scheduled_departure_at, created_at) ASC`,
		from, to,
	)
}

func (r *postgresInterBranchTripRepository) listWhere(where string, args ...any) []model.InterBranchTrip {
	rows, err := r.db.Query(`SELECT `+tripSelectCols+` FROM inter_branch_trips WHERE `+where, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var result []model.InterBranchTrip
	for rows.Next() {
		t, err := scanTrip(rows.Scan)
		if err == nil {
			result = append(result, t)
		}
	}
	return result
}

func scanTrip(scan func(...any) error) (model.InterBranchTrip, error) {
	var t model.InterBranchTrip
	var status, kind string
	var driverID, finishedByUserID sql.NullString
	var destinationBranchID sql.NullString
	var startedAt, completedAt, scheduledDepartureAt, estimatedArrivalAt sql.NullTime
	var idsJSON, stopsJSON []byte
	var currentStopIndex sql.NullInt64

	err := scan(
		&t.ID, &kind, &driverID, &t.VehicleID, &t.LicensePlate,
		&t.OriginBranchID, &destinationBranchID,
		&idsJSON, &status, &t.TotalWeightKg,
		&t.CreatedBy, &t.CreatedAt,
		&startedAt, &completedAt, &finishedByUserID,
		&stopsJSON, &currentStopIndex,
		&scheduledDepartureAt, &estimatedArrivalAt,
	)
	if err != nil {
		return model.InterBranchTrip{}, err
	}
	t.Status = model.TripStatus(status)
	t.Kind = model.TripKind(kind)
	if t.Kind == "" {
		t.Kind = model.TripKindInterBranch
	}
	if driverID.Valid {
		t.DriverID = &driverID.String
	}
	if destinationBranchID.Valid {
		t.DestinationBranchID = &destinationBranchID.String
	}
	if finishedByUserID.Valid {
		t.FinishedByUserID = &finishedByUserID.String
	}
	if startedAt.Valid {
		v := startedAt.Time
		t.StartedAt = &v
	}
	if completedAt.Valid {
		v := completedAt.Time
		t.CompletedAt = &v
	}
	if scheduledDepartureAt.Valid {
		v := scheduledDepartureAt.Time
		t.ScheduledDepartureAt = &v
	}
	if estimatedArrivalAt.Valid {
		v := estimatedArrivalAt.Time
		t.EstimatedArrivalAt = &v
	}
	if len(idsJSON) > 0 {
		_ = json.Unmarshal(idsJSON, &t.ShipmentIDs)
	}
	if t.ShipmentIDs == nil {
		t.ShipmentIDs = []string{}
	}
	if len(stopsJSON) > 0 {
		_ = json.Unmarshal(stopsJSON, &t.Stops)
	}
	if currentStopIndex.Valid {
		t.CurrentStopIndex = int(currentStopIndex.Int64)
	}
	return t, nil
}
