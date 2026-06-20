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

	// Phase 4 auto-snapping: the following fields are populated server-side
	// for MathematicalSuggestions only. Per-cell SuggestedLocations leave
	// these empty (client-side snap-to-city handles those via the "Aterrizar"
	// button). When IsSnapped is false the coordinates are the raw
	// mathematical Pole-of-Inaccessibility; when true they are the city's
	// real lat/lng.
	CityName   string `json:"city_name,omitempty"`
	IsSnapped  bool   `json:"is_snapped,omitempty"`
	Population int    `json:"population,omitempty"`

	// Density is the population density of the snapped city expressed as
	// inhabitants per km² of the Voronoi cell area. Only populated in
	// "density" diagnostic mode.
	Density float64 `json:"density,omitempty"`

	// HasIndustrialZone is true when an OSM "landuse=industrial" area exists
	// within ~10 km of this suggestion. Set by density-mode scoring when
	// PrioritizeIndustrial is enabled; always false otherwise.
	HasIndustrialZone bool `json:"has_industrial_zone,omitempty"`

	// TerrainType is a human-readable label describing the topographic
	// character of the suggestion's location (e.g. "Llano", "Serrano",
	// "Montañoso"). Set by density-mode scoring when ApplyTerrainFriction is
	// enabled; empty otherwise.
	TerrainType string `json:"terrain_type,omitempty"`
}

