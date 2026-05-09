package repository

import "github.com/logitrack/core/internal/model"

type ZoneRepository interface {
	List(includeInactive bool) ([]model.Zone, error)
	GetByID(id string) (model.Zone, error)
	Create(zone model.Zone) error
	Update(id string, zone model.Zone) error
	Delete(id string) error
	ListActive() ([]model.Zone, error)
}
