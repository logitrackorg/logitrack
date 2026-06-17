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

	// coverageSuggestionGridSteps is the resolution of the grid-search
	// ("Pole of Inaccessibility") heuristic used to place a new-branch
	// suggestion inside an uncovered fragment: a
	// (coverageSuggestionGridSteps+1) x (coverageSuggestionGridSteps+1) grid
	// over the fragment's bounding box.
	coverageSuggestionGridSteps = 30

	// coverageSuggestionMaxPerFragment caps how many suggestions the
	// iterative greedy-covering loop (fillFragmentIteratively) can place
	// inside a single uncovered fragment, regardless of how large it is —
	// a safety bound against pathological/degenerate geometry producing an
	// unbounded loop.
	coverageSuggestionMaxPerFragment = 4
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
// customBoundary, when non-nil and at least 3 points, clips the Voronoi cells
// against the drawn polygon instead of Argentina's national outline, so the
// diagnosis is restricted to the user-drawn region (e.g. AMBA, a province).
// A nil/empty slice uses the cached national-boundary diagram.
func (s *CoverageService) Diagnose(simulatedAreaKm2 float64, customBoundary []model.LatLng) model.SimulationResult {
	if len(customBoundary) >= 3 {
		branches := s.branchRepo.ListActive()
		var sites []voronoiSite
		for _, b := range branches {
			if b.Latitude == nil || b.Longitude == nil {
				continue
			}
			sites = append(sites, voronoiSite{
				branchID:   b.ID,
				branchName: b.Name,
				province:   b.Province,
				lat:        *b.Latitude,
				lng:        *b.Longitude,
			})
		}
		return s.diagnoseWithCells(simulatedAreaKm2, s.buildVoronoiCells(sites, customBoundary), customBoundary)
	}
	return s.diagnoseWithCells(simulatedAreaKm2, s.Diagram().Cells, nil)
}

// DiagnoseExcluding is like Diagnose but recomputes the Voronoi diagram after
// removing the listed branch IDs — the "Simulador de cierre de sucursales"
// feature. An empty slice is equivalent to calling Diagnose directly.
// customBoundary follows the same semantics as in Diagnose.
func (s *CoverageService) DiagnoseExcluding(simulatedAreaKm2 float64, excludedBranchIDs []string, customBoundary []model.LatLng) model.SimulationResult {
	if len(excludedBranchIDs) == 0 {
		return s.Diagnose(simulatedAreaKm2, customBoundary)
	}
	excluded := make(map[string]bool, len(excludedBranchIDs))
	for _, id := range excludedBranchIDs {
		excluded[id] = true
	}
	branches := s.branchRepo.ListActive()
	var sites []voronoiSite
	for _, b := range branches {
		if b.Latitude == nil || b.Longitude == nil || excluded[b.ID] {
			continue
		}
		sites = append(sites, voronoiSite{
			branchID:   b.ID,
			branchName: b.Name,
			province:   b.Province,
			lat:        *b.Latitude,
			lng:        *b.Longitude,
		})
	}
	return s.diagnoseWithCells(simulatedAreaKm2, s.buildVoronoiCells(sites, customBoundary), customBoundary)
}

