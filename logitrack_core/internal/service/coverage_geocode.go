package service

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

// "Snap to City": geometric coverage-gap points (suggested branch locations
// derived from Voronoi/circle geometry, Diagnose) often land in empty terrain
// — the middle of a field, a mountain range, etc. SnapToCity resolves such a
// point to a nearby real populated place via the OpenStreetMap Overpass API
// (no API key required, no local city database to maintain), so suggestions
// are logistically viable.
const (
	overpassAPIURL = "https://overpass-api.de/api/interpreter"

	// snapToCityDefaultRadiusKm is the lookup radius around the geometric
	// point when the caller doesn't specify one (e.g. no simulated coverage
	// circle is active).
	snapToCityDefaultRadiusKm = 100.0

	// snapToCityMaxResults caps how many candidate places Overpass returns —
	// plenty to find a good match within the radius without an oversized response.
	snapToCityMaxResults = 30

	snapToCityHTTPTimeout = 10 * time.Second

	// Scoring weights for scoreSnapCandidate: combine settlement importance
	// (place hierarchy + population, log-scaled) against distance to the
	// geometric gap point. Used to rank candidates within the same place
	// tier (see snapToCityPlaceTiers) — a closer or more populated place
	// wins over another of the same hierarchy.
	snapToCityPlaceWeight          = 2.0
	snapToCityPopulationWeight     = 1.0
	snapToCityDistancePenaltyPerKm = 0.05
)

// snapToCityPlaceTiers defines the administrative hierarchy preference order:
// a city anywhere in the search radius is preferred over a town, which is
// preferred over a village, which is preferred over a hamlet. bestSnapCandidate
// only considers a lower tier when no named candidate exists in a higher one.
var snapToCityPlaceTiers = []string{"city", "town", "village", "hamlet"}

// snapToCityPlaceScore maps OSM "place" tag values to an administrative
// hierarchy weight: city > town > village > hamlet.
var snapToCityPlaceScore = map[string]float64{
	"city":    3.0,
	"town":    2.0,
	"village": 1.0,
	"hamlet":  0.5,
}

// overpassElement is a single OSM node from an Overpass "out body" response.
// Only the fields needed for scoring/naming are decoded.
type overpassElement struct {
	Lat  float64           `json:"lat"`
	Lon  float64           `json:"lon"`
	Tags map[string]string `json:"tags"`
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

// SnapToCity resolves a geometric coverage-gap point (lat/lng) to the nearby
// real populated place that best matches the suggested branch's coverage
// area: a city anywhere within radiusKm is preferred over a town, which is
// preferred over a village, which is preferred over a hamlet (see
// snapToCityPlaceTiers); radiusKm <= 0 falls back to
// snapToCityDefaultRadiusKm. Returns Found=false (with a nil error) when
// Overpass has no populated place within the radius — callers should keep
// the original geometric point in that case.
func (s *CoverageService) SnapToCity(lat, lng, radiusKm float64) (model.SnappedCity, error) {
	if radiusKm <= 0 {
		radiusKm = snapToCityDefaultRadiusKm
	}
	radiusMeters := int(radiusKm * 1000)

	query := fmt.Sprintf(
		`[out:json][timeout:25];node["place"~"^(city|town|village|hamlet)$"](around:%d,%f,%f);out body %d;`,
		radiusMeters, lat, lng, snapToCityMaxResults,
	)

	req, err := http.NewRequest(http.MethodGet, overpassAPIURL, nil)
	if err != nil {
		return model.SnappedCity{}, err
	}
	req.Header.Set("User-Agent", "LogiTrack-CoverageService/1.0 (coverage gap snap-to-city)")
	q := req.URL.Query()
	q.Set("data", query)
	req.URL.RawQuery = q.Encode()

	client := s.httpClient
	if client == nil {
		client = &http.Client{Timeout: snapToCityHTTPTimeout}
	}

	resp, err := client.Do(req)
	if err != nil {
		return model.SnappedCity{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return model.SnappedCity{}, fmt.Errorf("overpass API respondió %d", resp.StatusCode)
	}

	var parsed overpassResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return model.SnappedCity{}, err
	}

	best, found := bestSnapCandidate(parsed.Elements, lat, lng)
	if !found {
		return model.SnappedCity{Found: false}, nil
	}

	return model.SnappedCity{
		LatLng: model.LatLng{Lat: best.Lat, Lng: best.Lon},
		Name:   best.Tags["name"],
		Found:  true,
	}, nil
}

// bestSnapCandidate picks the best named candidate following the place
// hierarchy in snapToCityPlaceTiers: it only looks at a tier (e.g. "town") if
// no named candidate exists in any higher tier (e.g. "city"). Within a tier,
// the candidate with the highest scoreSnapCandidate wins — i.e. the closer
// and/or more populated one.
func bestSnapCandidate(elements []overpassElement, originLat, originLng float64) (overpassElement, bool) {
	for _, tier := range snapToCityPlaceTiers {
		var best overpassElement
		bestScore := math.Inf(-1)
		found := false

		for _, el := range elements {
			if el.Tags["name"] == "" || el.Tags["place"] != tier {
				continue
			}
			score := scoreSnapCandidate(el, originLat, originLng)
			if !found || score > bestScore {
				best = el
				bestScore = score
				found = true
			}
		}

		if found {
			return best, true
		}
	}

	return overpassElement{}, false
}

// scoreSnapCandidate combines a settlement's administrative importance (place
// hierarchy + population, log-scaled) against its distance to the geometric
// gap point: closer and more important places score higher. Population is
// frequently absent on OSM nodes for smaller settlements, in which case only
// the place-type weight applies.
func scoreSnapCandidate(el overpassElement, originLat, originLng float64) float64 {
	placeScore := snapToCityPlaceScore[el.Tags["place"]]

	popScore := 0.0
	if popStr := el.Tags["population"]; popStr != "" {
		if pop, err := strconv.ParseFloat(popStr, 64); err == nil && pop > 0 {
			popScore = math.Log10(pop)
		}
	}

	distKm := ml.HaversineKm(originLat, originLng, el.Lat, el.Lon)

	return placeScore*snapToCityPlaceWeight + popScore*snapToCityPopulationWeight - distKm*snapToCityDistancePenaltyPerKm
}
