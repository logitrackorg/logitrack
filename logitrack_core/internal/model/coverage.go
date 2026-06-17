package model

import "time"

// Gap severity codes for a branch coverage cell. Empty means the cell is within
// the configured coverage threshold (no gap).
const (
	GapSeverityNone     = ""
	GapSeverityLeve     = "leve"
	GapSeverityModerado = "moderado"
	GapSeverityCritico  = "critico"
)

// CoverageCell is the Voronoi service area of a single branch: the region of
// the territory for which that branch is the nearest one. Geometry is expressed
// in geographic coordinates (lat/lng); AreaKm2 is computed on a planar metric
// projection so it is a real surface area in square kilometres.
type CoverageCell struct {
	BranchID   string  `json:"branch_id"`
	BranchName string  `json:"branch_name"`
	Province   string  `json:"province"`
	Site       LatLng  `json:"site"`     // the branch location (the Voronoi seed)
	AreaKm2    float64 `json:"area_km2"` // surface area of the cell, post-clip

	// Polygon holds the cell's geometry after clipping against Argentina's
	// national outline: one closed ring per disconnected land fragment (e.g. a
	// cell may cover both the mainland and part of Tierra del Fuego). Each
	// inner slice is a closed ring in geographic coordinates.
	Polygon [][]LatLng `json:"polygon"`

	// Gap classification (populated from the configured threshold).
	IsGap       bool   `json:"is_gap"`
	GapSeverity string `json:"gap_severity"`

	// Suggestion is a recommended location for a new branch when this cell is a
	// gap — the cell centroid, i.e. the point worst served by the current
	// network. Nil when the cell is not a gap.
	Suggestion *LatLng `json:"suggestion,omitempty"`
}

// CoverageDiagram is the full coverage computation over the active branch set.
type CoverageDiagram struct {
	Cells        []CoverageCell `json:"cells"`
	ThresholdKm2 float64        `json:"threshold_km2"` // max_coverage_area_km2 used
	TotalAreaKm2 float64        `json:"total_area_km2"`
	BranchCount  int            `json:"branch_count"`
	GapCount     int            `json:"gap_count"`
	ComputedAt   time.Time      `json:"computed_at"`
}

// SimulationDiagnosis is the result, for a single branch, of comparing a
// hypothetical new-branch coverage radius (an area in km², chosen via the
// frontend simulator slider) against this branch's real, post-clip Voronoi
// cell area: CoveragePercentage = simulated area / VoronoiAreaKm2 * 100. A low
// percentage means the simulated radius would only cover a small fraction of
// the branch's assigned territory — a capacity gap distinct from the
// area-vs-threshold gaps in CoverageCell.
type SimulationDiagnosis struct {
	BranchID           string  `json:"branch_id"`
	BranchName         string  `json:"branch_name"`
	VoronoiAreaKm2     float64 `json:"voronoi_area_km2"`
	CoveragePercentage float64 `json:"coverage_percentage"`
	DeficitKm2         float64 `json:"deficit_km2"`
	IsGap              bool    `json:"is_gap"`
	Severity           string  `json:"severity"`
}

// SuggestedLocation is a recommended coordinate for a new branch, derived from
// a fragment of an existing branch's Voronoi cell that the simulated coverage
// radius would leave unserved (cell minus simulated coverage circle). Only
// fragments large enough to be relevant are surfaced — see
// coverageSuggestionMinFragmentAreaKm2 in internal/service/coverage.go.
type SuggestedLocation struct {
	LatLng
	BranchID   string  `json:"branch_id"`   // cell whose uncovered fragment produced this suggestion
	BranchName string  `json:"branch_name"`
	GapAreaKm2 float64 `json:"gap_area_km2"` // area of the uncovered fragment

	// ActualAddedKm2 is the area of the simulated coverage circle centred on
	// this suggestion, intersected with Argentina's national outline — the
	// real net surface coverage a new branch here would add.
	ActualAddedKm2 float64 `json:"actual_added_km2"`

	// AffectedBranches lists the names of existing branches whose Voronoi
	// cells intersect this suggestion's simulated coverage circle — the
	// branches that would be relieved by a new branch at this location.
	AffectedBranches []string `json:"affected_branches"`
}

