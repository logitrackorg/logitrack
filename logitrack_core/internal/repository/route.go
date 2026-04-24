package repository

import "github.com/logitrack/core/internal/model"

type RouteRepository interface {
	Create(route model.Route) (model.Route, error)
	Update(route model.Route) error
	GetByDriverAndDate(driverID string, date model.DateOnly) (model.Route, error)
	GetByID(id string) (model.Route, error)
	RemoveShipmentFromDate(trackingID string, date model.DateOnly) error
}
