package service

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
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
		s.snapChunk(points[start:end], searchRadiusKm, originalRadiusKm, minPopulation, blacklistedCities, results[start:end])

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
func (s *CoverageService) snapChunk(points []model.LatLng, searchRadiusKm, fallbackRadiusKm float64, minPopulation int, blacklistedCities []string, out []model.SnappedCity) {
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
			if city, ok := bestFallbackCandidate(p.Lat, p.Lng, fallbackRadiusKm, minPopulation, blacklistedCities); ok {
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
			if city, ok := bestFallbackCandidate(p.Lat, p.Lng, fallbackRadiusKm, minPopulation, blacklistedCities); ok {
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
		best, found := bestSnapCandidate(parsed.Elements, p.Lat, p.Lng, searchRadiusKm, minPopulation, blacklistedCities)
		if !found {
			// Overpass returned no usable candidate — try local fallback with
			// the full original radius before giving up.
			if city, ok := bestFallbackCandidate(p.Lat, p.Lng, fallbackRadiusKm, minPopulation, blacklistedCities); ok {
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
func bestSnapCandidate(elements []overpassElement, originLat, originLng, radiusKm float64, minPopulation int, blacklistedCities []string) (overpassElement, bool) {
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

// bestFallbackCandidate searches patagoniaFallback for the most populous city
// within radiusKm of (originLat, originLng) that passes the minPopulation and
// blacklist filters. It mirrors the ranking logic of bestSnapCandidate: highest
// population wins; ties broken by proximity. Returns (_, false) when no city
// qualifies. radiusKm here is the caller's original (uncapped) radius so that
// a large simulator area (e.g. 400km) can reach cities that Overpass wouldn't
// have queried.
func bestFallbackCandidate(originLat, originLng, radiusKm float64, minPopulation int, blacklistedCities []string) (fallbackCity, bool) {
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
		if !found || city.Population > bestPop || (city.Population == bestPop && dist < bestDist) {
			best = city
			bestPop = city.Population
			bestDist = dist
			found = true
		}
	}
	return best, found
}