// diagnoseWithCells is the core diagnosis logic shared by Diagnose and
// DiagnoseExcluding. coverageCells is the set of Voronoi cells to evaluate —
// either the cached diagram (Diagnose) or a freshly-computed filtered set
// (DiagnoseExcluding). customBoundary, when non-nil, is used as the clipping
// polygon for suggestion placement instead of Argentina's national outline.
func (s *CoverageService) diagnoseWithCells(simulatedAreaKm2 float64, coverageCells []model.CoverageCell, customBoundary []model.LatLng) model.SimulationResult {
	diagCells := make([]model.SimulationDiagnosis, 0, len(coverageCells))
	suggestions := make([]model.SuggestedLocation, 0)

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

	// All active branch sites, used by the grid-search heuristic below to
	// push suggestions away from already-covered areas (see bestInteriorPoint).
	branchSites := make([]model.LatLng, len(coverageCells))
	for i, c := range coverageCells {
		branchSites[i] = c.Site
	}

	for _, c := range coverageCells {
		var intersectedAreaKm2 float64
		var proj equirectProjector
		var cellPoly polyclip.Polygon
		haveGeometry := simulatedAreaKm2 > 0 && len(c.Polygon) > 0

		var countryLocal polyclip.Polygon
		var otherCellsLocal []namedCellPoly

		if haveGeometry {
			// Project centred on the branch's own site: minimises distortion
			// for this cell's geometry regardless of where it sits in the
			// country, and places the site — and therefore the simulated
			// coverage circle — at the origin.
			proj = newProjector(c.Site.Lat, c.Site.Lng)
			cellPoly = projectRings(c.Polygon, proj)

			intersection := fromPolyclip(cellPoly.Construct(polyclip.INTERSECTION, circle))
			intersectedAreaKm2 = sumArea(intersection)

			if len(customBoundary) >= 3 {
				countryLocal = projectRings([][]model.LatLng{customBoundary}, proj)
			} else {
				countryLocal = projectCountry(geo.ArgentinaContour(), proj)
			}
			otherCellsLocal = projectCellsLocal(coverageCells, proj)
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
		diagCells = append(diagCells, model.SimulationDiagnosis{
			BranchID:           c.BranchID,
			BranchName:         c.BranchName,
			VoronoiAreaKm2:     c.AreaKm2,
			CoveragePercentage: pct,
			DeficitKm2:         deficit,
			IsGap:              isGap,
			Severity:           severity,
		})
		if haveGeometry && severity == model.GapSeverityCritico {
			for _, cand := range suggestLocationsFromDifference(c, proj, cellPoly, circle, radiusKm, branchSites, countryLocal, otherCellsLocal) {
				if !tooCloseToExisting(cand, suggestions, minSeparationKm) {
					suggestions = append(suggestions, cand)
				}
			}
		}
	}
	return model.SimulationResult{
		SimulatedAreaKm2:   simulatedAreaKm2,
		Cells:              diagCells,
		SuggestedLocations: suggestions,
	}
}

// voronoiSite is a generic Voronoi seed for buildVoronoiCells: either an
// existing branch (branchID non-empty) or a candidate new-branch suggestion
// (branchID empty).
type voronoiSite struct {
	branchID   string
	branchName string
	province   string
	lat        float64
	lng        float64
}

// buildVoronoiCells runs the same Voronoi-diagram + country-clip pipeline as
// Refresh, but over an arbitrary set of sites instead of the active branch
// set — used by DiagnoseExcluding and ProjectScenario. Returns one CoverageCell
// per site, in the same order as sites. customBoundary replaces Argentina's
// national outline as the clipping polygon when non-nil (≥3 points).
func (s *CoverageService) buildVoronoiCells(sites []voronoiSite, customBoundary []model.LatLng) []model.CoverageCell {
	if len(sites) == 0 {
		return nil
	}

	var sumLat, sumLng float64
	for _, site := range sites {
		sumLat += site.lat
		sumLng += site.lng
	}
	proj := newProjector(sumLat/float64(len(sites)), sumLng/float64(len(sites)))

	pts := make([]geometry.Point, len(sites))
	for i, site := range sites {
		pts[i] = proj.project(site.lat, site.lng)
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

	var country polyclip.Polygon
	if len(customBoundary) >= 3 {
		country = projectRings([][]model.LatLng{customBoundary}, proj)
	} else {
		country = projectCountry(geo.ArgentinaContour(), proj)
	}

	out := make([]model.CoverageCell, len(cells))
	for i, cell := range cells {
		site := sites[i]
		mc := model.CoverageCell{
			BranchID:   site.branchID,
			BranchName: site.branchName,
			Province:   site.province,
			Site:       model.LatLng{Lat: site.lat, Lng: site.lng},
		}
		if len(cell) >= 3 {
			fragments := fromPolyclip(toPolyclip(cell).Construct(polyclip.INTERSECTION, country))
			mc.Polygon = make([][]model.LatLng, 0, len(fragments))
			for _, frag := range fragments {
				area := frag.Area()
				mc.AreaKm2 += area
				ring := make([]model.LatLng, len(frag))
				for j, v := range frag {
					ring[j] = proj.unproject(v)
				}
				mc.Polygon = append(mc.Polygon, ring)
			}
		}
		out[i] = mc
	}
	return out
}

// coveragePercentageForCell computes the same "simulated coverage circle
// intersected with the cell" percentage as Diagnose's per-cell loop, for an
// arbitrary cell and radius. Used by ProjectScenario to score the projected
// cells from buildVoronoiCells.
func coveragePercentageForCell(cell model.CoverageCell, radiusKm float64) float64 {
	if cell.AreaKm2 <= 0 || len(cell.Polygon) == 0 || radiusKm <= 0 {
		return 0
	}
	proj := newProjector(cell.Site.Lat, cell.Site.Lng)
	cellPoly := projectRings(cell.Polygon, proj)
	circle := toPolyclip(circlePolygon(radiusKm, coverageSuggestionCircleVertices))
	intersectedAreaKm2 := sumArea(fromPolyclip(cellPoly.Construct(polyclip.INTERSECTION, circle)))
	pct := (intersectedAreaKm2 / cell.AreaKm2) * 100
	if pct > 100 {
		pct = 100
	}
	return pct
}

// ProjectScenario answers "what if the network also included these candidate
// new-branch locations?": it rebuilds the Voronoi diagram over the active
// branches plus suggestions, and for every original branch reports its
// current coverage percentage (from Diagnose) alongside the projected one in
// the combined network — both using the same simulatedAreaKm2 coverage
// circle.
func (s *CoverageService) ProjectScenario(simulatedAreaKm2 float64, suggestions []model.LatLng) model.ProjectionResult {
	branches := s.branchRepo.ListActive()

	var sites []voronoiSite
	for _, b := range branches {
		if b.Latitude != nil && b.Longitude != nil {
			sites = append(sites, voronoiSite{
				branchID:   b.ID,
				branchName: b.Name,
				province:   b.Province,
				lat:        *b.Latitude,
				lng:        *b.Longitude,
			})
		}
	}
	if len(sites) == 0 {
		return model.ProjectionResult{Branches: []model.BranchProjection{}}
	}

	for _, sug := range suggestions {
		sites = append(sites, voronoiSite{
			branchName: "Sugerencia",
			lat:        sug.Lat,
			lng:        sug.Lng,
		})
	}

	radiusKm := 0.0
	if simulatedAreaKm2 > 0 {
		radiusKm = math.Sqrt(simulatedAreaKm2 / math.Pi)
	}

	current := s.Diagnose(simulatedAreaKm2, nil)
	currentByID := make(map[string]float64, len(current.Cells))
	for _, c := range current.Cells {
		currentByID[c.BranchID] = c.CoveragePercentage
	}

	newCells := s.buildVoronoiCells(sites, nil)
	branchProjections := make([]model.BranchProjection, 0, len(branches))
	for _, cell := range newCells {
		if cell.BranchID == "" {
			continue // candidate suggestion site, not an existing branch
		}
		branchProjections = append(branchProjections, model.BranchProjection{
			BranchID:             cell.BranchID,
			BranchName:           cell.BranchName,
			CurrentCoveragePct:   currentByID[cell.BranchID],
			ProjectedCoveragePct: coveragePercentageForCell(cell, radiusKm),
		})
	}
	return model.ProjectionResult{Branches: branchProjections}
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
// large enough to be relevant, runs fillFragmentIteratively to place one or
// more suggestions ("Iterative Greedy Covering") inside it.
func suggestLocationsFromDifference(cell model.CoverageCell, proj equirectProjector, cellPoly, circle polyclip.Polygon, radiusKm float64, branchSites []model.LatLng, countryLocal polyclip.Polygon, otherCells []namedCellPoly) []model.SuggestedLocation {
	remainder := fromPolyclip(cellPoly.Construct(polyclip.DIFFERENCE, circle))

	// Branch sites projected into this cell's local frame (origin-centred on
	// cell.Site), used as the repulsion points by bestInteriorPoint. Shared
	// (and grown) across fragments so a suggestion placed in one fragment
	// also repels candidates considered for the next.
	sites := make([]geometry.Point, len(branchSites))
	for i, site := range branchSites {
		sites[i] = proj.project(site.Lat, site.Lng)
	}

	var out []model.SuggestedLocation
	for _, frag := range remainder {
		out = append(out, fillFragmentIteratively(cell, proj, frag, radiusKm, &sites, countryLocal, otherCells)...)
	}
	return out
}

// fillFragmentIteratively implements "Iterative Greedy Covering": a single
// fragment left over from the simulated-coverage DIFFERENCE can be far larger
// than one new branch's coverage circle would address, so a single
// bestInteriorPoint suggestion leaves most of the gap unaddressed. Instead,
// this repeatedly:
//
//  1. Picks the fragment's "Pole of Inaccessibility" via bestInteriorPoint,
//     using sites (existing branches + suggestions placed so far) as
//     repulsion points.
//  2. Appends that point as a new suggestion.
//  3. Adds the point to *sites, so the next iteration's grid search also
//     repels from it (suggestions spread out rather than clustering).
//  4. Subtracts a simulated coverage circle of radiusKm centred on the new
//     point from the current fragment (DIFFERENCE) — modelling "this part of
//     the gap would now be covered by the new branch" — and continues with
//     the largest remaining sub-fragment.
//
// Stops when the (sub-)fragment drops below
// coverageSuggestionMinFragmentAreaKm2, when DIFFERENCE leaves nothing, or
// after coverageSuggestionMaxPerFragment iterations (safety bound).
func fillFragmentIteratively(cell model.CoverageCell, proj equirectProjector, frag geometry.Polygon, radiusKm float64, sites *[]geometry.Point, countryLocal polyclip.Polygon, otherCells []namedCellPoly) []model.SuggestedLocation {
	var out []model.SuggestedLocation
	current := frag

	for i := 0; i < coverageSuggestionMaxPerFragment; i++ {
		area := current.Area()
		if area < coverageSuggestionMinFragmentAreaKm2 {
			break
		}

		point, ok := bestInteriorPoint(current, *sites, radiusKm, countryLocal)
		if !ok {
			// Degenerate fragment (e.g. a sliver thinner than the grid
			// resolution, with no grid point strictly inside): fall back to
			// the vertex farthest from the branch site, and stop — the
			// circle-subtraction step below assumes an interior point.
			actualAddedKm2, affected := suggestionImpact(farthestVertex(current), radiusKm, countryLocal, otherCells)
			out = append(out, model.SuggestedLocation{
				LatLng:           proj.unproject(farthestVertex(current)),
				BranchID:         cell.BranchID,
				BranchName:       cell.BranchName,
				GapAreaKm2:       area,
				ActualAddedKm2:   actualAddedKm2,
				AffectedBranches: affected,
			})
			break
		}

		actualAddedKm2, affected := suggestionImpact(point, radiusKm, countryLocal, otherCells)
		out = append(out, model.SuggestedLocation{
			LatLng:           proj.unproject(point),
			BranchID:         cell.BranchID,
			BranchName:       cell.BranchName,
			GapAreaKm2:       area,
			ActualAddedKm2:   actualAddedKm2,
			AffectedBranches: affected,
		})

		// Update 1: future grid searches (this fragment's remaining
		// iterations, later fragments, and other cells' suggestions via the
		// shared slice) repel from this new suggestion too.
		*sites = append(*sites, point)

		if radiusKm <= 0 {
			break
		}

		// Update 2: model this new branch's own coverage circle and subtract
		// it from the current fragment — the part of the gap it would now
		// cover.
		coverCircle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), point))
		remainder := fromPolyclip(toPolyclip(current).Construct(polyclip.DIFFERENCE, coverCircle))
		if len(remainder) == 0 {
			break
		}
		current = largestFragment(remainder)
	}
	return out
}

