package model

import "time"

// VehicleStatus represents the current status of a vehicle in the fleet.
type VehicleStatus string

const (
	VehicleStatusAvailable     VehicleStatus = "disponible"
	VehicleStatusLoading       VehicleStatus = "en_carga"
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
	ID                string        `json:"id"`
	LicensePlate      string        `json:"license_plate"` // patente
	Type              VehicleType   `json:"type"`          // tipo
	CapacityKg        float64       `json:"capacity_kg"`   // capacidad en kg
	Status            VehicleStatus `json:"status"`
	UpdatedAt         time.Time     `json:"updated_at"`
	UpdatedBy         string        `json:"updated_by,omitempty"`         // usuario que realizó el último cambio de estado
	AssignedShipments []string      `json:"assigned_shipments,omitempty"` // tracking_ids de los envíos asignados
	AssignedBranch    *string       `json:"assigned_branch,omitempty"`    // branch_id asignado (branch actual)
	DestinationBranch *string       `json:"destination_branch,omitempty"` // branch_id de destino (si existe)
}

// CreateVehicleRequest is the request body for creating a new vehicle.
type CreateVehicleRequest struct {
	LicensePlate string      `json:"license_plate" binding:"required"`
	Type         VehicleType `json:"type" binding:"required"`
	CapacityKg   float64     `json:"capacity_kg" binding:"required,gt=0"`
	BranchID     string      `json:"branch_id" binding:"required"`
}

// UpdateVehicleStatusRequest is the request body for updating a vehicle's status.
type UpdateVehicleStatusRequest struct {
	Status VehicleStatus `json:"status" binding:"required"`
	Notes  string        `json:"notes,omitempty"`
	Force  bool          `json:"force,omitempty"` // forzar cambio aunque haya transición incompatible
}

// StartTripRequest is the request body for starting a trip.
type StartTripRequest struct {
	DestinationBranch string `json:"destination_branch" binding:"required"`
}
