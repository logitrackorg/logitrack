package model

import "time"

// VehicleStatus represents the current status of a vehicle in the fleet.
type VehicleStatus string

const (
	VehicleStatusAvailable     VehicleStatus = "disponible"
	VehicleStatusInMaintenance VehicleStatus = "mantenimiento"
	VehicleStatusInTransit     VehicleStatus = "en_transito"
	VehicleStatusInactive      VehicleStatus = "inactivo"
)

// VehicleType represents the type of vehicle.
type VehicleType string

const (
	VehicleTypeMotorcycle VehicleType = "motocicleta"
	VehicleTypeVan        VehicleType = "furgoneta"
	VehicleTypeTruck      VehicleType = "camion"
	VehicleTypeLargeTruck VehicleType = "camion_grande"
)

// Vehicle represents a fleet vehicle.
type Vehicle struct {
	ID               string        `json:"id"`
	LicensePlate     string        `json:"license_plate"` // patente
	Type             VehicleType   `json:"type"`          // tipo
	CapacityKg       float64       `json:"capacity_kg"`   // capacidad en kg
	Status           VehicleStatus `json:"status"`
	UpdatedAt        time.Time     `json:"updated_at"`
	UpdatedBy        string        `json:"updated_by,omitempty"`        // usuario que realizó el último cambio de estado
	AssignedShipment *string       `json:"assigned_shipment,omitempty"` // tracking_id del envío asignado (si existe)
}

// CreateVehicleRequest is the request body for creating a new vehicle.
type CreateVehicleRequest struct {
	LicensePlate string      `json:"license_plate" binding:"required"`
	Type         VehicleType `json:"type" binding:"required"`
	CapacityKg   float64     `json:"capacity_kg" binding:"required,gt=0"`
}

// UpdateVehicleStatusRequest is the request body for updating a vehicle's status.
type UpdateVehicleStatusRequest struct {
	Status VehicleStatus `json:"status" binding:"required"`
	Notes  string        `json:"notes,omitempty"`
	Force  bool          `json:"force,omitempty"` // forzar cambio aunque haya transición incompatible
}
