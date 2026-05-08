package repository

import (
	"errors"

	"github.com/logitrack/core/internal/model"
)

var ErrDuplicateLicensePlate = errors.New("vehicle with this license plate already exists")

type VehicleRepository interface {
	List() []model.Vehicle
	Add(vehicle model.Vehicle) error
	GetByID(id string) (model.Vehicle, bool)
	GetByLicensePlate(licensePlate string) (model.Vehicle, bool)
	UpdateStatus(id string, status model.VehicleStatus) error
	UpdateStatusByUser(id string, status model.VehicleStatus, username string) error
	// AddShipment appends a tracking ID to the vehicle's assigned shipments list.
	AddShipment(id string, trackingID string) error
	// RemoveShipment removes a tracking ID from the vehicle's assigned shipments list.
	RemoveShipment(id string, trackingID string) error
	// ClearShipments clears all assigned shipments from a vehicle.
	ClearShipments(id string) error
	AssignBranch(id string, branchID *string) error
	SetDestinationBranch(id string, branchID *string) error
	UpdateLocation(id string, lat, lng float64) error
}
