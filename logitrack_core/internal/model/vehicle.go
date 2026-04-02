package model

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
	ID           string        `json:"id"`
	LicensePlate string        `json:"license_plate"` // patente
	Type         VehicleType   `json:"type"`          // tipo
	CapacityKg   float64       `json:"capacity_kg"`   // capacidad en kg
	Status       VehicleStatus `json:"status"`
}

// CreateVehicleRequest is the request body for creating a new vehicle.
type CreateVehicleRequest struct {
	LicensePlate string      `json:"license_plate" binding:"required"`
	Type         VehicleType `json:"type" binding:"required"`
	CapacityKg   float64     `json:"capacity_kg" binding:"required,gt=0"`
}