// translatePolygon returns a copy of poly with every vertex shifted by
// offset. Used to move a circle polygon generated at the origin (by
// circlePolygon) to be centred on an arbitrary point.
func translatePolygon(poly geometry.Polygon, offset geometry.Point) geometry.Polygon {
	out := make(geometry.Polygon, len(poly))
	for i, v := range poly {
		out[i] = geometry.Point{X: v.X + offset.X, Y: v.Y + offset.Y}
	}
	return out
}

// largestFragment returns the polygon with the greatest area among frags.
// frags must be non-empty.
func largestFragment(frags []geometry.Polygon) geometry.Polygon {
	best := frags[0]
	bestArea := best.Area()
	for _, f := range frags[1:] {
		if a := f.Area(); a > bestArea {
			bestArea = a
			best = f
		}
	}
	return best
}

// coverageInteriorPointCandidates is the size of the "Top N" shortlist that
// Pass 1 of bestInteriorPoint hands to Pass 2. Pass 2's polyclip
// INTERSECTION is too expensive to run over the full grid
// ((coverageSuggestionGridSteps+1)^2 points), so only the candidates that
// already look best on the cheap distance heuristic are re-scored precisely.
const coverageInteriorPointCandidates = 10

// bestInteriorPoint implements a two-pass "Pole of Inaccessibility" heuristic
// to place a new-branch suggestion well inside an uncovered fragment, instead
// of on one of its vertices or near a national border.
//
// DIFFERENCE (Voronoi cell minus simulated coverage circle) typically leaves a
// concave "crescent" fragment whose vertices sit on the cell/country/circle
// boundary — picking one of them pins the suggestion to a national border or
// to the edge of the simulated coverage circle, which is rarely a viable
// branch location. Worse, a grid point deep inside the fragment can still sit
// close enough to the border that half its own coverage circle (radiusKm)
// would spill into Chile/Brazil/etc. — the "Edge Effect" — wasting coverage
// area.
//
// Pass 1 (cheap distance filter): overlay a (coverageSuggestionGridSteps+1)^2
// grid over frag's bounding box, keep only the points that fall inside the
// polygon, and rank them by distance to the nearest existing branch site
// (sites, already projected into the same local frame) — i.e. how deep inside
// the gap and how far from already-covered area each candidate is. Keep the
// top coverageInteriorPointCandidates.
//
// Pass 2 (precise area filter): for each shortlisted candidate, build its
// simulated coverage circle (radiusKm) and intersect it with countryLocal
// (Argentina's contour, projected into the same frame) via polyclip
// INTERSECTION — the "useful area" that wouldn't be wasted across the border.
// The winner is the candidate with the largest useful area; ties (e.g. both
// circles land 100% inside the country) fall back to Pass 1's distance score.
//
// If radiusKm <= 0 (no coverage circle to score), Pass 1's winner is returned
// directly — Pass 2 would be meaningless.
//
// Returns ok=false if no grid point falls inside frag (a sliver thinner than
// the grid resolution); callers should fall back to a vertex-based heuristic.
func bestInteriorPoint(frag geometry.Polygon, sites []geometry.Point, radiusKm float64, countryLocal polyclip.Polygon) (geometry.Point, bool) {
	bbox := boundingBox(frag)

	type candidate struct {
		point geometry.Point
		dist2 float64
	}
	var candidates []candidate

	for i := 0; i <= coverageSuggestionGridSteps; i++ {
		x := bbox.MinX + (bbox.MaxX-bbox.MinX)*float64(i)/float64(coverageSuggestionGridSteps)
		for j := 0; j <= coverageSuggestionGridSteps; j++ {
			y := bbox.MinY + (bbox.MaxY-bbox.MinY)*float64(j)/float64(coverageSuggestionGridSteps)
			pt := geometry.Point{X: x, Y: y}
			if !frag.Contains(pt) {
				continue
			}
			candidates = append(candidates, candidate{point: pt, dist2: nearestSiteDist2(pt, sites)})
		}
	}
	if len(candidates) == 0 {
		return geometry.Point{}, false
	}

	sort.Slice(candidates, func(i, j int) bool { return candidates[i].dist2 > candidates[j].dist2 })
	if len(candidates) > coverageInteriorPointCandidates {
		candidates = candidates[:coverageInteriorPointCandidates]
	}

	if radiusKm <= 0 {
		return candidates[0].point, true
	}

	best := candidates[0]
	bestUsefulArea := usefulCircleArea(best.point, radiusKm, countryLocal)
	for _, cand := range candidates[1:] {
		area := usefulCircleArea(cand.point, radiusKm, countryLocal)
		if area > bestUsefulArea || (area == bestUsefulArea && cand.dist2 > best.dist2) {
			best = cand
			bestUsefulArea = area
		}
	}
	return best.point, true
}

