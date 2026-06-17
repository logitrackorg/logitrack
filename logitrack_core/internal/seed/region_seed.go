package seed

import (
	"log"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// LoadRegions seeds the three predefined geographic zones (CABA, AMBA, PBA)
// if no predefined regions exist yet. Safe to call on every restart.
func LoadRegions(repo repository.RegionRepository) {
	count, err := repo.CountByType(string(model.RegionTypePredefined))
	if err != nil {
		log.Printf("[seed] error contando regiones predefinidas: %v", err)
		return
	}
	if count > 0 {
		return // already seeded
	}

	predefined := []model.Region{
		{
			ID:   uuid.New().String(),
			Name: "CABA",
			Type: model.RegionTypePredefined,
			// Ciudad Autónoma de Buenos Aires — polígono aproximado rectangular.
			Coordinates: []model.LatLng{
				{Lat: -34.527, Lng: -58.531}, // NO
				{Lat: -34.527, Lng: -58.338}, // NE (costa)
				{Lat: -34.706, Lng: -58.338}, // SE (costa)
				{Lat: -34.706, Lng: -58.531}, // SO
			},
		},
		{
			ID:   uuid.New().String(),
			Name: "AMBA",
			Type: model.RegionTypePredefined,
			// Área Metropolitana de Buenos Aires — incluye CABA + GBA primer y segundo cordón.
			Coordinates: []model.LatLng{
				{Lat: -34.22, Lng: -59.05}, // NO
				{Lat: -34.22, Lng: -57.90}, // NE
				{Lat: -35.20, Lng: -57.90}, // SE
				{Lat: -35.20, Lng: -59.05}, // SO
			},
		},
		{
			ID:   uuid.New().String(),
			Name: "Provincia de Buenos Aires",
			Type: model.RegionTypePredefined,
			// Provincia de Buenos Aires — rectángulo aproximado.
			Coordinates: []model.LatLng{
				{Lat: -33.26, Lng: -63.50}, // NO
				{Lat: -33.26, Lng: -56.50}, // NE
				{Lat: -41.50, Lng: -56.50}, // SE
				{Lat: -41.50, Lng: -63.50}, // SO
			},
		},
	}

	for _, r := range predefined {
		if err := repo.Create(r); err != nil {
			log.Printf("[seed] error insertando región %q: %v", r.Name, err)
		}
	}
}
