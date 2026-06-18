package repository

import "github.com/logitrack/core/internal/model"

// RegionRepository manages named geographic polygons for the coverage simulator.
type RegionRepository interface {
	List() ([]model.Region, error)
	Create(r model.Region) error
	CountByType(regionType string) (int, error)
	UpdateCoordinatesByName(name string, coords []model.LatLng) error
	// Update renames and/or re-draws a custom region. Predefined regions are
	// not editable; implementations must return sql.ErrNoRows when id does not
	// match an existing custom region.
	Update(id, name string, coords []model.LatLng) error
}