// usefulCircleArea returns the area (km²) of a simulated coverage circle of
// radiusKm centred on point that falls within countryLocal (Argentina's
// contour, already projected into the same local km frame) — the part of the
// circle that would actually contribute coverage on national territory.
func usefulCircleArea(point geometry.Point, radiusKm float64, countryLocal polyclip.Polygon) float64 {
	circle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), point))
	return sumArea(fromPolyclip(circle.Construct(polyclip.INTERSECTION, countryLocal)))
}

// boundingBox returns the axis-aligned bounding box of poly's vertices.
func boundingBox(poly geometry.Polygon) geometry.BBox {
	bb := geometry.BBox{MinX: poly[0].X, MinY: poly[0].Y, MaxX: poly[0].X, MaxY: poly[0].Y}
	for _, v := range poly[1:] {
		bb.MinX = math.Min(bb.MinX, v.X)
		bb.MinY = math.Min(bb.MinY, v.Y)
		bb.MaxX = math.Max(bb.MaxX, v.X)
		bb.MaxY = math.Max(bb.MaxY, v.Y)
	}
	return bb
}

// nearestSiteDist2 returns the squared distance from pt to the nearest of
// sites. An empty sites slice (no branches at all) scores every candidate
// equally via +Inf, so the grid search degenerates to "any interior point".
func nearestSiteDist2(pt geometry.Point, sites []geometry.Point) float64 {
	if len(sites) == 0 {
		return math.Inf(1)
	}
	best := geometry.Dist2(pt, sites[0])
	for _, s := range sites[1:] {
		if d := geometry.Dist2(pt, s); d < best {
			best = d
		}
	}
	return best
}

