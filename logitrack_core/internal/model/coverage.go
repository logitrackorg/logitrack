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

// SimulationResult is the response of CoverageService.Diagnose: the per-branch
// diagnosis for a single simulated coverage area.
type SimulationResult struct {
	SimulatedAreaKm2 float64                `json:"simulated_area_km2"`
	Cells            []SimulationDiagnosis  `json:"cells"`
}
