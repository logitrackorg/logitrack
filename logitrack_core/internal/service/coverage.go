package service

import (
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/ctessum/polyclip-go"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/geometry"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

const (
	coverageEarthRadiusKm = 6371.0

	// Fixed national bounding box for the coverage diagram, so that boundary
	// cells reflect the true uncovered extent of the country rather than a
	// small margin around the current branch network. Approximate extremes of
	// continental Argentina:
	//   Norte (Jujuy):           lat -21.7811
	//   Sur (Tierra del Fuego):  lat -55.0558
	//   Este (Misiones):         lng -53.6386
	//   Oeste (Santa Cruz):      lng -73.5665
	coverageBBoxMinLat = -55.0558
	coverageBBoxMaxLat = -21.7811
	coverageBBoxMinLng = -73.5665
	coverageBBoxMaxLng = -53.6386

	// Thresholds for the coverage simulator (Diagnose): classify the
	// percentage of a branch's real Voronoi area that a simulated new-branch
	// coverage radius would represent.
	simCoverageCriticalPct = 50.0 // < 50%: gap crítico
	simCoverageModeratePct = 85.0 // [50, 85): gap moderado
	simCoverageAdequatePct = 90.0 // [85, 90): gap leve; >= 90: cobertura adecuada

	// coverageSuggestionCircleVertices is the vertex count used to approximate
	// the simulated coverage radius as a polygon for the DIFFERENCE operation
	// against a "crítico" gap cell (Diagnose new-branch suggestions).
	coverageSuggestionCircleVertices = 32

	// coverageSuggestionMinFragmentAreaKm2 is the minimum area an uncovered
	// fragment (cell minus simulated coverage circle) must have to be surfaced
	// as a new-branch suggestion — filters out thin sliver fragments left over
	// from country/cell-boundary clipping noise.
	coverageSuggestionMinFragmentAreaKm2 = 50000.0

	// coverageSuggestionMinSeparationKm is the static floor for the minimum
	// distance between two new-branch suggestions. Neighbouring branches can
	// each detect a "crítico" gap in the same border area and propose
	// near-identical coordinates; the effective separation used is
	// max(simulated coverage radius, this constant) — see dedupeSuggestion.
	coverageSuggestionMinSeparationKm = 150.0
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

	// httpClient is used for the "Snap to City" Overpass lookup (coverage_geocode.go).
	// Nil uses a default client with snapToCityHTTPTimeout — overridable in tests.
	httpClient *http.Client
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

// simulationSeverity classifies the coverage percentage from Diagnose
// (simulated area / real Voronoi area * 100). Returns whether it represents a
// capacity gap and the severity code.
func simulationSeverity(pct float64) (bool, string) {
	switch {
	case pct < simCoverageCriticalPct:
		return true, model.GapSeverityCritico
	case pct < simCoverageModeratePct:
		return true, model.GapSeverityModerado
	case pct < simCoverageAdequatePct:
		return true, model.GapSeverityLeve
	default:
		return false, model.GapSeverityNone
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

	minPt := proj.project(coverageBBoxMinLat, coverageBBoxMinLng)
	maxPt := proj.project(coverageBBoxMaxLat, coverageBBoxMaxLng)
	bbox := geometry.BBox{
		MinX: math.Min(minPt.X, maxPt.X),
		MinY: math.Min(minPt.Y, maxPt.Y),
		MaxX: math.Max(minPt.X, maxPt.X),
		MaxY: math.Max(minPt.Y, maxPt.Y),
	}
	cells := geometry.VoronoiCells(pts, bbox)

	// Clip every cell against Argentina's real outline so that areas and
	// suggested locations never land in the ocean or a neighbouring country.
	// Projected per Refresh since proj is centred on the current branch set.
	country := projectCountry(geo.ArgentinaContour(), proj)

	for i, cell := range cells {
		b := sites[i].branch
		mc := model.CoverageCell{
			BranchID:   b.ID,
			BranchName: b.Name,
			Province:   b.Province,
			Site:       model.LatLng{Lat: *b.Latitude, Lng: *b.Longitude},
		}
		if len(cell) >= 3 {
			fragments := fromPolyclip(toPolyclip(cell).Construct(polyclip.INTERSECTION, country))

			var bestFrag geometry.Polygon
			var bestArea float64
			mc.Polygon = make([][]model.LatLng, 0, len(fragments))
			for _, frag := range fragments {
				area := frag.Area()
				mc.AreaKm2 += area
				if area > bestArea {
					bestArea, bestFrag = area, frag
				}
				ring := make([]model.LatLng, len(frag))
				for j, v := range frag {
					ring[j] = proj.unproject(v)
				}
				mc.Polygon = append(mc.Polygon, ring)
			}

			mc.IsGap, mc.GapSeverity = gapSeverity(mc.AreaKm2, threshold)
			if mc.IsGap && bestArea > 0 {
				// Suggested new-branch location: the centroid of the largest
				// land fragment of the cell worst served by the current
				// network — guaranteed to fall within Argentina's territory.
				c := proj.unproject(bestFrag.Centroid())
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

// Diagnose evaluates a hypothetical new-branch coverage radius — expressed as
// an area in km², chosen via the frontend simulator slider — against every
// branch's real, post-clip Voronoi area.
//
// The simulated radius is modelled as a circle centred on the branch site and
// intersected with the cell's (already country-clipped) Voronoi polygon:
// coveragePercentage = AreaIntersectada / cell.AreaKm2 * 100, where
// AreaIntersectada is the portion of the simulated circle that actually falls
// within this branch's jurisdiction. Using the raw circle area instead would
// let the percentage exceed 100% whenever the circle spills over into a
// neighbouring cell or the ocean — intersecting first guarantees
// AreaIntersectada <= cell.AreaKm2.
//
// A low percentage means the simulated radius would only cover a small
// fraction of the branch's assigned territory, surfaced as a capacity gap
// (crítico/moderado/leve) independent of the admin-configured
// MaxCoverageAreaKm2 threshold used by the main diagram.
func (s *CoverageService) Diagnose(simulatedAreaKm2 float64) model.SimulationResult {
	d := s.Diagram()
	cells := make([]model.SimulationDiagnosis, 0, len(d.Cells))
	var suggestions []model.SuggestedLocation

	// The circle is the same in every cell's site-centred projection (always
	// centred on the origin with this radius), so build it once.
	var circle polyclip.Polygon
	var radiusKm float64
	if simulatedAreaKm2 > 0 {
		radiusKm = math.Sqrt(simulatedAreaKm2 / math.Pi)
		circle = toPolyclip(circlePolygon(radiusKm, coverageSuggestionCircleVertices))
	}

	// Minimum distance between two suggestions: the larger of the simulated
	// coverage radius and a static floor, so neighbouring branches that each
	// flag the same border gap don't produce near-overlapping markers.
	minSeparationKm := radiusKm
	if minSeparationKm < coverageSuggestionMinSeparationKm {
		minSeparationKm = coverageSuggestionMinSeparationKm
	}

	for _, c := range d.Cells {
		var intersectedAreaKm2 float64
		var proj equirectProjector
		var cellPoly polyclip.Polygon
		haveGeometry := simulatedAreaKm2 > 0 && len(c.Polygon) > 0

		if haveGeometry {
			// Project centred on the branch's own site: minimises distortion
			// for this cell's geometry regardless of where it sits in the
			// country, and places the site — and therefore the simulated
			// coverage circle — at the origin.
			proj = newProjector(c.Site.Lat, c.Site.Lng)
			cellPoly = projectRings(c.Polygon, proj)

			intersection := fromPolyclip(cellPoly.Construct(polyclip.INTERSECTION, circle))
			intersectedAreaKm2 = sumArea(intersection)
		}

		var pct float64
		if c.AreaKm2 > 0 {
			pct = (intersectedAreaKm2 / c.AreaKm2) * 100
			if pct > 100 {
				// La intersección es geométricamente un subconjunto de la
				// celda; un resultado > 100% solo puede venir del error de
				// redondeo del recorte de polígonos (polyclip).
				pct = 100
				intersectedAreaKm2 = c.AreaKm2
			}
		}
		isGap, severity := simulationSeverity(pct)
		deficit := c.AreaKm2 - intersectedAreaKm2
		if deficit < 0 {
			deficit = 0
		}
		cells = append(cells, model.SimulationDiagnosis{
			BranchID:           c.BranchID,
			BranchName:         c.BranchName,
			VoronoiAreaKm2:     c.AreaKm2,
			CoveragePercentage: pct,
			DeficitKm2:         deficit,
			IsGap:              isGap,
			Severity:           severity,
		})
		if haveGeometry && severity == model.GapSeverityCritico {
			for _, cand := range suggestLocationsFromDifference(c, proj, cellPoly, circle) {
				if !tooCloseToExisting(cand, suggestions, minSeparationKm) {
					suggestions = append(suggestions, cand)
				}
			}
		}
	}
	return model.SimulationResult{
		SimulatedAreaKm2:   simulatedAreaKm2,
		Cells:              cells,
		SuggestedLocations: suggestions,
	}
}

// tooCloseToExisting reports whether candidate lies within minSeparationKm of
// any suggestion already collected. Used to spatially deduplicate
// suggestions raised independently by neighbouring gap cells, which often
// point at the same underserved border area.
func tooCloseToExisting(candidate model.SuggestedLocation, existing []model.SuggestedLocation, minSeparationKm float64) bool {
	for _, s := range existing {
		if ml.HaversineKm(candidate.Lat, candidate.Lng, s.Lat, s.Lng) < minSeparationKm {
			return true
		}
	}
	return false
}

// suggestLocationsFromDifference computes new-branch location suggestions for
// a single "crítico" gap cell. It subtracts the simulated coverage circle
// (already projected, centred on the branch site at the origin) from the
// cell's Voronoi polygon via DIFFERENCE, and for every remaining fragment
// large enough to be relevant, picks the vertex farthest from the branch site
// — see farthestVertex for why.
func suggestLocationsFromDifference(cell model.CoverageCell, proj equirectProjector, cellPoly, circle polyclip.Polygon) []model.SuggestedLocation {
	remainder := fromPolyclip(cellPoly.Construct(polyclip.DIFFERENCE, circle))

	var out []model.SuggestedLocation
	for _, frag := range remainder {
		area := frag.Area()
		if area < coverageSuggestionMinFragmentAreaKm2 {
			continue
		}
		out = append(out, model.SuggestedLocation{
			LatLng:     proj.unproject(farthestVertex(frag)),
			BranchID:   cell.BranchID,
			BranchName: cell.BranchName,
			GapAreaKm2: area,
		})
	}
	return out
}

// farthestVertex returns the vertex of poly with the greatest Euclidean
// distance from the origin. Callers project poly so that the reference point
// (the branch site) sits at the origin.
//
// DIFFERENCE (Voronoi cell minus simulated coverage circle) typically leaves a
// concave "crescent" fragment. Its area-weighted Centroid() can land outside
// the fragment entirely — back inside the subtracted circle, i.e. inside the
// zone already covered. The farthest vertex from the site is always a real
// vertex of the fragment, sitting on its outer boundary: the point of the gap
// most disconnected from the current network.
func farthestVertex(poly geometry.Polygon) geometry.Point {
	origin := geometry.Point{}
	best := poly[0]
	bestDist := geometry.Dist2(origin, best)
	for _, v := range poly[1:] {
		if d := geometry.Dist2(origin, v); d > bestDist {
			bestDist = d
			best = v
		}
	}
	return best
}

// sumArea returns the total area of a set of polygon fragments.
func sumArea(frags []geometry.Polygon) float64 {
	var total float64
	for _, f := range frags {
		total += f.Area()
	}
	return total
}
