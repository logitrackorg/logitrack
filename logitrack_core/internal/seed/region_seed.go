package seed

import (
	"log"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// predefinedRegions are the authoritative polygon coordinates for each named
// predefined zone. On every restart, existing records are updated in-place so
// coordinate improvements are applied without manual DB intervention.
var predefinedRegions = []model.Region{
	{
		Name: "CABA",
		Type: model.RegionTypePredefined,
		Coordinates: []model.LatLng{
			{Lat: -34.533, Lng: -58.466},
			{Lat: -34.580, Lng: -58.375},
			{Lat: -34.634, Lng: -58.351},
			{Lat: -34.661, Lng: -58.428},
			{Lat: -34.683, Lng: -58.480},
			{Lat: -34.650, Lng: -58.530},
			{Lat: -34.538, Lng: -58.485},
		},
	},
	{
		Name: "AMBA",
		Type: model.RegionTypePredefined,
		Coordinates: []model.LatLng{
			{Lat: -34.330, Lng: -58.550},
			{Lat: -34.450, Lng: -58.350},
			{Lat: -34.650, Lng: -58.150},
			{Lat: -34.850, Lng: -58.150},
			{Lat: -34.900, Lng: -58.500},
			{Lat: -34.800, Lng: -58.850},
			{Lat: -34.450, Lng: -58.850},
		},
	},
	{
		Name: "Provincia de Buenos Aires",
		Type: model.RegionTypePredefined,
		Coordinates: []model.LatLng{
			{Lat: -33.333, Lng: -60.250},
			{Lat: -34.500, Lng: -58.000},
			{Lat: -36.300, Lng: -56.700},
			{Lat: -38.000, Lng: -57.500},
			{Lat: -39.000, Lng: -61.000},
			{Lat: -41.000, Lng: -62.800},
			{Lat: -40.000, Lng: -63.400},
			{Lat: -36.000, Lng: -63.400},
			{Lat: -33.800, Lng: -61.000},
		},
	},
}

// LoadRegions seeds predefined geographic zones on first run, then updates
// their coordinates on every subsequent restart so polygon improvements are
// applied automatically without manual DB intervention.
func LoadRegions(repo repository.RegionRepository) {
	count, err := repo.CountByType(string(model.RegionTypePredefined))
	if err != nil {
		log.Printf("[seed] error contando regiones predefinidas: %v", err)
		return
	}

	if count == 0 {
		// First run: insert all regions with fresh UUIDs.
		for _, r := range predefinedRegions {
			r.ID = uuid.New().String()
			if err := repo.Create(r); err != nil {
				log.Printf("[seed] error insertando región %q: %v", r.Name, err)
			}
		}
		return
	}

	// Subsequent runs: update coordinates in-place so improved polygons are
	// applied without dropping and re-inserting user-created regions.
	for _, r := range predefinedRegions {
		if err := repo.UpdateCoordinatesByName(r.Name, r.Coordinates); err != nil {
			log.Printf("[seed] error actualizando coordenadas de región %q: %v", r.Name, err)
		}
	}
}