// SimulationResult is the response of CoverageService.Diagnose: the per-branch
// diagnosis for a single simulated coverage area, plus any new-branch location
// suggestions derived from "crítico" gaps.
type SimulationResult struct {
	SimulatedAreaKm2   float64               `json:"simulated_area_km2"`
	Cells              []SimulationDiagnosis `json:"cells"`
	SuggestedLocations []SuggestedLocation   `json:"suggested_locations"`

	// MathematicalSuggestions are Pole-of-Inaccessibility points derived from
	// the global uncovered void: (TierraFértil − ∪ coverage circles). Unlike
	// SuggestedLocations (which are per-cell and per-fragment), these come from
	// the single united uncovered area so they never cluster around cell
	// boundaries and require no deduplication. Empty when no dangerous zones
	// are active and all cells are within the simulated radius, or when no
	// simulation area has been set.
	MathematicalSuggestions []SuggestedLocation `json:"mathematical_suggestions,omitempty"`

	// DiagramCells carries the Voronoi cells (with polygon geometry) that were
	// used for this diagnosis run. The frontend uses these to redraw the map
	// with the correct shapes after branches are excluded from the simulation.
	// Omitted when no branches are excluded (client already has the diagram).
	DiagramCells []CoverageCell `json:"diagram_cells,omitempty"`
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

// DensityOptions groups all density-mode–specific parameters for Diagnose and
// related service functions, keeping function signatures manageable as new
// density options are added.
type DensityOptions struct {
	// MinPopulation filters snap candidates: only cities with at least this
	// many inhabitants are eligible. 0 = no filter.
	MinPopulation int `json:"min_population,omitempty"`

	// MinDensity filters candidates after snapping: only cities whose computed
	// density (population / uncovered_fragment_area, hab./km²) meets this
	// threshold are returned. 0 = no filter.
	MinDensity float64 `json:"min_density,omitempty"`

	// RankingMode controls the final sort of density-mode suggestions:
	//   "population" (default) — sort by absolute population descending
	//                            (most under-served urban areas first).
	//   "gap_area"             — sort by uncovered fragment area descending
	//                            (largest geographic voids first).
	RankingMode string `json:"ranking_mode,omitempty"`

	// ExcludedCities are city names from previous diagnoses that the snap
	// step must skip, so "Buscar más" returns genuinely new locations.
	ExcludedCities []string `json:"excluded_cities,omitempty"`

	// AdditionalSites are coordinates of already-placed suggestions (from
	// previous "Buscar más" rounds). Their coverage circles are subtracted
	// from cell remainders before new candidates are computed.
	AdditionalSites []LatLng `json:"additional_sites,omitempty"`

	// PrioritizeIndustrial, when true, applies a 1.3× multiplier to the
	// final score of candidates that have an OSM "landuse=industrial" area
	// within 10 km, making them rank higher than equally-populated residential
	// candidates.
	PrioritizeIndustrial bool `json:"prioritize_industrial,omitempty"`

	// ApplyTerrainFriction, when true, divides each candidate's score by a
	// friction factor derived from its topographic position in Argentina
	// (1.0 = flat Pampas, up to 1.5 = Andes). Candidates in difficult terrain
	// rank lower even when their population density is high.
	ApplyTerrainFriction bool `json:"apply_terrain_friction,omitempty"`
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
	// minimum 3) drawn by the user on the map or loaded from a saved region.
	// When provided, Voronoi cells are clipped against this polygon instead of
	// Argentina's national outline, so the diagnosis and new-branch suggestions
	// are restricted to the selected region (e.g. AMBA, a specific province).
	CustomBoundingArea []LatLng `json:"custom_bounding_area,omitempty"`

	// DangerousZones is an optional list of polygons representing restricted or
	// undesirable areas (e.g. flood zones, border strips, nature reserves) that
	// should be excluded from branch placement. Each polygon must have at least
	// 3 vertices. The zones are subtracted from CustomBoundingArea (or from
	// Argentina's national outline when no boundary is set) via a DIFFERENCE
	// operation before the Voronoi diagram is built — the resulting "Tierra
	// Fértil" is used as the clipping canvas for both the Voronoi cells and the
	// MathematicalSuggestions Pole-of-Inaccessibility search.
	DangerousZones [][]LatLng `json:"dangerous_zones,omitempty"`

	// IncludeInactive, when true, includes branches with status "inactivo" or
	// "fuera_de_servicio" in the Voronoi computation — the "Incluir sucursales
	// Inactivas/Fuera de servicio en la simulación" toggle in the frontend.
	IncludeInactive bool `json:"include_inactive,omitempty"`

	// MaxSuggestions caps the number of MathematicalSuggestions returned.
	// 0 means no limit (natural bound from coverageSuggestionMaxPerFragment).
	MaxSuggestions int `json:"max_suggestions,omitempty"`

	// SnapToCities, when true, resolves MathematicalSuggestions to the nearest
	// real populated place (Overpass API) before returning. Default false keeps
	// the diagnosis fast; the frontend can snap client-side via POST
	// /coverage/snap-to-city when the user explicitly requests it.
	SnapToCities bool `json:"snap_to_cities,omitempty"`

	// Mode controls the suggestion ranking strategy:
	//   "area"    (default) ranks by Voronoi cell area — geographic gaps.
	//   "density" ranks by population density (hab./km²) so that
	//             under-served urban areas surface above vast rural cells.
	Mode string `json:"mode,omitempty"`

	// Density groups all density-mode–specific options. Fields are ignored
	// when Mode != "density".
	Density DensityOptions `json:"density,omitempty"`
}

// ProjectionRequest is the body of POST /coverage/project: the simulated
// coverage area (used to size every site's coverage radius, including the
// new candidates) and the candidate new-branch locations currently active in
// the frontend simulator.
type ProjectionRequest struct {
	AreaKm2     float64  `json:"area_km2"`
	Suggestions []LatLng `json:"suggestions"`

	// CustomBoundingArea scopes the projection to a region (same semantics as
	// DiagnoseRequest): both the current and projected Voronoi cells are clipped
	// against this polygon instead of Argentina's national outline, so the
	// coverage percentages reflect the selected zone (e.g. AMBA) rather than the
	// national territory. Empty/nil = national scope.
	CustomBoundingArea []LatLng `json:"custom_bounding_area,omitempty"`

	// DangerousZones are exclusion polygons subtracted from the boundary before
	// the Voronoi diagram is built (same semantics as DiagnoseRequest).
	DangerousZones [][]LatLng `json:"dangerous_zones,omitempty"`
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
