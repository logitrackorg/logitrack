package repository

import (
	"errors"
	"sync"

	"github.com/logitrack/core/internal/model"
)

var ErrDuplicateLicensePlate = errors.New("vehicle with this license plate already exists")

type VehicleRepository interface {
	List() []model.Vehicle
	Add(vehicle model.Vehicle) error
	GetByID(id string) (model.Vehicle, bool)
	GetByLicensePlate(licensePlate string) (model.Vehicle, bool)
	UpdateStatus(id string, status model.VehicleStatus) error
}

type inMemoryVehicleRepository struct {
	mu       sync.RWMutex
	vehicles []model.Vehicle
	nextID   int
}

func NewInMemoryVehicleRepository() VehicleRepository {
	return &inMemoryVehicleRepository{nextID: 1}
}

func (r *inMemoryVehicleRepository) List() []model.Vehicle {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]model.Vehicle, len(r.vehicles))
	copy(result, r.vehicles)
	return result
}

func (r *inMemoryVehicleRepository) Add(vehicle model.Vehicle) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check for duplicate license plate
	for _, v := range r.vehicles {
		if v.LicensePlate == vehicle.LicensePlate {
			return ErrDuplicateLicensePlate
		}
	}

	vehicle.ID = string(r.nextID)
	r.nextID++
	r.vehicles = append(r.vehicles, vehicle)
	return nil
}

func (r *inMemoryVehicleRepository) GetByID(id string) (model.Vehicle, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, v := range r.vehicles {
		if v.ID == id {
			return v, true
		}
	}
	return model.Vehicle{}, false
}

func (r *inMemoryVehicleRepository) GetByLicensePlate(licensePlate string) (model.Vehicle, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, v := range r.vehicles {
		if v.LicensePlate == licensePlate {
			return v, true
		}
	}
	return model.Vehicle{}, false
}

func (r *inMemoryVehicleRepository) UpdateStatus(id string, status model.VehicleStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, v := range r.vehicles {
		if v.ID == id {
			r.vehicles[i].Status = status
			return nil
		}
	}
	return errors.New("vehicle not found")
}
