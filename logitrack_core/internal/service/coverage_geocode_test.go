package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/logitrack/core/internal/model"
)

// TestBestSnapCandidate_PrefersHigherPopulation verifies population-first
// selection: a place=city 40km away (fallback 100 000) outranks a place=town
// 10km away (fallback 10 000) because its effective population is higher,
// regardless of distance.
func TestBestSnapCandidate_PrefersHigherPopulation(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	city := overpassElement{
		Lat: -34.36, Lon: -64.0, // ~40km away
		Tags: map[string]string{"place": "city", "name": "Ciudad Principal"},
	}
	town := overpassElement{
		Lat: -34.09, Lon: -64.0, // ~10km away, but lower fallback population
		Tags: map[string]string{"place": "town", "name": "Pueblo Cercano"},
	}

	best, found := bestSnapCandidate([]overpassElement{town, city}, originLat, originLng, 100, 0, nil)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "Ciudad Principal" {
		t.Errorf("expected the higher-population city to win over the nearer town, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_PopulationBreaksTie verifies that, between two
// place=city candidates at the same distance, the one with a larger reported
// population wins.
func TestBestSnapCandidate_PopulationBreaksTie(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	small := overpassElement{
		Lat: -34.1, Lon: -64.0,
		Tags: map[string]string{"place": "city", "name": "Ciudad Chica", "population": "8000"},
	}
	big := overpassElement{
		Lat: -34.1, Lon: -64.1,
		Tags: map[string]string{"place": "city", "name": "Ciudad Capital", "population": "1300000"},
	}

	best, found := bestSnapCandidate([]overpassElement{small, big}, originLat, originLng, 100, 0, nil)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "Ciudad Capital" {
		t.Errorf("expected the more populous city to win, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_SkipsUnnamed verifies that candidates without a
// "name" tag (unusable as a CityName) are excluded from selection.
func TestBestSnapCandidate_SkipsUnnamed(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	elements := []overpassElement{
		{Lat: -34.0, Lon: -64.0, Tags: map[string]string{"place": "city", "population": "500000"}}, // unnamed, distance 0
		{Lat: -34.2, Lon: -64.0, Tags: map[string]string{"place": "town", "name": "Pueblo Chico"}},
	}

	best, found := bestSnapCandidate(elements, originLat, originLng, 150, 0, nil)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "Pueblo Chico" {
		t.Errorf("expected the unnamed (closer, higher-weight) candidate to be skipped, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_SkipsBeyondRadius verifies that candidates farther
// than radiusKm from the origin are excluded, even if they would otherwise
// score higher.
func TestBestSnapCandidate_SkipsBeyondRadius(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	tooFar := overpassElement{
		Lat: -35.0, Lon: -64.0, // ~111km away
		Tags: map[string]string{"place": "city", "name": "Ciudad Lejana"},
	}
	withinRadius := overpassElement{
		Lat: -34.5, Lon: -64.0, // ~55km away
		Tags: map[string]string{"place": "town", "name": "Pueblo Cercano"},
	}

	best, found := bestSnapCandidate([]overpassElement{tooFar, withinRadius}, originLat, originLng, 60, 0, nil)
	if !found {
		t.Fatal("expected a candidate within the radius to be found")
	}
	if best.Tags["name"] != "Pueblo Cercano" {
		t.Errorf("expected the candidate beyond radiusKm to be skipped, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_NoneFound verifies the empty/no-candidates and
// all-beyond-radius cases report found=false rather than a zero-value match.
func TestBestSnapCandidate_NoneFound(t *testing.T) {
	if _, found := bestSnapCandidate(nil, -34.0, -64.0, 100, 0, nil); found {
		t.Error("expected found=false for an empty candidate list")
	}

	unnamed := []overpassElement{{Lat: -34.0, Lon: -64.0, Tags: map[string]string{"place": "city"}}}
	if _, found := bestSnapCandidate(unnamed, -34.0, -64.0, 100, 0, nil); found {
		t.Error("expected found=false when no candidate has a name")
	}

	tooFar := []overpassElement{{Lat: -35.0, Lon: -64.0, Tags: map[string]string{"place": "city", "name": "Lejos"}}}
	if _, found := bestSnapCandidate(tooFar, -34.0, -64.0, 10, 0, nil); found {
		t.Error("expected found=false when every named candidate is beyond radiusKm")
	}
}

// TestBestSnapCandidate_DiscardsOutsideArgentina verifies the second barrier:
// a Point-in-Polygon check against geo.ArgentinaContour discards candidates
// outside Argentina's land borders, even when they would otherwise win on
// score (place=city + large population) against a lower-scoring candidate
// genuinely inside Argentina.
func TestBestSnapCandidate_DiscardsOutsideArgentina(t *testing.T) {
	originLat, originLng := -34.6, -58.4 // Ciudad de Buenos Aires

	outsideArgentina := overpassElement{
		Lat: -15.78, Lon: -47.93, // Brasília, Brasil
		Tags: map[string]string{"place": "city", "name": "Brasilia", "population": "3000000"},
	}
	insideArgentina := overpassElement{
		Lat: -34.92, Lon: -57.95, // La Plata, Argentina
		Tags: map[string]string{"place": "town", "name": "La Plata"},
	}

	best, found := bestSnapCandidate([]overpassElement{outsideArgentina, insideArgentina}, originLat, originLng, 5000, 0, nil)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "La Plata" {
		t.Errorf("expected the candidate outside Argentina to be discarded regardless of score, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_NoneFound_AllOutsideArgentina verifies found=false
// when every candidate within radiusKm is outside Argentina's land borders.
func TestBestSnapCandidate_NoneFound_AllOutsideArgentina(t *testing.T) {
	originLat, originLng := -34.6, -58.4 // Ciudad de Buenos Aires

	outsideArgentina := []overpassElement{
		{Lat: -15.78, Lon: -47.93, Tags: map[string]string{"place": "city", "name": "Brasilia"}},
	}

	if _, found := bestSnapCandidate(outsideArgentina, originLat, originLng, 5000, 0, nil); found {
		t.Error("expected found=false when every candidate is outside Argentina")
	}
}

// fakeOverpassServer returns an Overpass-shaped JSON response containing one
// named node near each "around" clause in the query, so SnapToCities finds it
// as the nearest candidate. requestCount tracks how many requests were made
// (to assert chunking); statusForRequest, if non-nil, lets a test fail
// specific requests by their 1-based sequence number.
func fakeOverpassServer(requestCount *int32, statusForRequest func(n int32) int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(requestCount, 1)
		if statusForRequest != nil {
			if status := statusForRequest(n); status != http.StatusOK {
				w.WriteHeader(status)
				return
			}
		}

		q := r.URL.Query().Get("data")
		var elements []overpassElement
		for _, around := range extractAroundCoords(q) {
			elements = append(elements, overpassElement{
				Lat:  around[0] + 0.001,
				Lon:  around[1] + 0.001,
				Tags: map[string]string{"name": "Ciudad " + strconv.FormatFloat(around[0], 'f', 2, 64)},
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(overpassResponse{Elements: elements})
	}))
}

// extractAroundCoords pulls the lat/lng pairs out of `around:R,lat,lng`
// clauses in a raw Overpass query string.
func extractAroundCoords(q string) [][2]float64 {
	var coords [][2]float64
	for _, part := range strings.Split(q, "around:")[1:] {
		fields := strings.SplitN(part, ",", 3)
		if len(fields) < 3 {
			continue
		}
		lat, err1 := strconv.ParseFloat(fields[1], 64)
		lng, err2 := strconv.ParseFloat(strings.SplitN(fields[2], ")", 2)[0], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		coords = append(coords, [2]float64{lat, lng})
	}
	return coords
}

// redirectingTransport rewrites every request to target the given test server
// base URL while preserving the query string, so SnapToCities's hardcoded
// overpassAPIURL can be redirected to an httptest server.
type redirectingTransport struct {
	base string
}

func (rt redirectingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	target, err := http.NewRequest(req.Method, rt.base+"?"+req.URL.RawQuery, nil)
	if err != nil {
		return nil, err
	}
	target.Header = req.Header
	return http.DefaultTransport.RoundTrip(target)
}

func TestSnapToCities_Empty(t *testing.T) {
	svc := NewCoverageService(nil, nil)
	results := svc.SnapToCities(nil, 50, 0, nil)
	if len(results) != 0 {
		t.Fatalf("expected empty results, got %d", len(results))
	}
}

// TestSnapToCities_ChunksRequests verifies that points are split into
// snapToCityChunkSize-sized batches, each resolved with its own Overpass
// request, and that every point in a successful chunk gets snapped.
func TestSnapToCities_ChunksRequests(t *testing.T) {
	var reqCount int32
	server := fakeOverpassServer(&reqCount, nil)
	defer server.Close()

	svc := NewCoverageService(nil, nil)
	svc.httpClient = &http.Client{Transport: redirectingTransport{base: server.URL}}

	// 7 points -> ceil(7/5) = 2 chunked requests.
	points := make([]model.LatLng, 7)
	for i := range points {
		points[i] = model.LatLng{Lat: -30.0 - float64(i), Lng: -60.0 - float64(i)}
	}

	results := svc.SnapToCities(points, 50, 0, nil)

	if len(results) != 7 {
		t.Fatalf("expected 7 results, got %d", len(results))
	}
	if reqCount != 2 {
		t.Fatalf("expected 2 chunked requests for 7 points, got %d", reqCount)
	}
	for i, r := range results {
		if !r.Snapped {
			t.Errorf("point %d: expected Snapped=true, got false", i)
		}
		if r.CityName == "" {
			t.Errorf("point %d: expected a city name, got empty", i)
		}
	}
}

// TestSnapToCities_QueryFiltersByPlaceType verifies that the Overpass query
// uses `nwr` (node/way/relation) to catch cities mapped as areas, filters on
// place=city|town, requests center coordinates via `out center`, and excludes
// village/hamlet/isolated_dwelling — small settlements excluded at the query
// level so they never reach the scoring step.
func TestSnapToCities_QueryFiltersByPlaceType(t *testing.T) {
	var capturedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedQuery = r.URL.Query().Get("data")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(overpassResponse{})
	}))
	defer server.Close()

	svc := NewCoverageService(nil, nil)
	svc.httpClient = &http.Client{Transport: redirectingTransport{base: server.URL}}

	svc.SnapToCities([]model.LatLng{{Lat: -34.0, Lng: -58.0}}, 50, 0, nil)

	if !strings.Contains(capturedQuery, `nwr["place"~"^(city|town)$"`) {
		t.Fatalf("expected query to use nwr and filter on place=city|town, query was: %s", capturedQuery)
	}
	if !strings.Contains(capturedQuery, "out center") {
		t.Fatalf("expected query to use 'out center', query was: %s", capturedQuery)
	}
	for _, excluded := range []string{"village", "hamlet", "isolated_dwelling"} {
		if strings.Contains(capturedQuery, excluded) {
			t.Errorf("expected query to exclude place=%s, query was: %s", excluded, capturedQuery)
		}
	}
}

// TestSnapToCities_QueryHasNoAreaFilter verifies that the Overpass query does
// NOT use the area["ISO3166-1"="AR"] restriction. That filter combined with
// nwr + around causes timeouts at large radii (≥ ~100km). Foreign cities are
// discarded exclusively by the Point-in-Polygon check in bestSnapCandidate
// (see TestBestSnapCandidate_DiscardsOutsideArgentina).
func TestSnapToCities_QueryHasNoAreaFilter(t *testing.T) {
	var capturedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedQuery = r.URL.Query().Get("data")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(overpassResponse{})
	}))
	defer server.Close()

	svc := NewCoverageService(nil, nil)
	svc.httpClient = &http.Client{Transport: redirectingTransport{base: server.URL}}

	svc.SnapToCities([]model.LatLng{{Lat: -34.0, Lng: -58.0}}, 50, 0, nil)

	if strings.Contains(capturedQuery, "ISO3166") {
		t.Fatalf("query must not use area filter (timeouts at large radii), got: %s", capturedQuery)
	}
	if strings.Contains(capturedQuery, "area.ar") {
		t.Fatalf("query must not restrict by (area.ar), got: %s", capturedQuery)
	}
}

// TestSnapToCities_RadiusCapped verifies that a requested radius beyond
// snapToCityMaxRadiusKm (150 km) is clamped down before being sent to Overpass.
func TestSnapToCities_RadiusCapped(t *testing.T) {
	var reqCount int32
	var capturedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&reqCount, 1)
		capturedQuery = r.URL.Query().Get("data")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(overpassResponse{})
	}))
	defer server.Close()

	svc := NewCoverageService(nil, nil)
	svc.httpClient = &http.Client{Transport: redirectingTransport{base: server.URL}}

	svc.SnapToCities([]model.LatLng{{Lat: -34.0, Lng: -58.0}}, 437.0, 0, nil)

	if !strings.Contains(capturedQuery, "around:150000,") {
		t.Fatalf("expected radius capped to 150000m, query was: %s", capturedQuery)
	}
}

// TestSnapToCities_ChunkFailureIsPartial verifies that a failed chunk
// (e.g. 429) leaves only its own points as Snapped=false, without affecting
// other chunks.
func TestSnapToCities_ChunkFailureIsPartial(t *testing.T) {
	var reqCount int32
	server := fakeOverpassServer(&reqCount, func(n int32) int {
		if n == 1 {
			return http.StatusTooManyRequests
		}
		return http.StatusOK
	})
	defer server.Close()

	svc := NewCoverageService(nil, nil)
	svc.httpClient = &http.Client{Transport: redirectingTransport{base: server.URL}}

	points := make([]model.LatLng, 7)
	for i := range points {
		points[i] = model.LatLng{Lat: -30.0 - float64(i), Lng: -60.0 - float64(i)}
	}

	results := svc.SnapToCities(points, 50, 0, nil)

	for i := 0; i < 5; i++ {
		if results[i].Snapped {
			t.Errorf("point %d: expected Snapped=false (chunk 1 failed), got true", i)
		}
	}
	for i := 5; i < 7; i++ {
		if !results[i].Snapped {
			t.Errorf("point %d: expected Snapped=true (chunk 2 succeeded), got false", i)
		}
	}
}

// TestSnapToCities_UsesCenterCoordinates verifies that when an element
// returned by Overpass has a non-zero `center` object (typical for ways and
// relations under `out center`), those center coordinates are used for snapping
// instead of the zeroed top-level lat/lon. Without this normalization, cities
// mapped as areas (e.g. Río Gallegos) would be silently discarded because their
// root lat/lon are 0,0 — outside the search radius and outside Argentina.
func TestSnapToCities_UsesCenterCoordinates(t *testing.T) {
	// Coordinates of Río Gallegos — a city mapped as a relation in OSM.
	origin := model.LatLng{Lat: -51.623, Lng: -69.217}
	centerLat, centerLon := -51.623, -69.217

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulate a way/relation response: root Lat/Lon are zero (as Overpass
		// returns for non-node types without `out body`); real coords in Center.
		resp := overpassResponse{
			Elements: []overpassElement{
				{
					Lat: 0, Lon: 0,
					Center: overpassCenter{Lat: centerLat, Lon: centerLon},
					Tags:   map[string]string{"place": "city", "name": "Río Gallegos"},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := NewCoverageService(nil, nil)
	svc.httpClient = &http.Client{Transport: redirectingTransport{base: server.URL}}

	results := svc.SnapToCities([]model.LatLng{origin}, 100, 0, nil)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if !results[0].Snapped {
		t.Fatal("expected the way/relation to be snapped via its center coordinates, got Snapped=false")
	}
	if results[0].CityName != "Río Gallegos" {
		t.Errorf("expected city name 'Río Gallegos', got %q", results[0].CityName)
	}
	if results[0].Lat != centerLat || results[0].Lng != centerLon {
		t.Errorf("expected snapped coords (%v,%v), got (%v,%v)", centerLat, centerLon, results[0].Lat, results[0].Lng)
	}
}
