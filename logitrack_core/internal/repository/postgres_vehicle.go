package repository

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

// postgresVehicleRepository persists vehicles in PostgreSQL.
type postgresVehicleRepository struct {
	db *sql.DB
}

func NewPostgresVehicleRepository(db *sql.DB) VehicleRepository {
	// Ensure the vehicles table exists
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

	return &postgresVehicleRepository{db: db}
}

func (r *postgresVehicleRepository) List() []model.Vehicle {
	rows, err := r.db.Query(`
		SELECT id, license_plate, type, capacity_kg, status, assigned_shipment, updated_at, updated_by
		FROM vehicles ORDER BY id
	`)
	if err != nil {
		return []model.Vehicle{}
	}
	defer rows.Close()

	var vehicles []model.Vehicle
	for rows.Next() {
		var v model.Vehicle
		var capacityKg float64
		var updatedAt sql.NullTime
		var updatedBy sql.NullString
		var assignedShipment sql.NullString

		err := rows.Scan(&v.ID, &v.LicensePlate, &v.Type, &capacityKg, &v.Status, &assignedShipment, &updatedAt, &updatedBy)
		if err != nil {
			continue
		}

		v.CapacityKg = capacityKg
		if assignedShipment.Valid {
			v.AssignedShipment = &assignedShipment.String
		}
		if updatedAt.Valid {
			v.UpdatedAt = updatedAt.Time
		}
		if updatedBy.Valid {
			v.UpdatedBy = updatedBy.String
		}

		vehicles = append(vehicles, v)
	}

	return vehicles
}

func (r *postgresVehicleRepository) Add(vehicle model.Vehicle) error {
	var id int
	err := r.db.QueryRow(`
		INSERT INTO vehicles (license_plate, type, capacity_kg, status, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, vehicle.LicensePlate, vehicle.Type, vehicle.CapacityKg, vehicle.Status, time.Now()).Scan(&id)

	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return ErrDuplicateLicensePlate
		}
		return err
	}

	vehicle.ID = string(id)
	return nil
}

func (r *postgresVehicleRepository) GetByID(id string) (model.Vehicle, bool) {
	var v model.Vehicle
	var capacityKg float64
	var updatedAt sql.NullTime
	var updatedBy sql.NullString
	var assignedShipment sql.NullString

	err := r.db.QueryRow(`
		SELECT id, license_plate, type, capacity_kg, status, assigned_shipment, updated_at, updated_by
		FROM vehicles WHERE id = $1
	`, id).Scan(&v.ID, &v.LicensePlate, &v.Type, &capacityKg, &v.Status, &assignedShipment, &updatedAt, &updatedBy)

	if err == sql.ErrNoRows {
		return model.Vehicle{}, false
	}
	if err != nil {
		return model.Vehicle{}, false
	}

	v.CapacityKg = capacityKg
	if assignedShipment.Valid {
		v.AssignedShipment = &assignedShipment.String
	}
	if updatedAt.Valid {
		v.UpdatedAt = updatedAt.Time
	}
	if updatedBy.Valid {
		v.UpdatedBy = updatedBy.String
	}

	return v, true
}

func (r *postgresVehicleRepository) GetByLicensePlate(licensePlate string) (model.Vehicle, bool) {
	var v model.Vehicle
	var capacityKg float64
	var updatedAt sql.NullTime
	var updatedBy sql.NullString
	var assignedShipment sql.NullString

	err := r.db.QueryRow(`
		SELECT id, license_plate, type, capacity_kg, status, assigned_shipment, updated_at, updated_by
		FROM vehicles WHERE UPPER(license_plate) = UPPER($1)
	`, licensePlate).Scan(&v.ID, &v.LicensePlate, &v.Type, &capacityKg, &v.Status, &assignedShipment, &updatedAt, &updatedBy)

	if err == sql.ErrNoRows {
		return model.Vehicle{}, false
	}
	if err != nil {
		return model.Vehicle{}, false
	}

	v.CapacityKg = capacityKg
	if assignedShipment.Valid {
		v.AssignedShipment = &assignedShipment.String
	}
	if updatedAt.Valid {
		v.UpdatedAt = updatedAt.Time
	}
	if updatedBy.Valid {
		v.UpdatedBy = updatedBy.String
	}

	return v, true
}

func (r *postgresVehicleRepository) UpdateStatus(id string, status model.VehicleStatus) error {
	_, err := r.db.Exec(`
		UPDATE vehicles SET status = $1, updated_at = $2 WHERE id = $3
	`, status, time.Now(), id)
	return err
}

func (r *postgresVehicleRepository) UpdateStatusByUser(id string, status model.VehicleStatus, username string) error {
	_, err := r.db.Exec(`
		UPDATE vehicles SET status = $1, updated_at = $2, updated_by = $3 WHERE id = $4
	`, status, time.Now(), username, id)
	return err
}

func (r *postgresVehicleRepository) AssignShipment(id string, trackingID *string) error {
	if trackingID == nil {
		_, err := r.db.Exec(`
			UPDATE vehicles SET assigned_shipment = NULL, updated_at = $1 WHERE id = $2
		`, time.Now(), id)
		return err
	}

	// Check if another vehicle is already assigned to this shipment
	var existingCount int
	err := r.db.QueryRow(`
		SELECT COUNT(*) FROM vehicles WHERE assigned_shipment = $1 AND id != $2
	`, *trackingID, id).Scan(&existingCount)
	if err != nil {
		return err
	}
	if existingCount > 0 {
		return errors.New("shipment already assigned to another vehicle")
	}

	_, err = r.db.Exec(`
		UPDATE vehicles SET assigned_shipment = $1, updated_at = $2 WHERE id = $3
	`, *trackingID, time.Now(), id)
	return err
}
