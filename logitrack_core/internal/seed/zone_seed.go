package seed

import (
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// LoadZones inserta zonas peligrosas de ejemplo en el conurbano de Buenos Aires.
// Es idempotente: si ya hay zonas en la base no hace nada (no resetea cambios manuales).
func LoadZones(repo repository.ZoneRepository) {
	existing, err := repo.List(true)
	if err != nil || len(existing) > 0 {
		return
	}

	now := time.Now()
	zones := []model.Zone{
		{
			ID:          uuid.New().String(),
			Name:        "La Matanza - Virrey del Pino",
			Description: "Reportes frecuentes de robos a repartidores. Evitar circular fuera de avenidas principales después de las 18hs.",
			Polygon: []model.ZonePoint{
				{Lat: -34.795, Lng: -58.710},
				{Lat: -34.795, Lng: -58.660},
				{Lat: -34.835, Lng: -58.660},
				{Lat: -34.835, Lng: -58.710},
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:          uuid.New().String(),
			Name:        "José L. Suárez (San Martín)",
			Description: "Zona con alta concentración de incidentes durante la última milla. Precaución en accesos.",
			Polygon: []model.ZonePoint{
				{Lat: -34.520, Lng: -58.580},
				{Lat: -34.520, Lng: -58.540},
				{Lat: -34.550, Lng: -58.540},
				{Lat: -34.550, Lng: -58.580},
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:          uuid.New().String(),
			Name:        "Quilmes Oeste / Bernal",
			Description: "Reportes de hurtos durante reparto. Recomendado estacionar en lugares visibles.",
			Polygon: []model.ZonePoint{
				{Lat: -34.745, Lng: -58.290},
				{Lat: -34.745, Lng: -58.250},
				{Lat: -34.775, Lng: -58.250},
				{Lat: -34.775, Lng: -58.290},
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:          uuid.New().String(),
			Name:        "Obelisco / Av. Corrientes",
			Description: "Tramo de alta congestión con reportes de hurtos a repartidores en moto. Precaución al circular por Av. Corrientes y 9 de Julio. Evitar detenciones en doble fila.",
			Polygon: []model.ZonePoint{
				{Lat: -34.603, Lng: -58.383},
				{Lat: -34.603, Lng: -58.378},
				{Lat: -34.598, Lng: -58.378},
				{Lat: -34.598, Lng: -58.383},
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
	}

	for _, z := range zones {
		_ = repo.Create(z)
	}
}