// SimulationResult is the response of CoverageService.Diagnose: the per-branch
// diagnosis for a single simulated coverage area, plus any new-branch location
// suggestions derived from "crítico" gaps.
type SimulationResult struct {
	SimulatedAreaKm2   float64              `json:"simulated_area_km2"`
	Cells              []SimulationDiagnosis `json:"cells"`
	SuggestedLocations []SuggestedLocation   `json:"suggested_locations"`
}

// SnappedCity is the result of "Snap to City": resolving a geometric
// coverage-gap point to the nearest real populated place (OSM Overpass)
// within the search radius, so new-branch suggestions land on viable
// locations instead of empty terrain. Snapped is false when no populated
// place was found within the search radius — callers should keep the
// original geometric point in that case.
type SnappedCity struct {
	LatLng
	CityName    string `json:"city_name"`
	Snapped     bool   `json:"is_snapped"`
	Population  int    `json:"population,omitempty"`  // effective population used for selection; 0 when Snapped=false
	ErrorReason string `json:"error_reason,omitempty"` // "TIMEOUT" | "NO_RESULTS"; only when Snapped=false
}

// SnapToCityRequest is the body of POST /coverage/snap-to-city: the geometric
// points (typically SuggestedLocation coordinates) to resolve, in order.
type SnapToCityRequest struct {
	Points []LatLng `json:"points"`

	// RadiusKm is the search radius around each point, in km — typically the
	// simulated coverage circle's radius, so a populated place anywhere within
	// the would-be branch's coverage area can be snapped to. <= 0 falls back
	// to a default radius.
	RadiusKm float64 `json:"radius_km"`

	// MinPopulation is an optional lower bound on the population of the
	// snapped city. Candidates whose population (from OSM tag, or a
	// per-place-type fallback) is strictly below this value are discarded
	// before scoring. 0 disables the filter (all candidates are considered).
	MinPopulation int `json:"min_population"`

	// BlacklistedCities is an optional list of city names to exclude from
	// candidate selection — allows the frontend to retry a point with
	// different results after the user discards a previously-returned city.
	// Empty or nil disables the filter.
	BlacklistedCities []string `json:"blacklisted_cities,omitempty"`
}

// SnapToCityResponse pairs each input point with its SnappedCity result,
// preserving the request order so the frontend can merge by index.
type SnapToCityResponse struct {
	Results []SnappedCity `json:"results"`
}

// DiagnoseRequest is the body of POST /coverage/diagnose: parameters for the
// coverage simulator's "Confirmar y Diagnosticar" action.
type DiagnoseRequest struct {
	// AreaKm2 is the simulated coverage radius expressed as an area in km²
	// (the slider value from the frontend simulator panel).
	AreaKm2 float64 `json:"area_km2"`

	// ExcludedBranchIDs is an optional list of branch IDs to remove from the
	// Voronoi computation before diagnosing — the "Simulador de cierre de
	// sucursales" feature.
	ExcludedBranchIDs []string `json:"excluded_branch_ids,omitempty"`

	// CustomBoundingArea is an optional polygon (ordered lat/lng vertices,
	// minimum 3) drawn by the user on the map. When provided, Voronoi cells
	// are clipped against this polygon instead of Argentina's national outline,
	// so the diagnosis and new-branch suggestions are restricted to the drawn
	// region (e.g. AMBA, a specific province).
	CustomBoundingArea []LatLng `json:"custom_bounding_area,omitempty"`
}

// ProjectionRequest is the body of POST /coverage/project: the simulated
// coverage area (used to size every site's coverage radius, including the
// new candidates) and the candidate new-branch locations currently active in
// the frontend simulator.
type ProjectionRequest struct {
	AreaKm2     float64  `json:"area_km2"`
	Suggestions []LatLng `json:"suggestions"`
}

// BranchProjection compares an existing branch's current coverage percentage
// (from CoverageService.Diagnose) against the percentage it would have if the
// network also included the candidate locations from ProjectionRequest.
type BranchProjection struct {
	BranchID             string  `json:"branch_id"`
	BranchName           string  `json:"branch_name"`
	CurrentCoveragePct   float64 `json:"current_coverage_pct"`
	ProjectedCoveragePct float64 `json:"projected_coverage_pct"`
}

// ProjectionResult is the response of CoverageService.ProjectScenario.
type ProjectionResult struct {
	Branches []BranchProjection `json:"branches"`
}
