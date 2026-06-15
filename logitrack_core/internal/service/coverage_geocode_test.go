package service

import "testing"

// TestScoreSnapCandidate_ImportanceVsDistance verifies that a real city well
// within the search radius outscores a nearby, unnamed-population village —
// the core "Snap to City" trade-off between settlement importance and
// distance to the geometric gap point.
func TestScoreSnapCandidate_ImportanceVsDistance(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	city := overpassElement{
		Lat: -34.8, Lon: -64.0, // ~89km away
		Tags: map[string]string{"place": "city", "population": "200000"},
	}
	village := overpassElement{
		Lat: -34.0, Lon: -64.0, // at the gap point
		Tags: map[string]string{"place": "village"},
	}

	cityScore := scoreSnapCandidate(city, originLat, originLng)
	villageScore := scoreSnapCandidate(village, originLat, originLng)

	if cityScore <= villageScore {
		t.Errorf("expected a populated city ~89km away (score %.3f) to outscore an adjacent village (score %.3f)", cityScore, villageScore)
	}
}

// TestScoreSnapCandidate_CloserWinsAtSameImportance verifies that, for two
// settlements of the same place type and population, the closer one scores
// higher.
func TestScoreSnapCandidate_CloserWinsAtSameImportance(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	near := overpassElement{Lat: -34.1, Lon: -64.0, Tags: map[string]string{"place": "town", "population": "10000"}}
	far := overpassElement{Lat: -34.9, Lon: -64.0, Tags: map[string]string{"place": "town", "population": "10000"}}

	nearScore := scoreSnapCandidate(near, originLat, originLng)
	farScore := scoreSnapCandidate(far, originLat, originLng)

	if nearScore <= farScore {
		t.Errorf("expected closer town (score %.3f) to outscore farther town (score %.3f)", nearScore, farScore)
	}
}

// TestBestSnapCandidate_SkipsUnnamed verifies that candidates without a
// "name" tag (unusable as a SuggestedCityName) are excluded from selection.
func TestBestSnapCandidate_SkipsUnnamed(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	elements := []overpassElement{
		{Lat: -34.0, Lon: -64.0, Tags: map[string]string{"place": "city", "population": "500000"}}, // unnamed
		{Lat: -34.2, Lon: -64.0, Tags: map[string]string{"place": "village", "name": "Pueblo Chico"}},
	}

	best, found := bestSnapCandidate(elements, originLat, originLng)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "Pueblo Chico" {
		t.Errorf("expected unnamed candidate to be skipped, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_NoneFound verifies the empty/no-candidates case
// reports found=false rather than a zero-value match.
func TestBestSnapCandidate_NoneFound(t *testing.T) {
	if _, found := bestSnapCandidate(nil, -34.0, -64.0); found {
		t.Error("expected found=false for an empty candidate list")
	}

	unnamed := []overpassElement{{Lat: -34.0, Lon: -64.0, Tags: map[string]string{"place": "city"}}}
	if _, found := bestSnapCandidate(unnamed, -34.0, -64.0); found {
		t.Error("expected found=false when no candidate has a name")
	}
}

// TestBestSnapCandidate_PrefersHigherTierEvenIfFarther verifies the place
// hierarchy preference: a "city" near the edge of the search radius is
// selected over a much closer "town" — e.g. Río Gallegos inside a suggested
// branch's coverage circle should win over a tiny nearby village.
func TestBestSnapCandidate_PrefersHigherTierEvenIfFarther(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	city := overpassElement{
		Lat: -34.9, Lon: -64.0, // ~100km away
		Tags: map[string]string{"place": "city", "name": "Río Gallegos", "population": "100000"},
	}
	town := overpassElement{
		Lat: -34.05, Lon: -64.0, // ~5.5km away
		Tags: map[string]string{"place": "town", "name": "Pueblo Cercano", "population": "20000"},
	}

	best, found := bestSnapCandidate([]overpassElement{town, city}, originLat, originLng)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "Río Gallegos" {
		t.Errorf("expected the city tier to be preferred over the closer town, got %q", best.Tags["name"])
	}
}

// TestBestSnapCandidate_FallsBackToLowerTier verifies that when no "city" is
// present, the search falls back to "town", and so on down the hierarchy.
func TestBestSnapCandidate_FallsBackToLowerTier(t *testing.T) {
	originLat, originLng := -34.0, -64.0

	village := overpassElement{Lat: -34.1, Lon: -64.0, Tags: map[string]string{"place": "village", "name": "Villa Chica"}}
	hamlet := overpassElement{Lat: -34.05, Lon: -64.0, Tags: map[string]string{"place": "hamlet", "name": "Caserío"}}

	best, found := bestSnapCandidate([]overpassElement{hamlet, village}, originLat, originLng)
	if !found {
		t.Fatal("expected a candidate to be found")
	}
	if best.Tags["name"] != "Villa Chica" {
		t.Errorf("expected village tier to be preferred over hamlet, got %q", best.Tags["name"])
	}
}
