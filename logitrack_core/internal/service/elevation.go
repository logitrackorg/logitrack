package service

// terrainFriction returns the logistic friction factor (≥ 1.0) and a
// human-readable terrain-type label for a coordinate in Argentina.
//
// The factor is used as a divisor in the density-mode scoring formula:
//
//	FinalScore = (BaseDensity × IndustrialMultiplier) / TerrainFriction
//
// A higher factor means more difficult terrain → lower final score → candidate
// ranks behind an equally-populated city on flatter ground.
//
// The classification is based on Argentina's major geographic units:
//   - Cordillera de los Andes (lng < -68°): very mountainous.
//   - Pre-cordillera / Sierras (lng < -66.5°): hilly.
//   - Cuyo semi-montane valleys: moderate.
//   - Patagonian steppe (lat < -38°): flat but remote and wind-exposed.
//   - Pampas / Mesopotamia / NEA: flat, minimal friction.
//
// This is a coordinate-based heuristic — no network call, no rate limit.
// It can be replaced with a real elevation API (OpenTopoData, Open-Elevation)
// when higher spatial accuracy is needed.
func terrainFriction(lat, lng float64) (friction float64, terrainType string) {
	switch {
	// Andes proper — west of ~-68°W (includes the Chilean border strip).
	case lng < -68.0:
		return 1.5, "Montañoso"

	// Pre-cordillera / northern Sierras (-68° to -66.5°W).
	case lng < -66.5:
		if lat > -40.0 {
			return 1.3, "Serrano" // NOA / Cuyo foothills
		}
		return 1.5, "Montañoso" // Patagonian Andes

	// Cuyo: semi-montane valleys between the Andes and the Pampas.
	case lat > -37.0 && lat < -28.0 && lng < -65.0:
		return 1.25, "Semi-montañoso"

	// Patagonian steppe south of ~-38°S: flat but remote and often windy.
	case lat < -38.0:
		return 1.1, "Llano-Ventoso"

	// Default: Pampas, Mesopotamia, NEA, GBA — flat terrain.
	default:
		return 1.0, "Llano"
	}
}