// farthestVertex returns the vertex of poly with the greatest Euclidean
// distance from the origin. Callers project poly so that the reference point
// (the branch site) sits at the origin. Used as a fallback by
// suggestLocationsFromDifference when bestInteriorPoint finds no interior
// grid point.
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

// namedCellPoly pairs a branch's name with its Voronoi cell polygon (all
// fragments merged into a single multi-contour polyclip.Polygon), projected
// into a shared local frame — used by suggestionImpact to determine which
// existing branches a new suggestion's coverage circle would relieve.
type namedCellPoly struct {
	name string
	poly polyclip.Polygon
}

// projectCellsLocal projects every cell's (already country-clipped) polygon
// into proj's local frame, pairing each with its branch name. Cells without
// geometry are skipped.
func projectCellsLocal(cells []model.CoverageCell, proj equirectProjector) []namedCellPoly {
	out := make([]namedCellPoly, 0, len(cells))
	for _, c := range cells {
		if len(c.Polygon) == 0 {
			continue
		}
		out = append(out, namedCellPoly{name: c.BranchName, poly: projectRings(c.Polygon, proj)})
	}
	return out
}

// suggestionImpact computes a suggestion's real-world impact: the net surface
// area its simulated coverage circle would add within Argentina's outline,
// and the names of existing branches whose Voronoi cells it would relieve
// (any cell whose polygon intersects the circle).
func suggestionImpact(point geometry.Point, radiusKm float64, countryLocal polyclip.Polygon, cells []namedCellPoly) (float64, []string) {
	circle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), point))

	actualAddedKm2 := sumArea(fromPolyclip(circle.Construct(polyclip.INTERSECTION, countryLocal)))

	affected := make([]string, 0)
	for _, nc := range cells {
		if sumArea(fromPolyclip(circle.Construct(polyclip.INTERSECTION, nc.poly))) > 0 {
			affected = append(affected, nc.name)
		}
	}
	return actualAddedKm2, affected
}
