package service

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/planar"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

// "Snap to City": geometric coverage-gap points (suggested branch locations
// derived from Voronoi/circle geometry, Diagnose) often land in empty terrain
// — the middle of a field, a mountain range, etc. SnapToCities resolves such
// points to the nearest real populated place via the OpenStreetMap Overpass
// API (no API key required, no local city database to maintain), so
// suggestions are logistically viable.
const (
	overpassAPIURL = "https://overpass-api.de/api/interpreter"

	// snapToCityMaxRadiusKm is the hard cap applied to the Overpass "around"
	// radius. Overpass query cost grows with the search area (~R²): beyond
	// 150km the public endpoint times out consistently for points in southern
	// Argentina (sparse OSM coverage, server load). Larger caller-supplied radii
	// (e.g. the simulator's 400km+) are still honoured for the local fallback
	// lookup — only the HTTP query to Overpass is capped here.
	snapToCityMaxRadiusKm = 150.0

	// snapToCityResultsPerPoint caps how many candidate places Overpass
	// returns per input point — plenty to find a good match within the radius
	// without an oversized response.
	snapToCityResultsPerPoint = 30

	// snapToCityMaxTotalResults bounds the combined `out body` limit
	// regardless of how many points are in a chunk.
	snapToCityMaxTotalResults = 150

	// snapToCityChunkSize bounds how many points are unioned into a single
	// Overpass request. The simulator can suggest 10-16 widely scattered
	// points; unioning all of them (even at a moderate radius) into one
	// request pushes its aggregate cost over Overpass's rate limit (429).
	// Smaller chunks keep each request's cost within a range that succeeds
	// reliably.
	snapToCityChunkSize = 5

	// snapToCityChunkDelay paces sequential chunk requests so consecutive
	// queries don't trigger Overpass's burst rate limit.
	snapToCityChunkDelay = 1500 * time.Millisecond

	// snapToCityHTTPTimeout is the Go HTTP client deadline for a single
	// Overpass request. It exceeds the Overpass-side [timeout:13] by ~2s to
	// allow the server to return a clean timeout error before the client cuts
	// the connection. Kept short (15s) so a slow/overloaded Overpass server
	// does not stall the whole SnapToCities call indefinitely.
	snapToCityHTTPTimeout = 15 * time.Second
)

