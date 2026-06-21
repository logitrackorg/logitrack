package service

import (
	"testing"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

// Tandil — a well-known city present in the embedded INDEC/Georef dataset, used
// as a stable anchor for the snap tests.
var tandil = model.LatLng{Lat: -37.32885, Lng: -59.13399}

func TestSnapToCities_Empty(t *testing.T) {
	svc := NewCoverageService(nil, nil)
	results := svc.SnapToCities(nil, 50, 0, nil)
	if len(results) != 0 {
		t.Fatalf("expected empty results, got %d", len(results))
	}
}

// TestSnapToCities_SnapsToRealCity verifies a point on top of a real city snaps
// to it with its official population.
func TestSnapToCities_SnapsToRealCity(t *testing.T) {
	svc := NewCoverageService(nil, nil)
	results := svc.SnapToCities([]model.LatLng{tandil}, 10, 0, nil)
	if len(results) != 1 || !results[0].Snapped {
		t.Fatalf("expected Tandil to snap, got %+v", results)
	}
	if results[0].CityName != "Tandil" {
		t.Errorf("expected 'Tandil', got %q", results[0].CityName)
	}
	if results[0].Population <= 0 {
		t.Errorf("expected positive population, got %d", results[0].Population)
	}
}

// TestSnapToCities_NoResultsBeyondRadius verifies a point far from any city with
// a small radius reports NO_RESULTS (and never TIMEOUT — the lookup is local).
func TestSnapToCities_NoResultsBeyondRadius(t *testing.T) {
	svc := NewCoverageService(nil, nil)
	ocean := model.LatLng{Lat: -45.0, Lng: -45.0} // South Atlantic
	results := svc.SnapToCities([]model.LatLng{ocean}, 50, 0, nil)
	if results[0].Snapped {
		t.Errorf("expected no snap in the open ocean, got %q", results[0].CityName)
	}
	if results[0].ErrorReason != "NO_RESULTS" {
		t.Errorf("expected NO_RESULTS, got %q", results[0].ErrorReason)
	}
}

// TestSnapToCities_MinPopulationFilter verifies an impossibly high minimum
// population yields no snap.
func TestSnapToCities_MinPopulationFilter(t *testing.T) {
	svc := NewCoverageService(nil, nil)
	results := svc.SnapToCities([]model.LatLng{tandil}, 10, 1_000_000_000, nil)
	if results[0].Snapped {
		t.Errorf("expected no snap with impossible minPopulation, got %q", results[0].CityName)
	}
}

// TestSnapToCities_Blacklist verifies a blacklisted city is never selected.
func TestSnapToCities_Blacklist(t *testing.T) {
	svc := NewCoverageService(nil, nil)
	results := svc.SnapToCities([]model.LatLng{tandil}, 10, 0, []string{"Tandil"})
	if results[0].Snapped && results[0].CityName == "Tandil" {
		t.Error("expected Tandil to be excluded by the blacklist")
	}
}

// TestBestLocality_PrefersHigherPopulation verifies the ranking picks the most
// populous locality within the radius (not merely the nearest). The expected
// winner is computed directly from the dataset so the test is self-validating.
func TestBestLocality_PrefersHigherPopulation(t *testing.T) {
	const radiusKm = 200.0

	var wantPop int
	var wantName string
	for _, l := range geo.Localities() {
		if ml.HaversineKm(tandil.Lat, tandil.Lng, l.Lat, l.Lng) <= radiusKm && l.Poblacion > wantPop {
			wantPop = l.Poblacion
			wantName = l.Nombre
		}
	}
	if wantName == "" {
		t.Fatal("dataset has no locality within 200km of Tandil — unexpected")
	}

	best, found := bestLocality(tandil.Lat, tandil.Lng, radiusKm, 0, nil, nil)
	if !found {
		t.Fatal("expected a candidate within 200km")
	}
	if best.Nombre != wantName || best.Poblacion != wantPop {
		t.Errorf("expected most populous %q (%d), got %q (%d)", wantName, wantPop, best.Nombre, best.Poblacion)
	}
}

// TestBestLocality_RespectsRadius verifies candidates beyond the radius are
// excluded.
func TestBestLocality_RespectsRadius(t *testing.T) {
	best, found := bestLocality(tandil.Lat, tandil.Lng, 5.0, 0, nil, nil)
	if !found {
		t.Fatal("expected Tandil itself within 5km")
	}
	if d := ml.HaversineKm(tandil.Lat, tandil.Lng, best.Lat, best.Lng); d > 5.0 {
		t.Errorf("returned locality %q is %.1fkm away, beyond the 5km radius", best.Nombre, d)
	}
}

// TestBestLocality_DangerousZoneExcluded verifies a locality inside an exclusion
// polygon is skipped.
func TestBestLocality_DangerousZoneExcluded(t *testing.T) {
	// A small box around Tandil marks it dangerous; with a 5km radius no other
	// city qualifies, so the result must be "not found".
	zone := []model.LatLng{
		{Lat: -37.5, Lng: -59.4}, {Lat: -37.5, Lng: -58.9},
		{Lat: -37.1, Lng: -58.9}, {Lat: -37.1, Lng: -59.4},
	}
	_, found := bestLocality(tandil.Lat, tandil.Lng, 5.0, 0, nil, [][]model.LatLng{zone})
	if found {
		t.Error("expected Tandil to be excluded by the dangerous zone")
	}
}
