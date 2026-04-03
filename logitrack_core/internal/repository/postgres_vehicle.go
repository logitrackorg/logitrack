package repository

import (
	"database/sql"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/logitrack/core/internal/model"
)

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
	} {
		if _, err := db.Exec(migration); err != nil {
			panic("vehicle migration failed: " + err.Error())
		}
	}

	return &postgresVehicleRepository{db: db}
}

// scanVehicle reads a row with columns: id, license_plate, type, capacity_kg, status,
// assigned_shipments, assigned_branch, destination_branch, updated_at, updated_by
func scanVehicle(scan func(...any) error) (model.Vehicle, error) {
	var v model.Vehicle
	var capacityKg float64
	var updatedAt sql.NullTime
	var updatedBy sql.NullString
	var assignedShipments pq.StringArray
	var assignedBranch sql.NullString
	var destinationBranch sql.NullString

	err := scan(&v.ID, &v.LicensePlate, &v.Type, &capacityKg, &v.Status,
		&assignedShipments, &assignedBranch, &destinationBranch, &updatedAt, &updatedBy)
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
	return v, nil
}

const vehicleSelectCols = `id, license_plate, type, capacity_kg, status,
	assigned_shipments, assigned_branch, destination_branch, updated_at, updated_by`

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

	err := r.db.QueryRow(`
		INSERT INTO vehicles (license_plate, type, capacity_kg, status, assigned_branch, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, vehicle.LicensePlate, vehicle.Type, vehicle.CapacityKg, vehicle.Status, assignedBranch, time.Now()).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return ErrDuplicateLicensePlate
		}
		return err
	}
	return nil
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
		status, time.Now(), id)
	return err
}

func (r *postgresVehicleRepository) UpdateStatusByUser(id string, status model.VehicleStatus, username string) error {
	_, err := r.db.Exec(`UPDATE vehicles SET status = $1, updated_at = $2, updated_by = $3 WHERE id = $4`,
		status, time.Now(), username, id)
	return err
}

func (r *postgresVehicleRepository) AddShipment(id string, trackingID string) error {
	_, err := r.db.Exec(`
		UPDATE vehicles
		SET assigned_shipments = array_append(COALESCE(assigned_shipments, '{}'), $1), updated_at = $2
		WHERE id = $3 AND NOT ($1 = ANY(COALESCE(assigned_shipments, '{}')))
	`, trackingID, time.Now(), id)
	return err
}

func (r *postgresVehicleRepository) RemoveShipment(id string, trackingID string) error {
	_, err := r.db.Exec(`
		UPDATE vehicles
		SET assigned_shipments = array_remove(assigned_shipments, $1), updated_at = $2
		WHERE id = $3
	`, trackingID, time.Now(), id)
	return err
}

func (r *postgresVehicleRepository) ClearShipments(id string) error {
	_, err := r.db.Exec(`UPDATE vehicles SET assigned_shipments = NULL, updated_at = $1 WHERE id = $2`,
		time.Now(), id)
	return err
}

func (r *postgresVehicleRepository) AssignBranch(id string, branchID *string) error {
	var val interface{}
	if branchID != nil {
		val = *branchID
	}
	_, err := r.db.Exec(`UPDATE vehicles SET assigned_branch = $1, updated_at = $2 WHERE id = $3`,
		val, time.Now(), id)
	return err
}

func (r *postgresVehicleRepository) SetDestinationBranch(id string, branchID *string) error {
	var val interface{}
	if branchID != nil {
		val = *branchID
	}
	_, err := r.db.Exec(`UPDATE vehicles SET destination_branch = $1, updated_at = $2 WHERE id = $3`,
		val, time.Now(), id)
	return err
}
