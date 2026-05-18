package repository

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"strings"

	"github.com/lib/pq"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

func generateQRToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// postgresVehicleRepository persists vehicles in PostgreSQL.
type postgresVehicleRepository struct {
	db *sql.DB
}

func NewPostgresVehicleRepository(db *sql.DB) VehicleRepository {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS vehicles (
			id SERIAL PRIMARY KEY,
			license_plate VARCHAR(20) UNIQUE NOT NULL,
			type VARCHAR(50) NOT NULL,
			capacity_kg NUMERIC(10,2) NOT NULL,
			status VARCHAR(50) NOT NULL DEFAULT 'disponible',
			assigned_shipment VARCHAR(100),
			updated_at TIMESTAMP,
			updated_by VARCHAR(100)
		)
	`)
	if err != nil {
		panic("failed to create vehicles table: " + err.Error())
	}

	for _, migration := range []string{
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_branch VARCHAR(50)`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS destination_branch VARCHAR(50)`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_shipments TEXT[]`,
		// Migrate existing single-shipment data into the array column
		`UPDATE vehicles SET assigned_shipments = ARRAY[assigned_shipment]
		 WHERE assigned_shipment IS NOT NULL AND (assigned_shipments IS NULL OR assigned_shipments = '{}')`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_latitude    DOUBLE PRECISION`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_longitude   DOUBLE PRECISION`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS qr_token TEXT`,
		`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'inter_sucursal'`,
		`UPDATE vehicles SET mode = 'ultima_milla' WHERE type IN ('furgoneta','auto') AND mode = 'inter_sucursal'`,
		`CREATE UNIQUE INDEX IF NOT EXISTS vehicles_qr_token_idx ON vehicles(qr_token) WHERE qr_token IS NOT NULL`,
	} {
		if _, err := db.Exec(migration); err != nil {
			panic("vehicle migration failed: " + err.Error())
		}
	}

	// Backfill qr_token for existing vehicles that don't have one yet (Go-side, no pgcrypto needed).
	rows, err := db.Query(`SELECT id FROM vehicles WHERE qr_token IS NULL`)
	if err == nil {
		defer rows.Close()
		var ids []string
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		for _, id := range ids {
			token := generateQRToken()
			_, _ = db.Exec(`UPDATE vehicles SET qr_token = $1 WHERE id = $2 AND qr_token IS NULL`, token, id)
		}
	}

	return &postgresVehicleRepository{db: db}
}

// scanVehicle reads a row with columns: id, license_plate, type, capacity_kg, status,
// assigned_shipments, assigned_branch, destination_branch, updated_at, updated_by,
// current_latitude, current_longitude, location_updated_at, qr_token, mode
func scanVehicle(scan func(...any) error) (model.Vehicle, error) {
	var v model.Vehicle
	var capacityKg float64
	var updatedAt sql.NullTime
	var updatedBy sql.NullString
	var assignedShipments pq.StringArray
	var assignedBranch sql.NullString
	var destinationBranch sql.NullString
	var currentLat, currentLng sql.NullFloat64
	var locationUpdatedAt sql.NullTime
	var qrToken sql.NullString
	var mode sql.NullString

	err := scan(&v.ID, &v.LicensePlate, &v.Type, &capacityKg, &v.Status,
		&assignedShipments, &assignedBranch, &destinationBranch, &updatedAt, &updatedBy,
		&currentLat, &currentLng, &locationUpdatedAt, &qrToken, &mode)
	if err != nil {
		return model.Vehicle{}, err
	}

	v.CapacityKg = capacityKg
	if len(assignedShipments) > 0 {
		v.AssignedShipments = []string(assignedShipments)
	}
	if assignedBranch.Valid {
		v.AssignedBranch = &assignedBranch.String
	}
	if destinationBranch.Valid {
		v.DestinationBranch = &destinationBranch.String
	}
	if updatedAt.Valid {
		v.UpdatedAt = updatedAt.Time
	}
	if updatedBy.Valid {
		v.UpdatedBy = updatedBy.String
	}
	if currentLat.Valid {
		v.CurrentLatitude = &currentLat.Float64
	}
	if currentLng.Valid {
		v.CurrentLongitude = &currentLng.Float64
	}
	if locationUpdatedAt.Valid {
		v.LocationUpdatedAt = &locationUpdatedAt.Time
	}
	if qrToken.Valid {
		v.QRToken = qrToken.String
	}
	if mode.Valid {
		v.Mode = model.VehicleMode(mode.String)
	}
	return v, nil
}

const vehicleSelectCols = `id, license_plate, type, capacity_kg, status,
	assigned_shipments, assigned_branch, destination_branch, updated_at, updated_by,
	current_latitude, current_longitude, location_updated_at, qr_token, mode`

func (r *postgresVehicleRepository) List() []model.Vehicle {
	rows, err := r.db.Query(`SELECT ` + vehicleSelectCols + ` FROM vehicles ORDER BY id`)
	if err != nil {
		return []model.Vehicle{}
	}
	defer rows.Close()

	var vehicles []model.Vehicle
	for rows.Next() {
		v, err := scanVehicle(rows.Scan)
		if err != nil {
			continue
		}
		vehicles = append(vehicles, v)
	}
	return vehicles
}

func (r *postgresVehicleRepository) Add(vehicle model.Vehicle) error {
	var id int
	var assignedBranch interface{}
	if vehicle.AssignedBranch != nil {
		assignedBranch = *vehicle.AssignedBranch
	}
	if vehicle.QRToken == "" {
		vehicle.QRToken = generateQRToken()
	}
	mode := string(vehicle.Mode)
	if mode == "" {
		mode = string(model.VehicleModeInterBranch)
	}

	err := r.db.QueryRow(`
		INSERT INTO vehicles (license_plate, type, capacity_kg, status, assigned_branch, updated_at, qr_token, mode)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`, vehicle.LicensePlate, vehicle.Type, vehicle.CapacityKg, vehicle.Status, assignedBranch, clock.Now(), vehicle.QRToken, mode).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return ErrDuplicateLicensePlate
		}
		return err
	}
	return nil
}

func (r *postgresVehicleRepository) SyncMode(licensePlate string, mode model.VehicleMode) error {
	_, err := r.db.Exec(
		`UPDATE vehicles SET mode = $1 WHERE UPPER(license_plate) = UPPER($2)`,
		string(mode), licensePlate,
	)
	return err
}

func (r *postgresVehicleRepository) GetByQRToken(token string) (model.Vehicle, bool) {
	row := r.db.QueryRow(`SELECT `+vehicleSelectCols+` FROM vehicles WHERE qr_token = $1`, token)
	v, err := scanVehicle(row.Scan)
	if err != nil {
		return model.Vehicle{}, false
	}
	return v, true
}

func (r *postgresVehicleRepository) GetByID(id string) (model.Vehicle, bool) {
	row := r.db.QueryRow(`SELECT `+vehicleSelectCols+` FROM vehicles WHERE id = $1`, id)
	v, err := scanVehicle(row.Scan)
	if err != nil {
		return model.Vehicle{}, false
	}
	return v, true
}

func (r *postgresVehicleRepository) GetByLicensePlate(licensePlate string) (model.Vehicle, bool) {
	row := r.db.QueryRow(
		`SELECT `+vehicleSelectCols+` FROM vehicles WHERE UPPER(license_plate) = UPPER($1)`,
		licensePlate,
	)
	v, err := scanVehicle(row.Scan)
	if err != nil {
		return model.Vehicle{}, false
	}
	return v, true
}

func (r *postgresVehicleRepository) UpdateStatus(id string, status model.VehicleStatus) error {
	_, err := r.db.Exec(`UPDATE vehicles SET status = $1, updated_at = $2 WHERE id = $3`,
		status, clock.Now(), id)
	return err
}

func (r *postgresVehicleRepository) UpdateStatusByUser(id string, status model.VehicleStatus, username string) error {
	_, err := r.db.Exec(`UPDATE vehicles SET status = $1, updated_at = $2, updated_by = $3 WHERE id = $4`,
		status, clock.Now(), username, id)
	return err
}

func (r *postgresVehicleRepository) AddShipment(id string, trackingID string) error {
	_, err := r.db.Exec(`
		UPDATE vehicles
		SET assigned_shipments = array_append(COALESCE(assigned_shipments, '{}'), $1), updated_at = $2
		WHERE id = $3 AND NOT ($1 = ANY(COALESCE(assigned_shipments, '{}')))
	`, trackingID, clock.Now(), id)
	return err
}

func (r *postgresVehicleRepository) RemoveShipment(id string, trackingID string) error {
	_, err := r.db.Exec(`
		UPDATE vehicles
		SET assigned_shipments = array_remove(assigned_shipments, $1), updated_at = $2
		WHERE id = $3
	`, trackingID, clock.Now(), id)
	return err
}

func (r *postgresVehicleRepository) ClearShipments(id string) error {
	_, err := r.db.Exec(`UPDATE vehicles SET assigned_shipments = NULL, updated_at = $1 WHERE id = $2`,
		clock.Now(), id)
	return err
}

func (r *postgresVehicleRepository) AssignBranch(id string, branchID *string) error {
	var val interface{}
	if branchID != nil {
		val = *branchID
	}
	_, err := r.db.Exec(`UPDATE vehicles SET assigned_branch = $1, updated_at = $2 WHERE id = $3`,
		val, clock.Now(), id)
	return err
}

func (r *postgresVehicleRepository) SetDestinationBranch(id string, branchID *string) error {
	var val interface{}
	if branchID != nil {
		val = *branchID
	}
	_, err := r.db.Exec(`UPDATE vehicles SET destination_branch = $1, updated_at = $2 WHERE id = $3`,
		val, clock.Now(), id)
	return err
}

func (r *postgresVehicleRepository) UpdateLocation(id string, lat, lng float64) error {
	_, err := r.db.Exec(
		`UPDATE vehicles SET current_latitude = $1, current_longitude = $2, location_updated_at = $3 WHERE id = $4`,
		lat, lng, clock.Now(), id,
	)
	return err
}
