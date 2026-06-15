package service

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

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

	// snapToCityMaxRadiusKm is both the fallback search radius (when the
	// caller doesn't specify one) and a hard cap on the requested radiusKm.
	// Overpass "around" query cost grows with the area of the search disk
	// (~R²): a single point at radius=178km already takes ~9s, and a city
	// further than 100km from a suggested gap-fill point isn't a useful new
	// branch location anyway, so larger radii are clamped down to this value.
	snapToCityMaxRadiusKm = 100.0

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

	// snapToCityHTTPTimeout must exceed the Overpass-side `[timeout:25]`
	// query timeout with margin, otherwise our client gives up
	// (context deadline exceeded) before Overpass even replies.
	snapToCityHTTPTimeout = 30 * time.Second
)

// overpassElement is a single OSM node from an Overpass "out body" response.
// Only the fields needed for distance/naming are decoded.
type overpassElement struct {
	Lat  float64           `json:"lat"`
	Lon  float64           `json:"lon"`
	Tags map[string]string `json:"tags"`
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

// SnapToCities resolves a batch of geometric coverage-gap points (lat/lng) to
// the best real populated place (city or town — see snapChunk and
// candidateScore) within radiusKm of each — typically the suggested
// branches' simulated coverage radius, capped at snapToCityMaxRadiusKm.
//
// Points are processed in small sequential chunks (snapToCityChunkSize), each
// resolved with a single Overpass request — one "around" clause per point in
// the chunk, unioned together — with a short pause between chunks. This keeps
// each request's aggregate cost within Overpass's tolerance while avoiding
// per-point requests, which get rate-limited (429) almost immediately under
// rapid succession.
//
// Results preserve input order. A point with no populated place within
// radiusKm, or whose chunk request fails (timeout/429/etc.), gets
// Snapped=false — callers should keep its original geometric coordinates in
// that case. A failure in one chunk does not affect the others.
func (s *CoverageService) SnapToCities(points []model.LatLng, radiusKm float64) []model.SnappedCity {
	results := make([]model.SnappedCity, len(points))
	if len(points) == 0 {
		return results
	}
	if radiusKm <= 0 || radiusKm > snapToCityMaxRadiusKm {
		radiusKm = snapToCityMaxRadiusKm
	}

	for start := 0; start < len(points); start += snapToCityChunkSize {
		end := start + snapToCityChunkSize
		if end > len(points) {
			end = len(points)
		}
		s.snapChunk(points[start:end], radiusKm, results[start:end])

		if end < len(points) {
			time.Sleep(snapToCityChunkDelay)
		}
	}

	return results
}

// snapChunk resolves one batch of points via a single Overpass request,
// writing into out (same length as points). On any failure, out is left with
// its zero values (Snapped=false for every point in the chunk).
func (s *CoverageService) snapChunk(points []model.LatLng, radiusKm float64, out []model.SnappedCity) {
	radiusMeters := int(radiusKm * 1000)

	// Only city/town: these are real urban centers viable as logistics hubs.
	// village/hamlet/isolated_dwelling are excluded at the query level so
	// Overpass never returns tiny settlements that would otherwise win on
	// raw proximity to the gap centroid (see candidateScore).
	var q strings.Builder
	q.WriteString("[out:json][timeout:25];(")
	for _, p := range points {
		fmt.Fprintf(&q, `node["place"~"^(city|town)$"](around:%d,%f,%f);`, radiusMeters, p.Lat, p.Lng)
	}
	totalLimit := snapToCityResultsPerPoint * len(points)
	if totalLimit > snapToCityMaxTotalResults {
		totalLimit = snapToCityMaxTotalResults
	}
	fmt.Fprintf(&q, ");out body %d;", totalLimit)

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
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var parsed overpassResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return
	}

	for i, p := range points {
		best, found := bestSnapCandidate(parsed.Elements, p.Lat, p.Lng, radiusKm)
		if !found {
			continue
		}
		out[i] = model.SnappedCity{
			LatLng:   model.LatLng{Lat: best.Lat, Lng: best.Lon},
			CityName: best.Tags["name"],
			Snapped:  true,
		}
	}
}

// placeTypeWeight is the base "urban hierarchy" weight for an OSM place=
// tag. snapChunk only queries place=city|town (see above), so in practice
// every candidate has one of these two values; the default only matters for
// hand-built test fixtures or a future relaxed query.
var placeTypeWeight = map[string]float64{
	"city": 50.0,
	"town": 5.0,
}

// placeScorePopulationDivisor and placeScoreDistanceDivisorKm tune
// candidateScore (see below).
const (
	placeScorePopulationDivisor  = 500_000.0
	placeScoreDistanceDivisorKm  = 20.0
	placeScoreDefaultPlaceWeight = 1.0
)

// candidateScore implements the "gravity" scoring used to rank snap-to-city
// candidates: place-type hierarchy and population pull the score up, distance
// pulls it down.
//
//	score = placeWeight * (1 + population/500_000) / (1 + distanceKm/20)
//
// The distance decay (÷20km) is gentle enough that the city/town weight gap
// (50 vs 5 — a 10x difference) dominates even at the edges of the search
// radius: a place=city 40km away always outscores a place=town 10km away
// (50/(1+40/20)=16.7 vs 5/(1+10/20)=3.3), so a real city is never passed over
// for a small town just because the town sits closer to the geometric gap
// centroid. Population, when present, adds a further multiplier so that e.g.
// a provincial capital outranks a smaller city at a similar distance.
func candidateScore(el overpassElement, distanceKm float64) float64 {
	weight, ok := placeTypeWeight[el.Tags["place"]]
	if !ok {
		weight = placeScoreDefaultPlaceWeight
	}

	if popStr := el.Tags["population"]; popStr != "" {
		if population, err := strconv.ParseFloat(popStr, 64); err == nil && population > 0 {
			weight *= 1 + population/placeScorePopulationDivisor
		}
	}

	return weight / (1 + distanceKm/placeScoreDistanceDivisorKm)
}

// bestSnapCandidate picks the named populated place with the highest
// candidateScore among those within radiusKm of the origin point.
// Candidates without a "name" tag (not usable as a CityName) or beyond
// radiusKm are skipped.
func bestSnapCandidate(elements []overpassElement, originLat, originLng, radiusKm float64) (overpassElement, bool) {
	var best overpassElement
	bestScore := math.Inf(-1)
	found := false

	for _, el := range elements {
		if el.Tags["name"] == "" {
			continue
		}
		dist := ml.HaversineKm(originLat, originLng, el.Lat, el.Lon)
		if dist > radiusKm {
			continue
		}
		score := candidateScore(el, dist)
		if !found || score > bestScore {
			best = el
			bestScore = score
			found = true
		}
	}

	return best, found
}
