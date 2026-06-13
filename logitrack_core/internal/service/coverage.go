package service

import (
	"math"
	"sort"
	"sync"
	"time"

	"github.com/logitrack/core/internal/geometry"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

const (
	coverageEarthRadiusKm = 6371.0

	// coverageBBoxMarginKm pads the bounding box derived from the branch sites so
	// that boundary cells get a finite, sensible extent instead of being clipped
	// tight against the outermost branch. It bounds how far a branch is
	// considered to "cover" outward into empty territory.
	coverageBBoxMarginKm = 80.0
)

// coverageConfigProvider supplies the configurable coverage threshold. Both
// *SystemConfigService and SystemConfigRepository satisfy it.
type coverageConfigProvider interface {
	Get() model.SystemConfig
}

// CoverageService computes the branch coverage diagram (Voronoi service areas)
// from the active branch set, classifying each cell as a coverage gap when its
// area exceeds the configured threshold. The result is cached in memory and
// recomputed on demand via Refresh; the geometry is cheap (a handful of
// branches) so callers may refresh freely.
type CoverageService struct {
	branchRepo repository.BranchRepository
	cfg        coverageConfigProvider

	mu      sync.RWMutex
	diagram *model.CoverageDiagram
}

// NewCoverageService wires the service. Call Refresh once at startup (and after
// branch or config mutations) to populate the cached diagram.
func NewCoverageService(branchRepo repository.BranchRepository, cfg coverageConfigProvider) *CoverageService {
	return &CoverageService{branchRepo: branchRepo, cfg: cfg}
}

// gapSeverity classifies a cell area against the threshold. Returns whether the
// cell is a gap and the severity code.
func gapSeverity(areaKm2, threshold float64) (bool, string) {
	if threshold <= 0 || areaKm2 <= threshold {
		return false, model.GapSeverityNone
	}
	switch {
	case areaKm2 > 4*threshold:
		return true, model.GapSeverityCritico
	case areaKm2 > 2*threshold:
		return true, model.GapSeverityModerado
	default:
		return true, model.GapSeverityLeve
	}
}

// equirectProjector projects geographic coordinates to a local planar frame in
// kilometres, centred on a reference latitude. Accurate for regional extents
// (a country or less), which is all the coverage detector needs.
type equirectProjector struct {
	lat0Rad float64
	lng0Rad float64
	cosLat0 float64
}

func newProjector(lat0, lng0 float64) equirectProjector {
	lat0Rad := lat0 * math.Pi / 180
	return equirectProjector{
		lat0Rad: lat0Rad,
		lng0Rad: lng0 * math.Pi / 180,
		cosLat0: math.Cos(lat0Rad),
	}
}

func (p equirectProjector) project(lat, lng float64) geometry.Point {
	latRad := lat * math.Pi / 180
	lngRad := lng * math.Pi / 180
	return geometry.Point{
		X: coverageEarthRadiusKm * (lngRad - p.lng0Rad) * p.cosLat0,
		Y: coverageEarthRadiusKm * (latRad - p.lat0Rad),
	}
}

func (p equirectProjector) unproject(pt geometry.Point) model.LatLng {
	latRad := pt.Y/coverageEarthRadiusKm + p.lat0Rad
	lngRad := pt.X/(coverageEarthRadiusKm*p.cosLat0) + p.lng0Rad
	return model.LatLng{
		Lat: latRad * 180 / math.Pi,
		Lng: lngRad * 180 / math.Pi,
	}
}

// coverageSite pairs a branch with its projected planar location.
type coverageSite struct {
	branch model.Branch
	point  geometry.Point
}

// Refresh recomputes the coverage diagram from the current active branches and
// caches it. Branches without coordinates are skipped. Each cell is classified
// as a coverage gap when its area exceeds the configured threshold, and gap
// cells carry a suggested new-branch location (their centroid). Returns the
// diagram.
func (s *CoverageService) Refresh() *model.CoverageDiagram {
	branches := s.branchRepo.ListActive()

	threshold := 0.0
	if s.cfg != nil {
		threshold = s.cfg.Get().MaxCoverageAreaKm2
	}

	// Keep only branches with coordinates; dedupe coincident sites defensively.
	var withCoords []model.Branch
	for _, b := range branches {
		if b.Latitude != nil && b.Longitude != nil {
			withCoords = append(withCoords, b)
		}
	}

	diagram := &model.CoverageDiagram{
		ThresholdKm2: threshold,
		BranchCount:  len(withCoords),
		ComputedAt:   time.Now(),
	}

	if len(withCoords) == 0 {
		s.store(diagram)
		return diagram
	}

	// Reference latitude = mean of the sites (minimises projection distortion).
	var sumLat, sumLng float64
	for _, b := range withCoords {
		sumLat += *b.Latitude
		sumLng += *b.Longitude
	}
	proj := newProjector(sumLat/float64(len(withCoords)), sumLng/float64(len(withCoords)))

	sites := make([]coverageSite, len(withCoords))
	pts := make([]geometry.Point, len(withCoords))
	for i, b := range withCoords {
		p := proj.project(*b.Latitude, *b.Longitude)
		sites[i] = coverageSite{branch: b, point: p}
		pts[i] = p
	}

	bbox := boundingBox(pts).Pad(coverageBBoxMarginKm)
	cells := geometry.VoronoiCells(pts, bbox)

	for i, cell := range cells {
		b := sites[i].branch
		mc := model.CoverageCell{
			BranchID:   b.ID,
			BranchName: b.Name,
			Province:   b.Province,
			Site:       model.LatLng{Lat: *b.Latitude, Lng: *b.Longitude},
		}
		if len(cell) >= 3 {
			mc.AreaKm2 = cell.Area()
			mc.Polygon = make([]model.LatLng, len(cell))
			for j, v := range cell {
				mc.Polygon[j] = proj.unproject(v)
			}
			mc.IsGap, mc.GapSeverity = gapSeverity(mc.AreaKm2, threshold)
			if mc.IsGap {
				// Suggested new-branch location: the point of the cell worst
				// served by the current network (its centroid).
				c := proj.unproject(cell.Centroid())
				mc.Suggestion = &c
				diagram.GapCount++
			}
		}
		diagram.Cells = append(diagram.Cells, mc)
		diagram.TotalAreaKm2 += mc.AreaKm2
	}

	// Stable ordering: largest cells first (most likely to be gaps), then by ID.
	sort.SliceStable(diagram.Cells, func(i, j int) bool {
		if diagram.Cells[i].AreaKm2 != diagram.Cells[j].AreaKm2 {
			return diagram.Cells[i].AreaKm2 > diagram.Cells[j].AreaKm2
		}
		return diagram.Cells[i].BranchID < diagram.Cells[j].BranchID
	})

	s.store(diagram)
	return diagram
}

// BranchForPoint returns the ID of the branch whose Voronoi cell contains the
// given coordinate — i.e. the nearest active branch. This is the assignment
// rule behind point-in-polygon cell containment, computed directly as the
// nearest projected site so it is robust on cell boundaries.
//
// Tie-breaking (US-09): when a point is equidistant to two or more branches
// (it lies exactly on a coverage boundary), the branch with the lexicographically
// smallest ID wins, giving a deterministic assignment. Returns ("", false) when
// there are no active branches with coordinates.
func (s *CoverageService) BranchForPoint(lat, lng float64) (string, bool) {
	branches := s.branchRepo.ListActive()
	var withCoords []model.Branch
	var sumLat, sumLng float64
	for _, b := range branches {
		if b.Latitude != nil && b.Longitude != nil {
			withCoords = append(withCoords, b)
			sumLat += *b.Latitude
			sumLng += *b.Longitude
		}
	}
	if len(withCoords) == 0 {
		return "", false
	}

	proj := newProjector(sumLat/float64(len(withCoords)), sumLng/float64(len(withCoords)))
	target := proj.project(lat, lng)

	bestID := ""
	bestDist := math.Inf(1)
	for _, b := range withCoords {
		d := geometry.Dist2(target, proj.project(*b.Latitude, *b.Longitude))
		// Strict improvement wins; exact ties broken by lexicographic ID.
		if d < bestDist-1e-9 || (math.Abs(d-bestDist) <= 1e-9 && (bestID == "" || b.ID < bestID)) {
			bestDist = d
			bestID = b.ID
		}
	}
	return bestID, true
}

// CoverageForPoint returns the coverage cell of the branch that serves the
// given coordinate, so callers (e.g. the new-shipment form) can both recommend
// the optimal branch and warn when the destination falls in an under-covered
// zone. Returns (_, false) when there are no active branches with coordinates.
func (s *CoverageService) CoverageForPoint(lat, lng float64) (model.CoverageCell, bool) {
	branchID, ok := s.BranchForPoint(lat, lng)
	if !ok {
		return model.CoverageCell{}, false
	}
	d := s.Refresh()
	for _, cell := range d.Cells {
		if cell.BranchID == branchID {
			return cell, true
		}
	}
	return model.CoverageCell{}, false
}

// Diagram returns the last computed diagram, recomputing on first access.
func (s *CoverageService) Diagram() *model.CoverageDiagram {
	s.mu.RLock()
	d := s.diagram
	s.mu.RUnlock()
	if d == nil {
		return s.Refresh()
	}
	return d
}

func (s *CoverageService) store(d *model.CoverageDiagram) {
	s.mu.Lock()
	s.diagram = d
	s.mu.Unlock()
}

func boundingBox(pts []geometry.Point) geometry.BBox {
	b := geometry.BBox{
		MinX: math.Inf(1), MinY: math.Inf(1),
		MaxX: math.Inf(-1), MaxY: math.Inf(-1),
	}
	for _, p := range pts {
		b.MinX = math.Min(b.MinX, p.X)
		b.MinY = math.Min(b.MinY, p.Y)
		b.MaxX = math.Max(b.MaxX, p.X)
		b.MaxY = math.Max(b.MaxY, p.Y)
	}
	return b
}