// overpassCenter holds the centroid returned by Overpass `out center` for
// way and relation elements. Nodes carry their coordinates at the top level
// (Lat/Lon); ways and relations carry them here instead.
type overpassCenter struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// overpassElement is a single OSM element from an Overpass `out center`
// response (node, way, or relation). After decoding, callers must normalize
// coordinates: use Center when non-zero (way/relation), otherwise use Lat/Lon
// (node). See snapChunk for the normalization step.
type overpassElement struct {
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center overpassCenter    `json:"center"`
	Tags   map[string]string `json:"tags"`
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

// cachedCityResult holds the outcome of a previous city-snap lookup for a
// geographic area. found=false means Overpass found no viable city (cache
// negative). The cache prevents repeated Overpass calls for the same areas
// across "Buscar más" rounds and provides city names for rejection reasons.
type cachedCityResult struct {
	found      bool
	Name       string
	Lat, Lng   float64
	Population int
}

// cityCacheKey maps a geometric PoI to a ~55 km grid cell (0.5° rounded) so
// that nearby PoIs within the same area share a cache entry.
func cityCacheKey(lat, lng float64) string {
	r := func(v float64) float64 { return math.Round(v*2) / 2 }
	return fmt.Sprintf("%.1f,%.1f", r(lat), r(lng))
}

var (
	cityCacheMu  sync.RWMutex
	cityCachePts = make(map[string]cachedCityResult)
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

// snapPopulationFallback is the assumed population for an OSM element that
// lacks a "population" tag. Used by candidatePopulation as a scoring proxy
// and by bestSnapCandidate's minPopulation filter.
var snapPopulationFallback = map[string]int{
	"city": 100_000,
	"town": 10_000,
}

// fallbackCity is a hardcoded record for the local Patagonia fallback dataset.
type fallbackCity struct {
	Name       string
	Lat, Lng   float64
	Population int
}

// patagoniaFallback is a curated list of the major cities in southern and
// central Argentina used as a local safety net when the Overpass API fails
// (timeout, rate-limit) or returns no usable results. It covers the full arc
// from Neuquén to Ushuaia, the area where Overpass has the highest timeout
// rate for large search radii.
//
// Populations are approximate census figures; they are used only for ranking
// within the fallback list and for the minPopulation filter, not surfaced as
// authoritative data.
var patagoniaFallback = []fallbackCity{
	{"Neuquén", -38.9516, -68.0591, 230_000},
	{"Comodoro Rivadavia", -45.8641, -67.4965, 200_000},
	{"San Carlos de Bariloche", -41.1334, -71.3102, 135_000},
	{"Río Gallegos", -51.6226, -69.2181, 110_000},
	{"Trelew", -43.2533, -65.3094, 100_000},
	{"Viedma", -40.8134, -62.9966, 80_000},
	{"Ushuaia", -54.8019, -68.3029, 75_000},
	{"Puerto Madryn", -42.7692, -65.0385, 100_000},
	{"Cipolletti", -38.9338, -67.9909, 110_000},
	{"Zapala", -38.8989, -70.0653, 40_000},
	{"Esquel", -42.9100, -71.3178, 35_000},
	{"Caleta Olivia", -46.4355, -67.5218, 80_000},
	{"Río Grande", -53.7878, -67.7068, 95_000},
}

// SnapToCities resolves a batch of geometric coverage-gap points (lat/lng) to
// the best real populated place (city or town — see snapChunk and
// candidateScore) within radiusKm of each — typically the suggested
// branches' simulated coverage radius, capped at snapToCityMaxRadiusKm.
//
// minPopulation filters out candidates whose population (OSM tag or per-type
// fallback) is strictly below the threshold. 0 disables the filter.
//
// blacklistedCities is an optional list of city names to exclude from
// candidate selection (already-discarded suggestions from a previous call).
// Nil / empty disables the filter.
//
// Points are processed in small sequential chunks (snapToCityChunkSize), each
// resolved with a single Overpass request — one "around" clause per point in
// the chunk, unioned together — with a short pause between chunks. This keeps
// each request's aggregate cost within Overpass's tolerance while avoiding
// per-point requests, which get rate-limited (429) almost immediately under
// rapid succession.
//
// Results preserve input order. A point with no populated place within
// radiusKm gets Snapped=false with ErrorReason="NO_RESULTS". A point whose
// chunk request fails (timeout/429/etc.) gets Snapped=false with
// ErrorReason="TIMEOUT". A failure in one chunk does not affect the others.
func (s *CoverageService) SnapToCities(points []model.LatLng, radiusKm float64, minPopulation int, blacklistedCities []string) []model.SnappedCity {
	results := make([]model.SnappedCity, len(points))
	if len(points) == 0 {
		return results
	}
	// Preserve the original (possibly large) radius for the local fallback
	// lookup. The fallback uses it to check whether a Patagonia city is within
	// the caller's intended search area — e.g. a 400km simulator radius should
	// still match Río Gallegos even though the Overpass query is capped lower.
	originalRadiusKm := radiusKm
	if originalRadiusKm <= 0 {
		originalRadiusKm = snapToCityMaxRadiusKm
	}
	// Cap the radius sent to Overpass to protect against timeouts.
	searchRadiusKm := originalRadiusKm
	if searchRadiusKm > snapToCityMaxRadiusKm {
		searchRadiusKm = snapToCityMaxRadiusKm
	}

	for start := 0; start < len(points); start += snapToCityChunkSize {
		end := start + snapToCityChunkSize
		if end > len(points) {
			end = len(points)
		}
		s.snapChunk(points[start:end], searchRadiusKm, originalRadiusKm, minPopulation, blacklistedCities, nil, results[start:end])

		if end < len(points) {
			time.Sleep(snapToCityChunkDelay)
		}
	}

	return results
}

// snapChunk resolves one batch of points via a single Overpass request,
// writing into out (same length as points).
//
// searchRadiusKm is the capped radius sent to Overpass (≤ snapToCityMaxRadiusKm).
// fallbackRadiusKm is the original caller-supplied radius, used by the local
// Patagonia fallback to decide whether a hardcoded city is within range.
//
// On network/server failure the local fallback is tried first for each point;
// only if the fallback also has no match does the entry get ErrorReason="TIMEOUT".
// On a successful Overpass response with no matching candidate the same fallback
// is tried before setting ErrorReason="NO_RESULTS".
func (s *CoverageService) snapChunk(points []model.LatLng, searchRadiusKm, fallbackRadiusKm float64, minPopulation int, blacklistedCities []string, dangerousZones [][]model.LatLng, out []model.SnappedCity) {
	radiusMeters := int(searchRadiusKm * 1000)

	// Query uses `nwr` (node + way + relation) to catch cities mapped as
	// polygons in OSM. The former area["ISO3166-1"="AR"] filter is intentionally
	// absent: combining nwr + around + area in a single Overpass request is very
	// expensive and reliably times out at radii ≥ ~100km. Foreign cities returned
	// by the wider query are discarded by the Point-in-Polygon check inside
	// bestSnapCandidate (the sole remaining barrier).
	//
	// [timeout:13] gives Overpass 13s; the Go client deadline is 15s, leaving 2s
	// for the server to emit a clean error before the connection is cut.
	//
	// `out center` asks Overpass to compute the centroid of ways/relations;
	// nodes still carry their coordinates at the top level. The normalization
	// step below unifies both cases before scoring.
	var q strings.Builder
	q.WriteString(`[out:json][timeout:13];(`)
	for _, p := range points {
		fmt.Fprintf(&q, `nwr["place"~"^(city|town)$"](around:%d,%f,%f);`, radiusMeters, p.Lat, p.Lng)
	}
	totalLimit := snapToCityResultsPerPoint * len(points)
	if totalLimit > snapToCityMaxTotalResults {
		totalLimit = snapToCityMaxTotalResults
	}
	fmt.Fprintf(&q, ");out center %d;", totalLimit)

	req, err := http.NewRequest(http.MethodGet, overpassAPIURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "LogiTrack-CoverageService/1.0 (coverage gap snap-to-city)")
	query := req.URL.Query()
	query.Set("data", q.String())
	req.URL.RawQuery = query.Encode()

	client := s.httpClient
	if client == nil {
		client = &http.Client{Timeout: snapToCityHTTPTimeout}
	}

	resp, err := client.Do(req)
	if err != nil {
		// Overpass unreachable or timed out — try the local fallback before
		// reporting an error, so Patagonian gaps are never left completely blind.
		log.Printf("[SnapToCity] Overpass request failed (%v) — trying local fallback", err)
		for i, p := range points {
			if city, ok := bestFallbackCandidate(p.Lat, p.Lng, fallbackRadiusKm, minPopulation, blacklistedCities, dangerousZones); ok {
				log.Printf("[SnapToCity] fallback hit: %s for point (%.4f, %.4f)", city.Name, p.Lat, p.Lng)
				out[i] = model.SnappedCity{
					LatLng:     model.LatLng{Lat: city.Lat, Lng: city.Lng},
					CityName:   city.Name,
					Snapped:    true,
					Population: city.Population,
				}
			} else {
				out[i] = model.SnappedCity{
					LatLng:      model.LatLng{Lat: p.Lat, Lng: p.Lng},
					ErrorReason: "TIMEOUT",
				}
			}
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[SnapToCity] Overpass returned HTTP %d — trying local fallback", resp.StatusCode)
		for i, p := range points {
			if city, ok := bestFallbackCandidate(p.Lat, p.Lng, fallbackRadiusKm, minPopulation, blacklistedCities, dangerousZones); ok {
				log.Printf("[SnapToCity] fallback hit: %s for point (%.4f, %.4f)", city.Name, p.Lat, p.Lng)
				out[i] = model.SnappedCity{
					LatLng:     model.LatLng{Lat: city.Lat, Lng: city.Lng},
					CityName:   city.Name,
					Snapped:    true,
					Population: city.Population,
				}
			} else {
				out[i] = model.SnappedCity{
					LatLng:      model.LatLng{Lat: p.Lat, Lng: p.Lng},
					ErrorReason: "TIMEOUT",
				}
			}
		}
		return
	}

	var parsed overpassResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return
	}

	// Normalize coordinates: ways and relations carry their centroid in
	// `center`; nodes carry it at the top level. After this step all elements
	// have usable Lat/Lon regardless of their OSM type.
	for i := range parsed.Elements {
		if parsed.Elements[i].Center.Lat != 0 || parsed.Elements[i].Center.Lon != 0 {
			parsed.Elements[i].Lat = parsed.Elements[i].Center.Lat
			parsed.Elements[i].Lon = parsed.Elements[i].Center.Lon
		}
	}

	for i, p := range points {
		best, found := bestSnapCandidate(parsed.Elements, p.Lat, p.Lng, searchRadiusKm, minPopulation, blacklistedCities, dangerousZones)
		if !found {
			// Overpass returned no usable candidate — try local fallback with
			// the full original radius before giving up.
			if city, ok := bestFallbackCandidate(p.Lat, p.Lng, fallbackRadiusKm, minPopulation, blacklistedCities, dangerousZones); ok {
				log.Printf("[SnapToCity] fallback hit: %s for point (%.4f, %.4f)", city.Name, p.Lat, p.Lng)
				out[i] = model.SnappedCity{
					LatLng:     model.LatLng{Lat: city.Lat, Lng: city.Lng},
					CityName:   city.Name,
					Snapped:    true,
					Population: city.Population,
				}
			} else {
				out[i] = model.SnappedCity{
					LatLng:      model.LatLng{Lat: p.Lat, Lng: p.Lng},
					ErrorReason: "NO_RESULTS",
				}
			}
			continue
		}
		out[i] = model.SnappedCity{
			LatLng:     model.LatLng{Lat: best.Lat, Lng: best.Lon},
			CityName:   best.Tags["name"],
			Snapped:    true,
			Population: candidatePopulation(best),
		}
	}
}

// argentinaBorderToleranceDeg absorbs floating-point/simplified-geometry
// false negatives for points exactly on (or just outside) the simplified
// national contour — ~0.05° ≈ 5.5km. Same tolerance used in coverage_test.go.
const argentinaBorderToleranceDeg = 0.05

// isWithinArgentina is the sole barrier against foreign candidates: a
// Point-in-Polygon check against the national contour (geo.ArgentinaContour).
// The Overpass query no longer uses an area filter (too expensive at large
// radii), so this check carries the full responsibility of discarding cities
// from Chile, Uruguay, Bolivia, etc.
func isWithinArgentina(el overpassElement) bool {
	pt := orb.Point{el.Lon, el.Lat}
	contour := geo.ArgentinaContour()
	if planar.MultiPolygonContains(contour, pt) {
		return true
	}
	return planar.DistanceFrom(contour, pt) <= argentinaBorderToleranceDeg
}

// candidatePopulation returns the effective population for an OSM element:
// the parsed "population" tag when present, or a per-place-type fallback.
func candidatePopulation(el overpassElement) int {
	if popStr := el.Tags["population"]; popStr != "" {
		if pop, err := strconv.Atoi(popStr); err == nil && pop > 0 {
			return pop
		}
	}
	if fallback, ok := snapPopulationFallback[el.Tags["place"]]; ok {
		return fallback
	}
	return 0
}

// bestSnapCandidate picks the most populous named place within radiusKm of
// the origin that is inside Argentina. Candidates without a "name" tag,
// beyond radiusKm, outside the national contour, below minPopulation, or
// whose name appears in blacklistedCities are skipped. When two candidates
// share the same population (including both using a per-type fallback), the
// closer one wins as a tiebreaker.
func bestSnapCandidate(elements []overpassElement, originLat, originLng, radiusKm float64, minPopulation int, blacklistedCities []string, dangerousZones [][]model.LatLng) (overpassElement, bool) {
	var best overpassElement
	bestPop := -1
	var bestDist float64
	found := false

	for _, el := range elements {
		name := el.Tags["name"]
		if name == "" {
			continue
		}
		dist := ml.HaversineKm(originLat, originLng, el.Lat, el.Lon)
		if dist > radiusKm {
			continue
		}
		if !isWithinArgentina(el) {
			continue
		}
		if isInAnyDangerousZone(el.Lat, el.Lon, dangerousZones) {
			continue
		}
		pop := candidatePopulation(el)
		if minPopulation > 0 && pop < minPopulation {
			continue
		}
		blacklisted := false
		for _, bl := range blacklistedCities {
			if bl == name {
				blacklisted = true
				break
			}
		}
		if blacklisted {
			continue
		}
		if !found || pop > bestPop || (pop == bestPop && dist < bestDist) {
			best = el
			bestPop = pop
			bestDist = dist
			found = true
		}
	}

	return best, found
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

// bestFallbackCandidate searches patagoniaFallback for the most populous city
// within radiusKm of (originLat, originLng) that passes the minPopulation and
// blacklist filters. It mirrors the ranking logic of bestSnapCandidate: highest
// population wins; ties broken by proximity. Returns (_, false) when no city
// qualifies. radiusKm here is the caller's original (uncapped) radius so that
// a large simulator area (e.g. 400km) can reach cities that Overpass wouldn't
// have queried.
func bestFallbackCandidate(originLat, originLng, radiusKm float64, minPopulation int, blacklistedCities []string, dangerousZones [][]model.LatLng) (fallbackCity, bool) {
	var best fallbackCity
	bestPop := -1
	var bestDist float64
	found := false

	for _, city := range patagoniaFallback {
		dist := ml.HaversineKm(originLat, originLng, city.Lat, city.Lng)
		if dist > radiusKm {
			continue
		}
		if minPopulation > 0 && city.Population < minPopulation {
			continue
		}
		blacklisted := false
		for _, bl := range blacklistedCities {
			if bl == city.Name {
				blacklisted = true
				break
			}
		}
		if blacklisted {
			continue
		}
		if isInAnyDangerousZone(city.Lat, city.Lng, dangerousZones) {
			continue
		}
		if !found || city.Population > bestPop || (city.Population == bestPop && dist < bestDist) {
			best = city
			bestPop = city.Population
			bestDist = dist
			found = true
		}
	}
	return best, found
}

// detectIndustrialZones queries Overpass for OSM "landuse=industrial" areas
// near each snapped candidate and returns a parallel boolean slice. An entry is
// true when at least one industrial polygon centroid lies within 10 km of that
// candidate. Unsnapped entries are always false.
//
// A single Overpass request unions the search radii for all candidates; the
// returned element centroids are then matched back to each candidate locally.
// On any Overpass failure the function returns all-false (fail-open) so that
// scoring degrades gracefully to plain density ranking.
func (s *CoverageService) detectIndustrialZones(candidates []model.SuggestedLocation) []bool {
	result := make([]bool, len(candidates))

	// Collect indices of snapped candidates — only those need an Overpass lookup.
	var snappedIdx []int
	for i, c := range candidates {
		if c.IsSnapped {
			snappedIdx = append(snappedIdx, i)
		}
	}
	if len(snappedIdx) == 0 {
		return result
	}

	const industrialRadiusM = 10_000 // 10 km

	var q strings.Builder
	q.WriteString(`[out:json][timeout:12];(`)
	for _, i := range snappedIdx {
		c := candidates[i]
		fmt.Fprintf(&q, `way["landuse"="industrial"](around:%d,%f,%f);`, industrialRadiusM, c.Lat, c.Lng)
		fmt.Fprintf(&q, `relation["landuse"="industrial"](around:%d,%f,%f);`, industrialRadiusM, c.Lat, c.Lng)
	}
	q.WriteString(`);out ids center;`)

	req, err := http.NewRequest(http.MethodGet, overpassAPIURL, nil)
	if err != nil {
		log.Printf("[IndustrialZone] http.NewRequest: %v", err)
		return result
	}
	req.Header.Set("User-Agent", "LogiTrack-CoverageService/1.0 (industrial zone detection)")
	qv := req.URL.Query()
	qv.Set("data", q.String())
	req.URL.RawQuery = qv.Encode()

	client := s.httpClient
	if client == nil {
		client = &http.Client{Timeout: 14 * time.Second}
	}

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[IndustrialZone] Overpass request failed: %v", err)
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[IndustrialZone] Overpass returned HTTP %d", resp.StatusCode)
		return result
	}

	var parsed overpassResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		log.Printf("[IndustrialZone] decode error: %v", err)
		return result
	}

	// Normalize centroids (ways/relations carry coordinates in .Center).
	for k := range parsed.Elements {
		if parsed.Elements[k].Center.Lat != 0 || parsed.Elements[k].Center.Lon != 0 {
			parsed.Elements[k].Lat = parsed.Elements[k].Center.Lat
			parsed.Elements[k].Lon = parsed.Elements[k].Center.Lon
		}
	}

	const matchKm = 10.0
	for _, i := range snappedIdx {
		c := candidates[i]
		for _, el := range parsed.Elements {
			if el.Lat == 0 && el.Lon == 0 {
				continue
			}
			if ml.HaversineKm(c.Lat, c.Lng, el.Lat, el.Lon) <= matchKm {
				result[i] = true
				break
			}
		}
	}
	log.Printf("[IndustrialZone] %d elements found for %d candidates", len(parsed.Elements), len(snappedIdx))
	return result
}

// CalculateViabilityScore returns a Logistics Viability Index in the range
// [1, 100] that combines four independent signals into a single score:
//
//	Population / Density   40 pts  (20 each, log10 / linear normalised)
//	Net useful area        35 pts  (log10 normalised, 300 000 km² ceiling)
//	Industrial zone bonus  15 pts  (flat bonus when hasIndustry)
//	Terrain friction        ÷ f    (1.0 – 1.5; divides the sub-total)
//
// The raw sub-total (max 90) is then rescaled to 1–100.
//
// This is a pure function with no side-effects and no network calls; terrain
// friction is passed in by the caller (computed via terrainFriction, which is
// also a pure coordinate-based heuristic).
func CalculateViabilityScore(population int, density, usefulAreaKm2 float64, hasIndustry bool, friction float64) int {
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
	// cities with identical population/density figures.
	var industryBonus float64
	if hasIndustry {
		industryBonus = 15
	}

	// Combine and apply terrain penalty.
	// Max raw = (20+20+35+15) / 1.0 = 90; normalise to 1–100.
	raw := (popScore + densityScore + areaScore + industryBonus) / friction
	normalized := raw * (100.0 / 90.0)
	return int(math.Min(100, math.Max(1, math.Round(normalized))))
}

// snapMathSuggestionsInPlace auto-snaps each MathematicalSuggestion to the
// nearest real populated place (cache → Overpass → patagoniaFallback) within
// math.Min(radiusKm/2, snapToCityMaxRadiusKm). Cities inside any dangerous
// zone are excluded by bestSnapCandidate / bestFallbackCandidate.
//
// Cache-first: results from previous calls are stored in cityCachePts keyed by
// the rounded geographic PoI coordinates. Cache hits skip the Overpass call
// entirely, reducing latency on "Buscar más" rounds that re-examine nearby areas.
//
// Snapped entries get their coordinates updated to the city's real lat/lng and
// have CityName / Population / IsSnapped set. Unsnapped entries keep their
// original mathematical coordinates with IsSnapped=false.
//
// The returned slice mirrors suggestions in order and carries the raw SnappedCity
// result for each entry, allowing callers to inspect ErrorReason.
func (s *CoverageService) snapMathSuggestionsInPlace(suggestions []model.SuggestedLocation, radiusKm float64, minPopulation int, dangerousZones [][]model.LatLng, blacklistedCities []string) []model.SnappedCity {
	out := make([]model.SnappedCity, len(suggestions))
	if len(suggestions) == 0 || radiusKm <= 0 {
		return out
	}
	searchRadius := math.Min(radiusKm/2, snapToCityMaxRadiusKm)

	points := make([]model.LatLng, len(suggestions))
	for i := range suggestions {
		points[i] = suggestions[i].LatLng
	}

	// Cache-hit pass: resolve what we can without hitting Overpass.
	var uncachedIdxs []int
	cityCacheMu.RLock()
	for i, p := range points {
		key := cityCacheKey(p.Lat, p.Lng)
		entry, ok := cityCachePts[key]
		if !ok {
			uncachedIdxs = append(uncachedIdxs, i)
			continue
		}
		if !entry.found {
			out[i] = model.SnappedCity{ErrorReason: "NO_RESULTS"}
			continue
		}
		// Blacklisted city in cache → re-query so the snap can find an alternative.
		if isBlacklisted(entry.Name, blacklistedCities) {
			uncachedIdxs = append(uncachedIdxs, i)
			continue
		}
		if minPopulation > 0 && entry.Population < minPopulation {
			out[i] = model.SnappedCity{ErrorReason: "NO_RESULTS"}
			continue
		}
		out[i] = model.SnappedCity{
			LatLng:     model.LatLng{Lat: entry.Lat, Lng: entry.Lng},
			CityName:   entry.Name,
			Snapped:    true,
			Population: entry.Population,
		}
		log.Printf("[MathSugg] cache hit[%d]: %s (%.4f, %.4f)", i, entry.Name, entry.Lat, entry.Lng)
	}
	cityCacheMu.RUnlock()

	// Overpass for uncached points, chunked to avoid rate-limiting.
	if len(uncachedIdxs) > 0 {
		uncachedPts := make([]model.LatLng, len(uncachedIdxs))
		for j, i := range uncachedIdxs {
			uncachedPts[j] = points[i]
		}
		uncachedOut := make([]model.SnappedCity, len(uncachedPts))
		for start := 0; start < len(uncachedPts); start += snapToCityChunkSize {
			end := start + snapToCityChunkSize
			if end > len(uncachedPts) {
				end = len(uncachedPts)
			}
			s.snapChunk(uncachedPts[start:end], searchRadius, radiusKm, minPopulation, blacklistedCities, dangerousZones, uncachedOut[start:end])
			if end < len(uncachedPts) {
				time.Sleep(snapToCityChunkDelay)
			}
		}
		// Map results back and populate the cache for next time.
		cityCacheMu.Lock()
		for j, i := range uncachedIdxs {
			out[i] = uncachedOut[j]
			key := cityCacheKey(points[i].Lat, points[i].Lng)
			if uncachedOut[j].Snapped {
				cityCachePts[key] = cachedCityResult{
					found:      true,
					Name:       uncachedOut[j].CityName,
					Lat:        uncachedOut[j].Lat,
					Lng:        uncachedOut[j].Lng,
					Population: uncachedOut[j].Population,
				}
			} else {
				cityCachePts[key] = cachedCityResult{found: false}
			}
		}
		cityCacheMu.Unlock()
	}

	// Apply snap results to suggestions in-place and log.
	for i := range suggestions {
		if out[i].Snapped {
			suggestions[i].LatLng = out[i].LatLng
			suggestions[i].CityName = out[i].CityName
			suggestions[i].IsSnapped = true
			suggestions[i].Population = out[i].Population
			log.Printf("[MathSugg] snap[%d]: → %s (%.4f, %.4f) pop=%d",
				i, out[i].CityName, out[i].LatLng.Lat, out[i].LatLng.Lng, out[i].Population)
		} else {
			log.Printf("[MathSugg] snap[%d]: not snapped (%.4f, %.4f) reason=%s",
				i, points[i].Lat, points[i].Lng, out[i].ErrorReason)
		}
	}
	return out
}
