package geo

import (
	"math"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

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

// NearestBranch returns the ID of the active branch closest to (lat, lng).
// Branches without coordinates use GeocodeBranch as fallback.
// Returns "" if no branch can be resolved.
func NearestBranch(lat, lng float64, branches []model.Branch) string {
	bestID := ""
	bestDist := math.MaxFloat64

	for _, b := range branches {
		if b.Status != model.BranchStatusActive {
			continue
		}
		bLat, bLng := 0.0, 0.0
		if b.Latitude != nil && b.Longitude != nil {
			bLat, bLng = *b.Latitude, *b.Longitude
		} else {
			var ok bool
			if bLat, bLng, ok = LookupCity(b.Address.City); !ok {
				if coords, found := ml.ProvinceCoords[b.Province]; found {
					bLat, bLng = coords[0], coords[1]
				} else {
					continue
				}
			}
		}
		d := haversine(lat, lng, bLat, bLng)
		if d < bestDist {
			bestDist = d
			bestID = b.ID
		}
	}
	return bestID
}

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
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
