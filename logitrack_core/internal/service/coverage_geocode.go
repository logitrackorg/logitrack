package service

import (
	"log"
	"math"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

// "Snap to City": geometric coverage-gap points (suggested branch locations
// derived from Voronoi/circle geometry, Diagnose) often land in empty terrain
// — the middle of a field, a mountain range, etc. SnapToCities resolves such
// points to the nearest real Argentine locality using the embedded INDEC/Georef
// dataset (geo.Localities), so suggestions are logistically viable.
//
// This is a pure in-memory lookup: no Overpass/Nominatim call, no API key, no
// timeouts, no rate-limiting, no chunking, no cache. The dataset is the single
// source of truth (official 2022 census population + Georef coordinates), so the
// previous OSM machinery (Overpass query, Patagonia fallback, grid cache) is
// gone.
const (
	// snapToCityMaxRadiusKm caps the search radius used when auto-snapping
	// mathematical suggestions, keeping the chosen city inside the uncovered
	// zone's neighbourhood rather than a distant megacity.
	snapToCityMaxRadiusKm = 150.0
)

// isBlacklisted reports whether name appears in the given list (exact match).
func isBlacklisted(name string, list []string) bool {
	for _, b := range list {
		if b == name {
			return true
		}
	}
	return false
}

// bestLocality returns the most populous Argentine locality within radiusKm of
// (originLat, originLng) that passes the minPopulation, blacklist and
// dangerous-zone filters. Ties are broken by proximity. Returns (_, false) when
// no locality qualifies. Every locality in the dataset is on Argentine soil by
// construction, so no point-in-country check is needed.
func bestLocality(originLat, originLng, radiusKm float64, minPopulation int, blacklistedCities []string, dangerousZones [][]model.LatLng) (geo.Locality, bool) {
	var best geo.Locality
	bestPop := -1
	var bestDist float64
	found := false

	for _, loc := range geo.Localities() {
		dist := ml.HaversineKm(originLat, originLng, loc.Lat, loc.Lng)
		if dist > radiusKm {
			continue
		}
		if minPopulation > 0 && loc.Poblacion < minPopulation {
			continue
		}
		if isBlacklisted(loc.Nombre, blacklistedCities) {
			continue
		}
		if isInAnyDangerousZone(loc.Lat, loc.Lng, dangerousZones) {
			continue
		}
		if !found || loc.Poblacion > bestPop || (loc.Poblacion == bestPop && dist < bestDist) {
			best = loc
			bestPop = loc.Poblacion
			bestDist = dist
			found = true
		}
	}
	return best, found
}

// SnapToCities resolves a batch of geometric coverage-gap points (lat/lng) to
// the best real Argentine locality within radiusKm of each — typically the
// suggested branches' simulated coverage radius.
//
// minPopulation filters out localities whose 2022 census population is strictly
// below the threshold. 0 disables the filter.
//
// blacklistedCities is an optional list of city names to exclude from selection
// (already-discarded suggestions from a previous call). Nil/empty disables it.
//
// Results preserve input order. A point with no locality within radiusKm gets
// Snapped=false with ErrorReason="NO_RESULTS". There is no TIMEOUT case anymore
// (the lookup is local and cannot fail).
func (s *CoverageService) SnapToCities(points []model.LatLng, radiusKm float64, minPopulation int, blacklistedCities []string) []model.SnappedCity {
	results := make([]model.SnappedCity, len(points))
	if len(points) == 0 {
		return results
	}
	searchRadiusKm := radiusKm
	if searchRadiusKm <= 0 {
		searchRadiusKm = snapToCityMaxRadiusKm
	}

	for i, p := range points {
		if city, ok := bestLocality(p.Lat, p.Lng, searchRadiusKm, minPopulation, blacklistedCities, nil); ok {
			results[i] = model.SnappedCity{
				LatLng:     model.LatLng{Lat: city.Lat, Lng: city.Lng},
				CityName:   city.Nombre,
				Snapped:    true,
				Population: city.Poblacion,
			}
		} else {
			results[i] = model.SnappedCity{
				LatLng:      model.LatLng{Lat: p.Lat, Lng: p.Lng},
				ErrorReason: "NO_RESULTS",
			}
		}
	}
	return results
}

// latLngInPolygon reports whether (lat, lng) lies inside polygon using the
// ray-casting algorithm. Winding order does not matter; open and closed rings
// are both handled correctly.
func latLngInPolygon(lat, lng float64, polygon []model.LatLng) bool {
	n := len(polygon)
	inside := false
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		yi, xi := polygon[i].Lat, polygon[i].Lng
		yj, xj := polygon[j].Lat, polygon[j].Lng
		if ((yi > lat) != (yj > lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi) {
			inside = !inside
		}
	}
	return inside
}

// isInAnyDangerousZone reports whether (lat, lng) falls inside any of the
// given exclusion polygons. Returns false when zones is nil or empty.
func isInAnyDangerousZone(lat, lng float64, zones [][]model.LatLng) bool {
	for _, zone := range zones {
		if len(zone) >= 3 && latLngInPolygon(lat, lng, zone) {
			return true
		}
	}
	return false
}

// detectIndustrialZones reports, for each snapped candidate, whether an official
// IGN industrial zone ("área de fabricación y procesamiento") lies within 10 km.
// Unsnapped entries are always false.
//
// Backed by the embedded IGN dataset (geo.IndustrialZoneNear), so the check is a
// pure in-memory spatial query: no Overpass call, no timeout, no fail-open
// degradation. Replaces the previous OSM "landuse=industrial" lookup with an
// official, Argentina-focused source.
func (s *CoverageService) detectIndustrialZones(candidates []model.SuggestedLocation) []bool {
	const industrialRadiusKm = 10.0
	result := make([]bool, len(candidates))
	matched := 0
	for i, c := range candidates {
		if !c.IsSnapped {
			continue
		}
		if geo.IndustrialZoneNear(c.Lat, c.Lng, industrialRadiusKm) {
			result[i] = true
			matched++
		}
	}
	log.Printf("[IndustrialZone] %d/%d candidates near an IGN industrial zone", matched, len(candidates))
	return result
}

// CalculateViabilityScore returns a Logistics Viability Index in the range
// [1, 100] that combines several independent signals into a single score:
//
//	Population / Density   40 pts  (20 each, log10 / linear normalised)
//	Net useful area        35 pts  (log10 normalised, 300 000 km² ceiling)
//	Industrial zone bonus  15 pts  (flat bonus when hasIndustry) — only when
//	                               prioritizeIndustrial is set
//	Terrain friction        ÷ f    (1.0 – 1.5; divides the sub-total)
//
// The industrial slot participates in the score only when prioritizeIndustrial
// is true: otherwise it's dropped from both the bonus and the denominator, so
// the score is normalised over the three always-present signals (population,
// density, area) instead of silently penalising every candidate by 15/90 for
// lacking a feature the user didn't ask to weigh. The raw sub-total (max 90 with
// industrial, 75 without) is then rescaled to 1–100.
//
// This is a pure function with no side-effects and no network calls; terrain
// friction is passed in by the caller (computed via terrainFriction, which is
// also a pure coordinate-based heuristic).
func CalculateViabilityScore(population int, density, usefulAreaKm2 float64, hasIndustry, prioritizeIndustrial bool, friction float64) int {
	if friction < 1.0 {
		friction = 1.0
	}

	// Population (0–20): log₁₀ scale, Buenos Aires metro (~3M) as ceiling.
	var popScore float64
	if population > 0 {
		popScore = math.Log10(float64(population)) / math.Log10(3_000_000) * 20
		if popScore > 20 {
			popScore = 20
		}
	}

	// Density (0–20): linear scale, 300 hab./km² as practical ceiling for
	// Argentine secondary cities (GBA suburbs reach this value; larger values
	// are capped so urban giants don't dominate the ranking alone).
	var densityScore float64
	if density > 0 {
		densityScore = density / 300.0 * 20
		if densityScore > 20 {
			densityScore = 20
		}
	}

	// Net useful coverage area (0–35): log₁₀ scale.
	// 300 000 km² ≈ the area of the Pampas region — a reasonable ceiling for
	// a single branch's net contribution across the full national scope.
	var areaScore float64
	if usefulAreaKm2 > 0 {
		areaScore = math.Log10(usefulAreaKm2+1) / math.Log10(300_001) * 35
		if areaScore > 35 {
			areaScore = 35
		}
	}

	// Industrial zone bonus (0 or 15): logistics hubs near industrial areas
	// are strategically preferable; the bonus lifts them above residential
	// cities with identical population/density figures. Only counts when the
	// user enabled industrial prioritisation — otherwise it's excluded from
	// both the bonus and the denominator below.
	maxRaw := 75.0 // population (20) + density (20) + area (35)
	var industryBonus float64
	if prioritizeIndustrial {
		maxRaw += 15
		if hasIndustry {
			industryBonus = 15
		}
	}

	// Combine and apply terrain penalty, then normalise to 1–100 over the
	// active maximum (90 with industrial, 75 without).
	raw := (popScore + densityScore + areaScore + industryBonus) / friction
	normalized := raw * (100.0 / maxRaw)
	return int(math.Min(100, math.Max(1, math.Round(normalized))))
}

// snapMathSuggestionsInPlace auto-snaps each mathematical suggestion to the
// nearest viable Argentine locality within math.Min(radiusKm/2,
// snapToCityMaxRadiusKm), using the embedded dataset. Cities inside any
// dangerous zone, below minPopulation, or in blacklistedCities are excluded.
//
// Snapped entries get their coordinates updated to the city's real lat/lng and
// have CityName / Population / IsSnapped set. Unsnapped entries keep their
// original mathematical coordinates with IsSnapped=false.
//
// The returned slice mirrors suggestions in order and carries the raw
// SnappedCity result for each entry, allowing callers to inspect ErrorReason.
func (s *CoverageService) snapMathSuggestionsInPlace(suggestions []model.SuggestedLocation, radiusKm float64, minPopulation int, dangerousZones [][]model.LatLng, blacklistedCities []string) []model.SnappedCity {
	out := make([]model.SnappedCity, len(suggestions))
	if len(suggestions) == 0 || radiusKm <= 0 {
		return out
	}
	searchRadius := math.Min(radiusKm/2, snapToCityMaxRadiusKm)

	for i := range suggestions {
		p := suggestions[i].LatLng
		city, ok := bestLocality(p.Lat, p.Lng, searchRadius, minPopulation, blacklistedCities, dangerousZones)
		if !ok {
			out[i] = model.SnappedCity{LatLng: p, ErrorReason: "NO_RESULTS"}
			log.Printf("[MathSugg] snap[%d]: not snapped (%.4f, %.4f)", i, p.Lat, p.Lng)
			continue
		}
		out[i] = model.SnappedCity{
			LatLng:     model.LatLng{Lat: city.Lat, Lng: city.Lng},
			CityName:   city.Nombre,
			Snapped:    true,
			Population: city.Poblacion,
		}
		suggestions[i].LatLng = out[i].LatLng
		suggestions[i].CityName = city.Nombre
		suggestions[i].IsSnapped = true
		suggestions[i].Population = city.Poblacion
		log.Printf("[MathSugg] snap[%d]: → %s (%.4f, %.4f) pop=%d",
			i, city.Nombre, city.Lat, city.Lng, city.Poblacion)
	}
	return out
}
