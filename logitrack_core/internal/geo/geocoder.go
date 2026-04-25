package geo

import "github.com/logitrack/core/internal/ml"

const (
	ConfidenceStreet   = "street"
	ConfidenceCity     = "city"
	ConfidenceProvince = "province"
	ConfidenceManual   = "manual"
)

// GeocodeBranch resolves coordinates for a branch address.
// Tries: city map → province centroid.
// Does NOT call Nominatim (branches are always in known cities).
func GeocodeBranch(city, province string) (lat, lng float64, confidence string) {
	if lat, lng, ok := LookupCity(city); ok {
		return lat, lng, ConfidenceCity
	}
	if coords, ok := ml.ProvinceCoords[province]; ok {
		return coords[0], coords[1], ConfidenceProvince
	}
	return 0, 0, ""
}

// GeocodeShipmentAddress resolves coordinates for a sender/recipient address.
// Tries: Nominatim (street-level) → city map → province centroid.
func GeocodeShipmentAddress(street, city, province string) (lat, lng float64, confidence string) {
	if street != "" {
		if lat, lng, ok := GeocodeAddress(street, city, province); ok {
			return lat, lng, ConfidenceStreet
		}
	}
	if lat, lng, ok := LookupCity(city); ok {
		return lat, lng, ConfidenceCity
	}
	if coords, ok := ml.ProvinceCoords[province]; ok {
		return coords[0], coords[1], ConfidenceProvince
	}
	return 0, 0, ""
}
