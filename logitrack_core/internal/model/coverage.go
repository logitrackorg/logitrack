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
