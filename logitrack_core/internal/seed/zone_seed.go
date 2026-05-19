package seed

import (
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// LoadZones inserta zonas peligrosas de ejemplo. Es idempotente por nombre:
// agrega solo las zonas del slice que aún no existen en la base (compara por
// Name). Así las nuevas zonas se suman automáticamente al reiniciar el servidor
// sin necesidad de borrar las existentes.
func LoadZones(repo repository.ZoneRepository) {
	existing, err := repo.List(true)
	if err != nil {
		return
	}
	existingByName := make(map[string]bool, len(existing))
	for _, z := range existing {
		existingByName[z.Name] = true
	}

	now := time.Now()
	zones := []model.Zone{
		// ─────────────────────────────────────────────────────────────────────
		// CABA — zona diseñada para demostrar el modo "Segura" vs "Ventanas".
		//
		// Geometría: corredor E-O entre el branch (Once / Balvanera, lat≈-34.603)
		// y las 4 entregas de última milla ubicadas en Palermo / Recoleta / Belgrano
		// (lat entre -34.560 y -34.589). Cuando el VRP traza la ruta más corta desde
		// el branch hacia esos destinos, la línea recta cruza esta zona.
		//
		// Con penalty 2.5x (modo Segura), el algoritmo agrupa primero las 2 entregas
		// del SUR que no cruzan la zona (Congreso y Caballito) y luego cruza al
		// cluster norte UNA sola vez — en lugar de zigzaguear a través de la zona
		// como lo haría el modo Ventanas.
		//
		// Zona cubre: Av. Córdoba (sur, lat≈-34.598) → Av. del Libertador (norte,
		// lat≈-34.592), y desde Av. Medrano/Humboldt (oeste, lng≈-58.420) hasta
		// Av. Pueyrredón / Callao (este, lng≈-58.376).
		// ─────────────────────────────────────────────────────────────────────
		{
			ID:          uuid.New().String(),
			Name:        "Palermo / Recoleta - Corredor de Riesgo",
			Description: "Corredor entre Av. Córdoba y Av. del Libertador con alta incidencia de hurtos a repartidores en moto. El modo Segura evita cruzarlo y agrupa las entregas del norte en un único ingreso/salida por las avenidas periféricas.",
			Polygon: []model.ZonePoint{
				{Lat: -34.592, Lng: -58.420}, // NO
				{Lat: -34.592, Lng: -58.376}, // NE
				{Lat: -34.598, Lng: -58.376}, // SE
				{Lat: -34.598, Lng: -58.420}, // SO
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
		// Zona que bloquea el camino directo de la sucursal hacia Caballito/Flores.
		// Obliga al modo Segura a tomar Av. Rivadavia en lugar del trayecto recto
		// por Almagro hacia Av. La Plata.
		{
			ID:          uuid.New().String(),
			Name:        "Almagro Sur / Boedo - Corredor de Riesgo",
			Description: "Zona entre la sucursal y los barrios del oeste (Caballito, Flores). Reportes de motochorros sobre Av. La Plata y arterias secundarias. El modo Segura desvía la salida por Av. Rivadavia.",
			Polygon: []model.ZonePoint{
				{Lat: -34.605, Lng: -58.430}, // NO
				{Lat: -34.605, Lng: -58.408}, // NE
				{Lat: -34.615, Lng: -58.408}, // SE
				{Lat: -34.615, Lng: -58.430}, // SO
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
		// Zona que obliga a llegar a Belgrano por Av. Cabildo en vez de Av. Luis
		// María Campos / Av. Libertador (que pasa por una zona de riesgo).
		// Afecta sólo el tramo Palermo-Belgrano, no el ingreso desde la sucursal.
		{
			ID:          uuid.New().String(),
			Name:        "Palermo Norte / Las Cañitas - Corredor de Riesgo",
			Description: "Tramo entre Palermo y Belgrano R con reportes de hurtos a repartidores en horarios de baja circulación. El modo Segura conecta Palermo → Belgrano por Av. Cabildo evitando los cortes internos.",
			Polygon: []model.ZonePoint{
				{Lat: -34.572, Lng: -58.460}, // NO
				{Lat: -34.572, Lng: -58.425}, // NE
				{Lat: -34.585, Lng: -58.425}, // SE
				{Lat: -34.585, Lng: -58.460}, // SO
			},
			Active:    true,
			CreatedBy: "seed",
			CreatedAt: now,
			UpdatedAt: now,
		},
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
	}

	for _, z := range zones {
		if existingByName[z.Name] {
			continue
		}
		_ = repo.Create(z)
	}
}
