package service

import (
	"fmt"
	"log"
	"math"
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

	// coverageSuggestionGridSteps controls the Pole-of-Inaccessibility grid
	// density: a (N+1)×(N+1) mesh over the fragment's km-space bounding box.
	// The mesh adapts automatically to any polygon size because it divides the
	// bounding box into equal steps — 50 steps gives ≈ 2 600 candidate points
	// per fragment, enough to resolve slivers at any scale from a 5 km²
	// neighbourhood to the entire national territory.
	coverageSuggestionGridSteps = 50

	// coverageSuggestionMaxPerFragment caps how many suggestions the
	// iterative greedy-covering loop (fillFragmentIteratively) can place
	// inside a single uncovered fragment, regardless of how large it is —
	// a safety bound against pathological/degenerate geometry producing an
	// unbounded loop.
	coverageSuggestionMaxPerFragment = 4

	// coverageSuggestionSeparationFactor is the minimum allowed distance
	// between two suggestions placed in the same iterative run, expressed as
	// a multiple of radiusKm. A value of 1.5 means that if a new candidate is
	// within 1.5× the coverage radius of an already-placed suggestion, it is
	// rejected during the grid search — preventing heavy overlap (clustering).
	coverageSuggestionSeparationFactor = 1.5

	// coverageSuggestionClipRadiusScale expands the coverage circle used for
	// the DIFFERENCE operation (subtracting each placed branch from the
	// remaining fragment) by this factor. The expansion eliminates micro-sliver
	// residuals that polyclip leaves when the subtraction circle matches the
	// scoring circle exactly, preventing the next iteration from obsessing over
	// pixel-scale leftovers.
	coverageSuggestionClipRadiusScale = 1.05
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

// listBranches returns the branch list for simulation, optionally including
// inactive ("inactivo" / "fuera_de_servicio") branches.
func (s *CoverageService) listBranches(includeInactive bool) []model.Branch {
	if includeInactive {
		return s.branchRepo.List()
	}
	return s.branchRepo.ListActive()
}

// Diagnose evaluates a hypothetical new-branch coverage radius — expressed as
// an area in km², chosen via the frontend simulator slider — against every
// branch's real, post-clip Voronoi area.
//
// customBoundary, when non-nil and at least 3 points, clips the Voronoi cells
// against the drawn polygon instead of Argentina's national outline, so the
// diagnosis is restricted to the user-drawn region (e.g. AMBA, a province).
// A nil/empty slice uses the cached national-boundary diagram.
//
// dangerousZones is an optional list of exclusion polygons subtracted from the
// boundary before Voronoi construction (see computeTierraFertil). When
// non-empty the cached diagram cannot be reused and the Voronoi is rebuilt.
func (s *CoverageService) Diagnose(simulatedAreaKm2 float64, customBoundary []model.LatLng, dangerousZones [][]model.LatLng, includeInactive bool, maxSuggestions int, snapToCities bool, mode string, density model.DensityOptions) model.SimulationResult {
	// Rebuild when inactive branches, a custom boundary, or dangerous zones are
	// in play — the cached active-only national diagram cannot be reused.
	if includeInactive || len(customBoundary) >= 3 || len(dangerousZones) > 0 {
		branches := s.listBranches(includeInactive)
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
		return s.diagnoseWithCells(simulatedAreaKm2, s.buildVoronoiCells(sites, customBoundary, dangerousZones), customBoundary, dangerousZones, maxSuggestions, snapToCities, mode, density)
	}
	return s.diagnoseWithCells(simulatedAreaKm2, s.Diagram().Cells, nil, nil, maxSuggestions, snapToCities, mode, density)
}

// DiagnoseExcluding is like Diagnose but recomputes the Voronoi diagram after
// removing the listed branch IDs — the "Simulador de cierre de sucursales"
// feature. An empty slice is equivalent to calling Diagnose directly.
// customBoundary and dangerousZones follow the same semantics as in Diagnose.
func (s *CoverageService) DiagnoseExcluding(simulatedAreaKm2 float64, excludedBranchIDs []string, customBoundary []model.LatLng, dangerousZones [][]model.LatLng, includeInactive bool, maxSuggestions int, snapToCities bool, mode string, density model.DensityOptions) model.SimulationResult {
	if len(excludedBranchIDs) == 0 {
		return s.Diagnose(simulatedAreaKm2, customBoundary, dangerousZones, includeInactive, maxSuggestions, snapToCities, mode, density)
	}
	excluded := make(map[string]bool, len(excludedBranchIDs))
	for _, id := range excludedBranchIDs {
		excluded[id] = true
	}
	branches := s.listBranches(includeInactive)
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
	return s.diagnoseWithCells(simulatedAreaKm2, s.buildVoronoiCells(sites, customBoundary, dangerousZones), customBoundary, dangerousZones, maxSuggestions, snapToCities, mode, density)
}

// diagnoseWithCells is the core diagnosis logic shared by Diagnose and
// DiagnoseExcluding. coverageCells is the set of Voronoi cells to evaluate —
// either the cached diagram (Diagnose) or a freshly-computed filtered set
// (DiagnoseExcluding). customBoundary and dangerousZones are forwarded to
// computeTierraFertil for per-cell clipping and for the global void search.
func (s *CoverageService) diagnoseWithCells(simulatedAreaKm2 float64, coverageCells []model.CoverageCell, customBoundary []model.LatLng, dangerousZones [][]model.LatLng, maxSuggestions int, snapToCities bool, mode string, density model.DensityOptions) model.SimulationResult {
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

	// Minimum distance between two suggestions and minimum fragment area: when a
	// custom boundary is set the analysis is scoped to a small zone (e.g. AMBA,
	// ~3 000 km²). The national constants (150 km separation, 50 000 km²
	// fragment floor) are tuned for country-wide diagnosis and would prevent
	// placing more than one suggestion in any custom zone. When a custom boundary
	// is active, use adaptive values scaled to the simulated coverage area:
	//   • separation  = max(2 × radiusKm, 20 km)   — suggestions don't overlap,
	//                                                  20 km floor = city-scale
	//   • minFragArea = max(simulatedAreaKm2, 20 km²) — a fragment smaller than
	//                                                    one coverage circle
	//                                                    doesn't need a branch
	// Without a custom boundary the original tuned constants are kept unchanged
	// so existing national-scope tests and behaviour are unaffected.
	var minSeparationKm, adaptiveMinFragAreaKm2 float64
	if len(customBoundary) >= 3 {
		minSeparationKm = math.Max(radiusKm*2, 20.0)
		adaptiveMinFragAreaKm2 = math.Max(simulatedAreaKm2, 20.0)
	} else {
		minSeparationKm = radiusKm
		if minSeparationKm < coverageSuggestionMinSeparationKm {
			minSeparationKm = coverageSuggestionMinSeparationKm
		}
		adaptiveMinFragAreaKm2 = coverageSuggestionMinFragmentAreaKm2
	}

	// Per-fragment iteration cap: for custom zones honour the user's
	// maxSuggestions value so a single large cell can fill all requested
	// slots. For national scope keep the tight safety limit.
	perFragCap := coverageSuggestionMaxPerFragment
	if len(customBoundary) >= 3 {
		if maxSuggestions > 0 {
			perFragCap = maxSuggestions
		} else {
			perFragCap = 12 // generous safety; spatial separation is the natural bound
		}
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

			countryLocal = computeTierraFertil(customBoundary, dangerousZones, proj)
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
		if mode != "density" && haveGeometry && severity == model.GapSeverityCritico {
			for _, cand := range suggestLocationsFromDifference(c, proj, cellPoly, circle, radiusKm, branchSites, countryLocal, otherCellsLocal, adaptiveMinFragAreaKm2, perFragCap) {
				if !tooCloseToExisting(cand, suggestions, minSeparationKm) {
					suggestions = append(suggestions, cand)
				}
			}
		}
	}

	// Density mode: rank every cell by population density (hab./km²) instead
	// of geometric gap area. Suggestions are snapped server-side and sorted
	// by density descending so high-demand urban cells surface first.
	if mode == "density" {
		suggs, rejected := s.computeDensitySuggestions(coverageCells, customBoundary, simulatedAreaKm2, dangerousZones, maxSuggestions, density)
		return model.SimulationResult{
			SimulatedAreaKm2:   simulatedAreaKm2,
			Cells:              diagCells,
			SuggestedLocations: suggs,
			RejectedLocations:  rejected,
			DiagramCells:       coverageCells,
		}
	}

	// MathematicalSuggestions: Pole-of-Inaccessibility from the global uncovered
	// void (Tierra Fértil − ∪ all coverage circles).
	//
	// Reference point for the global projector (in order of preference):
	//   1. Centroid of existing branch sites (most accurate when branches exist).
	//   2. Centroid of the custom boundary polygon (0-branch case).
	//   3. Approximate centre of Argentina (no boundary, no branches).
	var mathSuggestions []model.SuggestedLocation
	if simulatedAreaKm2 > 0 {
		var refLat, refLng float64
		var projSource string
		switch {
		case len(coverageCells) > 0:
			for _, c := range coverageCells {
				refLat += c.Site.Lat
				refLng += c.Site.Lng
			}
			refLat /= float64(len(coverageCells))
			refLng /= float64(len(coverageCells))
			projSource = "centroid of coverageCells"
		case len(customBoundary) >= 3:
			for _, v := range customBoundary {
				refLat += v.Lat
				refLng += v.Lng
			}
			refLat /= float64(len(customBoundary))
			refLng /= float64(len(customBoundary))
			projSource = "centroid of customBoundary"
		default:
			refLat, refLng = -38.0, -63.5
			projSource = "Argentina default"
		}
		globalProj := newProjector(refLat, refLng)
		radiusKm := math.Sqrt(simulatedAreaKm2 / math.Pi)
		log.Printf("[MathSugg] diagnoseWithCells: cells=%d branchSites=%d simulatedAreaKm2=%.0f radiusKm=%.3f boundary=%d pts dangerousZones=%d",
			len(coverageCells), len(branchSites), simulatedAreaKm2, radiusKm, len(customBoundary), len(dangerousZones))
		log.Printf("[MathSugg] projector: ref=(%.4f, %.4f) source=%q", refLat, refLng, projSource)
		tierraFertil := computeTierraFertil(customBoundary, dangerousZones, globalProj)
		log.Printf("[MathSugg] computeTierraFertil → %d contours", len(tierraFertil))
		otherCellsGlobal := projectCellsLocal(coverageCells, globalProj)
		mathSuggestions = computeMathematicalSuggestions(tierraFertil, branchSites, radiusKm, globalProj, otherCellsGlobal, maxSuggestions)

		// Cross-source + cross-fragment de-overlap: the per-cell SuggestedLocations
		// and the global MathematicalSuggestions are two independent
		// Pole-of-Inaccessibility passes over the *same* uncovered void, so they
		// can land near-on-top of each other (a math suggestion whose coverage
		// circle heavily overlaps a per-cell one barely adds new terrain). Drop
		// any math suggestion within minSeparationKm of a per-cell suggestion or
		// of an already-kept math suggestion. Per-cell suggestions win ties — they
		// carry concrete branch attribution ("descomprimirá las zonas de…").
		if len(mathSuggestions) > 0 {
			kept := make([]model.SuggestedLocation, 0, len(mathSuggestions))
			for _, ms := range mathSuggestions {
				if tooCloseToExisting(ms, suggestions, minSeparationKm) || tooCloseToExisting(ms, kept, minSeparationKm) {
					log.Printf("[MathSugg] de-overlap: dropping suggestion at (%.4f, %.4f) — within %.0f km of an existing suggestion", ms.Lat, ms.Lng, minSeparationKm)
					continue
				}
				kept = append(kept, ms)
			}
			mathSuggestions = kept
		}

		if snapToCities && len(mathSuggestions) > 0 {
			log.Printf("[MathSugg] snap: starting snapMathSuggestionsInPlace for %d suggestions (searchRadius≤%.0fkm)", len(mathSuggestions), math.Min(radiusKm/2, snapToCityMaxRadiusKm))
			s.snapMathSuggestionsInPlace(mathSuggestions, radiusKm, 0, dangerousZones, nil)
		}
	}

	return model.SimulationResult{
		SimulatedAreaKm2:        simulatedAreaKm2,
		Cells:                   diagCells,
		SuggestedLocations:      suggestions,
		MathematicalSuggestions: mathSuggestions,
		DiagramCells:            coverageCells,
	}
}

// densityModeMaxCandidates caps the number of fragment candidates carried into
// the snap stage in density mode. Candidates are pre-sorted by uncovered-fragment
// area descending so the largest (most likely populated) ones are evaluated
// first. Snapping is now a local in-memory lookup (embedded INDEC/Georef
// dataset), so this cap is generous — it bounds work, not a rate-limited API.
// A high ceiling lets large zones surface many more suggestions than the old
// Overpass-bound limit of 25.
const densityModeMaxCandidates = 200

// densityModeMinFragAreaKm2 is the minimum uncovered-fragment area (km²)
// considered in density mode. Smaller than coverageSuggestionMinFragmentAreaKm2
// so that dense urban uncovered zones (e.g. outer AMBA ring) are not filtered.
const densityModeMinFragAreaKm2 = 50.0

// computeDensitySuggestions implements the "density" diagnostic mode.
//
// Unlike area mode (which ranks suggestions by Voronoi gap area), density mode
// answers "where are the most people that the current network does NOT reach?"
// by reusing the same DIFFERENCE geometry (cell − coverage circle) as area
// mode but ranking results by the absolute population of the nearest city
// found inside each uncovered fragment.
//
// Steps:
//  1. For every Voronoi cell with polygon geometry, compute the uncovered zone
//     (cell − simulated coverage circle) — identical to area-mode "crítico"
//     suggestions but applied to ALL cells, not just crítico ones.
//  2. Place one candidate per uncovered fragment at its Pole of Inaccessibility:
//     guaranteed to lie on Argentine land and outside existing coverage circles.
//  3. Pre-sort by fragment area descending, cap at densityModeMaxCandidates to
//     bound Overpass API calls.
//  4. Snap each candidate to the nearest real city using a LOCAL search radius
//     (proportional to the simulation radius, not the national 150 km default)
//     so the snap finds cities INSIDE the uncovered zone rather than pulling in
//     distant megacities that already have branches.
//  5. Rank by Population descending and set Density = population / fragment_area
//     (hab./km² of uncovered zone) — a meaningful logistics metric.
func (s *CoverageService) computeDensitySuggestions(coverageCells []model.CoverageCell, customBoundary []model.LatLng, simulatedAreaKm2 float64, dangerousZones [][]model.LatLng, maxSuggestions int, density model.DensityOptions) ([]model.SuggestedLocation, []model.RejectedLocation) {
	if simulatedAreaKm2 <= 0 || len(coverageCells) == 0 {
		return nil, nil
	}

	var rejected []model.RejectedLocation

	// rejectedScore computes the Logistics Viability Index for a candidate at
	// rejection time. Industrial-zone presence defaults to false because zone
	// detection (an Overpass call) only runs for candidates that survive to the
	// final scoring stage. Terrain is always cheap to compute.
	rejectedScore := func(c model.SuggestedLocation, usefulArea float64) int {
		f, _ := terrainFriction(c.Lat, c.Lng)
		return CalculateViabilityScore(c.Population, c.Density, usefulArea, false, f)
	}

	radiusKm := math.Sqrt(simulatedAreaKm2 / math.Pi)
	circle := toPolyclip(circlePolygon(radiusKm, coverageSuggestionCircleVertices))

	var minSepKm float64
	var perFragCap int
	if len(customBoundary) >= 3 {
		minSepKm = math.Max(radiusKm*2, 20.0)
		if maxSuggestions > 0 {
			perFragCap = maxSuggestions
		} else {
			perFragCap = 12
		}
	} else {
		minSepKm = math.Max(radiusKm, coverageSuggestionMinSeparationKm)
		perFragCap = coverageSuggestionMaxPerFragment
	}
	// Operator override: an explicit minimum separation replaces the automatic
	// value above (in both scopes), letting the user pack suggestions closer
	// together (more suggestions) or spread them out.
	if density.MinSeparationKm > 0 {
		minSepKm = density.MinSeparationKm
	}

	branchSites := make([]model.LatLng, len(coverageCells))
	for i, c := range coverageCells {
		branchSites[i] = c.Site
	}

	var candidates []model.SuggestedLocation

	for _, c := range coverageCells {
		if len(c.Polygon) == 0 {
			continue
		}
		proj := newProjector(c.Site.Lat, c.Site.Lng)
		cellPoly := projectRings(c.Polygon, proj)
		countryLocal := computeTierraFertil(customBoundary, dangerousZones, proj)
		otherCellsLocal := projectCellsLocal(coverageCells, proj)

		sites := make([]geometry.Point, len(branchSites))
		for i, site := range branchSites {
			sites[i] = proj.project(site.Lat, site.Lng)
		}

		// Start with cell − branch's own coverage circle.
		remainderPoly := cellPoly.Construct(polyclip.DIFFERENCE, circle)
		// Subtract already-placed suggestions so new candidates only cover
		// genuinely uncovered territory (fixes overlap in "Buscar más" rounds).
		for _, site := range density.AdditionalSites {
			if len(remainderPoly) == 0 {
				break
			}
			pt := proj.project(site.Lat, site.Lng)
			addCircle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), pt))
			remainderPoly = remainderPoly.Construct(polyclip.DIFFERENCE, addCircle)
		}
		remainder := fromPolyclip(remainderPoly)
		for _, frag := range remainder {
			if frag.Area() < densityModeMinFragAreaKm2 {
				continue
			}
			for _, f := range fillFragmentIteratively(c, proj, frag, radiusKm, &sites, countryLocal, otherCellsLocal, densityModeMinFragAreaKm2, perFragCap) {
				if !tooCloseToExisting(f, candidates, minSepKm) {
					candidates = append(candidates, f)
				}
			}
		}
	}

	if len(candidates) == 0 {
		return nil, nil
	}

	// Pre-sort by uncovered fragment area descending: larger fragments are more
	// likely to contain real cities, so they get priority if we must cap.
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].GapAreaKm2 > candidates[j].GapAreaKm2
	})
	if len(candidates) > densityModeMaxCandidates {
		candidates = candidates[:densityModeMaxCandidates]
	}

	// Local snap radius: keeps the Overpass query within the fragment's
	// neighbourhood so we find the best city INSIDE the uncovered zone,
	// not a distant megacity that may already have a branch.
	// snapMathSuggestionsInPlace uses min(passedKm/2, 150) as actual radius.
	desiredSearchKm := math.Min(math.Max(radiusKm*0.5, 20.0), 60.0)
	s.snapMathSuggestionsInPlace(candidates, desiredSearchKm*2, density.MinPopulation, dangerousZones, density.ExcludedCities)

	// Post-snap dedup: two geometric candidates > minSepKm apart can both snap
	// to the same city (e.g. Buenos Aires within range of both). Deduplicate by
	// city name after snapping so the same city never appears twice.
	deduped := candidates[:0]
	seenCity := make(map[string]bool, len(candidates))
	for _, c := range candidates {
		key := c.CityName
		if key == "" || !c.IsSnapped {
			if !tooCloseToExisting(c, deduped, minSepKm) {
				deduped = append(deduped, c)
			}
			continue
		}
		if !seenCity[key] {
			seenCity[key] = true
			deduped = append(deduped, c)
		} else {
			rejected = append(rejected, model.RejectedLocation{
				CityName:     c.CityName,
				Lat:          c.Lat,
				Lng:          c.Lng,
				RejectReason: c.CityName + " ya fue seleccionada como candidata (ciudad duplicada)",
				Score:        rejectedScore(c, c.GapAreaKm2),
			})
		}
	}
	candidates = deduped

	// Remove snapped cities outside the custom boundary: the snap search radius
	// can extend beyond the drawn polygon and find cities in adjacent zones.
	if len(customBoundary) >= 3 {
		inBounds := candidates[:0]
		for _, c := range candidates {
			if !c.IsSnapped || latLngInPolygon(c.Lat, c.Lng, customBoundary) {
				inBounds = append(inBounds, c)
			} else {
				rejected = append(rejected, model.RejectedLocation{
					CityName:     c.CityName,
					Lat:          c.Lat,
					Lng:          c.Lng,
					RejectReason: "Ciudad fuera de la zona de análisis seleccionada",
					Score:        rejectedScore(c, c.GapAreaKm2),
				})
			}
		}
		candidates = inBounds
	}

	// Remove snapped candidates whose city falls within minSepKm of an EXISTING
	// branch site.  Without this filter, density mode can suggest Buenos Aires or
	// Bahía Blanca even when CDBA-01 / BAHB-01 are already located there — the
	// geometric PoI may be far from the branch, but the snap pulls the candidate
	// to the nearest large city, which may already host a branch.
	{
		branchLocs := make([]model.SuggestedLocation, len(coverageCells))
		for i, cell := range coverageCells {
			branchLocs[i].Lat = cell.Site.Lat
			branchLocs[i].Lng = cell.Site.Lng
		}
		notNearBranch := candidates[:0]
		for _, c := range candidates {
			if !tooCloseToExisting(c, branchLocs, minSepKm) {
				notNearBranch = append(notNearBranch, c)
			} else {
				rejected = append(rejected, model.RejectedLocation{
					CityName:     c.CityName,
					Lat:          c.Lat,
					Lng:          c.Lng,
					RejectReason: fmt.Sprintf("Demasiado cerca de una sucursal existente (< %.0f km)", minSepKm),
					Score:        rejectedScore(c, c.GapAreaKm2),
				})
			}
		}
		candidates = notNearBranch
	}

	// Post-snap geographic dedup: two different city names can still be within
	// minSepKm of each other after snapping (the snap radius pulls candidates
	// toward nearby cities that may already be covered by another suggestion's
	// circle).  Re-running the distance check on the snapped coordinates
	// guarantees that no two coverage circles overlap regardless of city name.
	geoDeduped := make([]model.SuggestedLocation, 0, len(candidates))
	for _, c := range candidates {
		if !tooCloseToExisting(c, geoDeduped, minSepKm) {
			geoDeduped = append(geoDeduped, c)
		} else {
			rejected = append(rejected, model.RejectedLocation{
				CityName:     c.CityName,
				Lat:          c.Lat,
				Lng:          c.Lng,
				RejectReason: fmt.Sprintf("Demasiado cerca de otra sugerencia seleccionada (< %.0f km)", minSepKm),
				Score:        rejectedScore(c, c.GapAreaKm2),
			})
		}
	}
	candidates = geoDeduped

	// Density mode only surfaces real cities. Drop any geometric PoI candidates
	// that the snapper could not resolve (Overpass timeout or no city within the
	// search radius). Keeping them would produce 0-population / 0-density entries
	// that pass any MinDensity filter and show a misleading "0% → 0%" projection
	// on the frontend — especially common on large zones without a custom boundary.
	{
		snapped := candidates[:0]
		for _, c := range candidates {
			if c.IsSnapped {
				snapped = append(snapped, c)
			} else {
				reason := "Sin ciudad en el radio de búsqueda"
				if density.MinPopulation > 0 {
					reason = fmt.Sprintf("Sin ciudad con ≥ %d hab. en el radio de búsqueda", density.MinPopulation)
				}
				rejected = append(rejected, model.RejectedLocation{
					CityName:     fmt.Sprintf("(%.3f°, %.3f°)", c.Lat, c.Lng),
					Lat:          c.Lat,
					Lng:          c.Lng,
					RejectReason: reason,
					Score:        1, // no city found — minimum viability
				})
			}
		}
		candidates = snapped
	}

	// Recompute ActualAddedKm2 at the snapped city's real coordinates and subtract
	// every existing-branch coverage circle so the figure reflects genuine NET new
	// coverage — not just "circle is fully within the zone".  Without this, a
	// suggestion next to an existing branch still reports the full circle area.
	for i := range candidates {
		if !candidates[i].IsSnapped {
			continue
		}
		cProj := newProjector(candidates[i].Lat, candidates[i].Lng)
		// City circle centred at local origin (the city itself).
		remainder := toPolyclip(circlePolygon(radiusKm, coverageSuggestionCircleVertices))

		// Clip to the custom boundary when one is active.  For national scope we
		// skip this because calling computeTierraFertil with the full Argentina
		// outline for every candidate is expensive and the circle is almost always
		// contained within the country anyway.
		if len(customBoundary) >= 3 {
			tierra := computeTierraFertil(customBoundary, dangerousZones, cProj)
			remainder = remainder.Construct(polyclip.INTERSECTION, tierra)
			if len(remainder) == 0 {
				candidates[i].ActualAddedKm2 = 0
				continue
			}
		}

		// Subtract each existing branch's coverage circle.
		for _, cell := range coverageCells {
			if len(remainder) == 0 {
				break
			}
			branchPt := cProj.project(cell.Site.Lat, cell.Site.Lng)
			branchCircle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), branchPt))
			remainder = remainder.Construct(polyclip.DIFFERENCE, branchCircle)
		}

		// Subtract already-placed suggestions from earlier "Buscar más" rounds.
		for _, site := range density.AdditionalSites {
			if len(remainder) == 0 {
				break
			}
			sitePt := cProj.project(site.Lat, site.Lng)
			siteCircle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), sitePt))
			remainder = remainder.Construct(polyclip.DIFFERENCE, siteCircle)
		}

		candidates[i].ActualAddedKm2 = sumArea(fromPolyclip(remainder))
	}

	// Drop candidates whose net new coverage is negligible (e.g. a city sitting
	// right on the edge of an existing branch circle may contribute only 1 km²).
	// Require at least 5 % of the simulated circle area as a useful contribution.
	{
		minUsefulKm2 := math.Max(5.0, simulatedAreaKm2*0.05)
		useful := candidates[:0]
		for _, c := range candidates {
			if c.ActualAddedKm2 >= minUsefulKm2 {
				useful = append(useful, c)
			} else {
				rejected = append(rejected, model.RejectedLocation{
					CityName:     c.CityName,
					Lat:          c.Lat,
					Lng:          c.Lng,
					RejectReason: fmt.Sprintf("Cobertura neta insuficiente: %.0f km² (mínimo: %.0f km²)", c.ActualAddedKm2, minUsefulKm2),
					Score:        rejectedScore(c, c.ActualAddedKm2),
				})
			}
		}
		candidates = useful
	}

	// Density = population / uncovered-fragment area (hab./km²).
	for i := range candidates {
		if candidates[i].IsSnapped && candidates[i].GapAreaKm2 > 0 {
			candidates[i].Density = float64(candidates[i].Population) / candidates[i].GapAreaKm2
		}
	}

	// Optional minimum-density filter.
	if density.MinDensity > 0 {
		filtered := candidates[:0]
		for _, c := range candidates {
			if c.Density >= density.MinDensity {
				filtered = append(filtered, c)
			} else {
				rejected = append(rejected, model.RejectedLocation{
					CityName:     c.CityName,
					Lat:          c.Lat,
					Lng:          c.Lng,
					RejectReason: fmt.Sprintf("Densidad insuficiente: %.0f hab./km² (mínimo: %.0f hab./km²)", c.Density, density.MinDensity),
					Score:        rejectedScore(c, c.ActualAddedKm2),
				})
			}
		}
		candidates = filtered
	}

	// Terrain friction: always computed (local heuristic, no network call).
	// Sets TerrainType on every candidate so the frontend can show badges.
	for i := range candidates {
		_, candidates[i].TerrainType = terrainFriction(candidates[i].Lat, candidates[i].Lng)
	}

	// Industrial zone detection: one Overpass call for all candidates when enabled.
	if density.PrioritizeIndustrial {
		industrial := s.detectIndustrialZones(candidates)
		for i := range candidates {
			candidates[i].HasIndustrialZone = industrial[i]
		}
	}

	// Viability Score: full signal (population + density + area + industry + terrain)
	// now that all attributes are set for surviving candidates.
	for i := range candidates {
		f, _ := terrainFriction(candidates[i].Lat, candidates[i].Lng)
		candidates[i].Score = CalculateViabilityScore(
			candidates[i].Population,
			candidates[i].Density,
			candidates[i].ActualAddedKm2,
			candidates[i].HasIndustrialZone,
			f,
		)
	}

	// Min-score filter: drop candidates whose Logistics Viability Index is below
	// the threshold set by the operator. Applied after the full score is computed
	// so terrain friction and industrial bonus are already factored in.
	if density.MinScore > 0 {
		qualified := candidates[:0]
		for _, c := range candidates {
			if c.Score >= density.MinScore {
				qualified = append(qualified, c)
			} else {
				rejected = append(rejected, model.RejectedLocation{
					CityName:     c.CityName,
					Lat:          c.Lat,
					Lng:          c.Lng,
					RejectReason: fmt.Sprintf("Puntuación insuficiente: %d/100 (mínimo: %d/100)", c.Score, density.MinScore),
					Score:        c.Score,
				})
			}
		}
		candidates = qualified
	}

	// Final ranking via composite score:
	//   FinalScore = (BaseDensity × IndustrialMultiplier) / TerrainFriction
	//
	// BaseDensity  — pop. density (hab./km²) or gap area depending on RankingMode.
	// IndustrialMultiplier — 1.3 when HasIndustrialZone && PrioritizeIndustrial.
	// TerrainFriction      — 1.0 (Llano) … 1.5 (Montañoso) when enabled.
	scoreOf := func(c model.SuggestedLocation) float64 {
		var base float64
		if density.RankingMode == "gap_area" {
			base = c.GapAreaKm2
		} else {
			base = c.Density
			if base <= 0 {
				base = float64(c.Population)
			}
		}
		mult := 1.0
		if density.PrioritizeIndustrial && c.HasIndustrialZone {
			mult = 1.3
		}
		friction := 1.0
		if density.ApplyTerrainFriction {
			friction, _ = terrainFriction(c.Lat, c.Lng)
		}
		return (base * mult) / friction
	}
	sort.Slice(candidates, func(i, j int) bool {
		return scoreOf(candidates[i]) > scoreOf(candidates[j])
	})

	if maxSuggestions > 0 && len(candidates) > maxSuggestions {
		candidates = candidates[:maxSuggestions]
	}
	return candidates, rejected
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
// dangerousZones are subtracted from the clipping polygon via computeTierraFertil.
func (s *CoverageService) buildVoronoiCells(sites []voronoiSite, customBoundary []model.LatLng, dangerousZones [][]model.LatLng) []model.CoverageCell {
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

	country := computeTierraFertil(customBoundary, dangerousZones, proj)

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
// customBoundary and dangerousZones scope the projection to a region: when set,
// both the current and the projected Voronoi cells are clipped against the
// boundary (minus the dangerous zones), so the percentages reflect that zone
// instead of the national territory. Nil/empty = national scope.
func (s *CoverageService) ProjectScenario(simulatedAreaKm2 float64, suggestions []model.LatLng, customBoundary []model.LatLng, dangerousZones [][]model.LatLng) model.ProjectionResult {
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

	current := s.Diagnose(simulatedAreaKm2, customBoundary, dangerousZones, false, 0, false, "", model.DensityOptions{})
	currentByID := make(map[string]float64, len(current.Cells))
	for _, c := range current.Cells {
		currentByID[c.BranchID] = c.CoveragePercentage
	}

	newCells := s.buildVoronoiCells(sites, customBoundary, dangerousZones)
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
func suggestLocationsFromDifference(cell model.CoverageCell, proj equirectProjector, cellPoly, circle polyclip.Polygon, radiusKm float64, branchSites []model.LatLng, countryLocal polyclip.Polygon, otherCells []namedCellPoly, minFragAreaKm2 float64, maxPerFrag int) []model.SuggestedLocation {
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
		out = append(out, fillFragmentIteratively(cell, proj, frag, radiusKm, &sites, countryLocal, otherCells, minFragAreaKm2, maxPerFrag)...)
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
// Stops when the (sub-)fragment drops below minFragAreaKm2, when DIFFERENCE
// leaves nothing, or after coverageSuggestionMaxPerFragment iterations (safety
// bound). minFragAreaKm2 should be coverageSuggestionMinFragmentAreaKm2 for
// per-cell national-scale suggestions, or an adaptive smaller value (see
// computeMathematicalSuggestions) for small custom zones.
func fillFragmentIteratively(cell model.CoverageCell, proj equirectProjector, frag geometry.Polygon, radiusKm float64, sites *[]geometry.Point, countryLocal polyclip.Polygon, otherCells []namedCellPoly, minFragAreaKm2 float64, maxIterations int) []model.SuggestedLocation {
	var out []model.SuggestedLocation
	current := frag
	// addedPoints tracks suggestions placed during THIS run so bestInteriorPoint
	// can reject candidates that would cluster too close to them.
	var addedPoints []geometry.Point

	for i := 0; i < maxIterations; i++ {
		area := current.Area()
		if area < minFragAreaKm2 {
			break
		}

		point, ok := bestInteriorPoint(current, *sites, radiusKm, countryLocal, addedPoints)
		if !ok {
			// Degenerate fragment (e.g. a sliver thinner than the grid
			// resolution, with no grid point strictly inside): fall back to
			// the vertex farthest from the branch site, and stop — the
			// circle-subtraction step below assumes an interior point.
			fallback := farthestVertex(current)
			actualAddedKm2, affected := suggestionImpact(fallback, radiusKm, countryLocal, otherCells)
			out = append(out, model.SuggestedLocation{
				LatLng:           proj.unproject(fallback),
				BranchID:         cell.BranchID,
				BranchName:       cell.BranchName,
				GapAreaKm2:       area,
				ActualAddedKm2:   actualAddedKm2,
				AffectedBranches: affected,
			})
			break
		}

		// Guard: polyclip or projection arithmetic occasionally produces NaN
		// coordinates when chained boolean operations accumulate float64 error.
		// Rather than propagating poison values, skip and stop.
		if math.IsNaN(point.X) || math.IsNaN(point.Y) || math.IsInf(point.X, 0) || math.IsInf(point.Y, 0) {
			log.Printf("[MathSugg] fillFragmentIteratively[%d]: invalid point (NaN/Inf) coordinates — breaking", i)
			break
		}

		log.Printf("[MathSugg] fillFragmentIteratively[%d]: area=%.2f km² point=(%.1f, %.1f)", i, area, point.X, point.Y)

		actualAddedKm2, affected := suggestionImpact(point, radiusKm, countryLocal, otherCells)
		out = append(out, model.SuggestedLocation{
			LatLng:           proj.unproject(point),
			BranchID:         cell.BranchID,
			BranchName:       cell.BranchName,
			GapAreaKm2:       area,
			ActualAddedKm2:   actualAddedKm2,
			AffectedBranches: affected,
		})

		// Update 1: track for (a) global repulsion across all fragments via
		// the shared sites slice, and (b) local proximity rejection inside
		// this fragment's remaining iterations via addedPoints.
		*sites = append(*sites, point)
		addedPoints = append(addedPoints, point)

		if radiusKm <= 0 {
			break
		}

		// Update 2: subtract a slightly enlarged circle (×coverageSuggestionClipRadiusScale)
		// from the current fragment. The expansion cleans up micro-sliver
		// residuals that polyclip leaves when using the exact scoring radius,
		// preventing subsequent iterations from fixating on pixel-scale leftovers.
		coverCircle := toPolyclip(translatePolygon(circlePolygon(radiusKm*coverageSuggestionClipRadiusScale, coverageSuggestionCircleVertices), point))
		remainderPoly := safePolyclipOp(func() polyclip.Polygon {
			return toPolyclip(current).Construct(polyclip.DIFFERENCE, coverCircle)
		})
		remainder := fromPolyclip(remainderPoly)
		if len(remainder) == 0 {
			break
		}
		next := largestFragment(remainder)
		// Area-shrink guard: if the DIFFERENCE removed less than 0.1 km²,
		// polyclip returned degenerate/identical geometry — stop to avoid
		// an infinite loop. A ratio-based guard (e.g. 1%) would fire on
		// national-scale fragments where a 44 km circle shrinks a 1.2 M km²
		// void by only ~0.36%, which is a genuine reduction.
		if area-next.Area() < 0.1 {
			log.Printf("[MathSugg] fillFragmentIteratively[%d]: fragment didn't shrink (%.2f→%.2f km²) — breaking",
				i, area, next.Area())
			break
		}
		current = next
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
func bestInteriorPoint(frag geometry.Polygon, sites []geometry.Point, radiusKm float64, countryLocal polyclip.Polygon, addedPoints []geometry.Point) (geometry.Point, bool) {
	bbox := boundingBox(frag)
	stepX := (bbox.MaxX - bbox.MinX) / float64(coverageSuggestionGridSteps)
	stepY := (bbox.MaxY - bbox.MinY) / float64(coverageSuggestionGridSteps)
	log.Printf("[MathSugg] bestInteriorPoint: bbox X[%.1f→%.1f] Y[%.1f→%.1f] stepX=%.3f stepY=%.3f sites=%d radiusKm=%.3f frag_vertices=%d",
		bbox.MinX, bbox.MaxX, bbox.MinY, bbox.MaxY, stepX, stepY, len(sites), radiusKm, len(frag))

	// Degenerate bbox guard: if the fragment collapses to a line or point,
	// no grid point can land strictly inside it.
	if bbox.MaxX-bbox.MinX < 1e-9 || bbox.MaxY-bbox.MinY < 1e-9 {
		log.Printf("[MathSugg] bestInteriorPoint: degenerate bbox (width=%.2e height=%.2e) — returning false",
			bbox.MaxX-bbox.MinX, bbox.MaxY-bbox.MinY)
		return geometry.Point{}, false
	}

	// Polyclip can accumulate vertices on the outer ring after repeated
	// DIFFERENCE operations even when the clipping circle does not intersect
	// the fragment. An O(n_vertices) ray-cast called 2601 times becomes the
	// bottleneck when n_vertices grows into the hundreds or thousands.
	//
	// Mitigation: if the fragment has more than coverageMaxContainsVertices
	// vertices, build a decimated copy (every k-th vertex) for the grid's
	// Contains check. We keep the full polygon for Pass 2 (usefulCircleArea),
	// which uses a polyclip INTERSECTION rather than Contains, so precision
	// is preserved where it matters.
	const coverageMaxContainsVertices = 100
	fragForContains := frag
	if len(frag) > coverageMaxContainsVertices {
		step := (len(frag) + coverageMaxContainsVertices - 1) / coverageMaxContainsVertices
		simplified := make(geometry.Polygon, 0, coverageMaxContainsVertices)
		for k := 0; k < len(frag); k += step {
			simplified = append(simplified, frag[k])
		}
		fragForContains = simplified
		log.Printf("[MathSugg] bestInteriorPoint: frag decimated %d→%d vertices for grid Contains",
			len(frag), len(fragForContains))
	}

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
			if !fragForContains.Contains(pt) {
				continue
			}
			// Proximity rejection: discard any candidate within
			// radiusKm×coverageSuggestionSeparationFactor of a suggestion
			// already placed in this iterative run. This prevents the grid
			// from proposing a point whose coverage circle would heavily
			// overlap the previous one (clustering).
			if radiusKm > 0 {
				minSep := radiusKm * coverageSuggestionSeparationFactor
				tooClose := false
				for _, ap := range addedPoints {
					dx := pt.X - ap.X
					dy := pt.Y - ap.Y
					if dx*dx+dy*dy < minSep*minSep {
						tooClose = true
						break
					}
				}
				if tooClose {
					continue
				}
			}
			// Virgin zone (no branches): score by squared distance to the
			// polygon boundary — maximising this gives the true geometric
			// Pole of Inaccessibility (Chebyshev centre), the point deepest
			// inside the zone away from all edges.
			// With branches: score by distance to nearest branch site, so the
			// suggestion lands in the most under-served part of the gap.
			var score float64
			if len(sites) == 0 {
				score = distToPolygonBoundary2(pt, frag)
			} else {
				score = nearestSiteDist2(pt, sites)
			}
			candidates = append(candidates, candidate{point: pt, dist2: score})
		}
	}
	log.Printf("[MathSugg] bestInteriorPoint: grid %dx%d → %d interior candidates",
		coverageSuggestionGridSteps+1, coverageSuggestionGridSteps+1, len(candidates))
	if len(candidates) == 0 {
		log.Printf("[MathSugg] bestInteriorPoint: NONE — sliver/degenerate fragment, falling back to farthestVertex")
		return geometry.Point{}, false
	}

	// Filter NaN scores before sorting: sort.Slice's total-order requirement
	// is violated by NaN (a > NaN == false for any a), which can corrupt the
	// sort output in pathological cases with degenerate projected geometry.
	clean := candidates[:0]
	for _, c := range candidates {
		if !math.IsNaN(c.dist2) {
			clean = append(clean, c)
		}
	}
	candidates = clean
	if len(candidates) == 0 {
		log.Printf("[MathSugg] bestInteriorPoint: all candidates had NaN score — returning false")
		return geometry.Point{}, false
	}

	sort.Slice(candidates, func(i, j int) bool { return candidates[i].dist2 > candidates[j].dist2 })
	if len(candidates) > coverageInteriorPointCandidates {
		candidates = candidates[:coverageInteriorPointCandidates]
	}

	if radiusKm <= 0 {
		log.Printf("[MathSugg] bestInteriorPoint: radiusKm=0, returning first candidate (%.1f, %.1f)",
			candidates[0].point.X, candidates[0].point.Y)
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
	log.Printf("[MathSugg] bestInteriorPoint: BEST (%.1f, %.1f) score=%.1f usefulArea=%.2f km²",
		best.point.X, best.point.Y, best.dist2, bestUsefulArea)
	return best.point, true
}

// safePolyclipOp executes a polyclip boolean operation safely: if the library
// panics (which can happen on degenerate geometry from chained DIFFERENCE ops),
// the panic is recovered and an empty polygon is returned. This prevents a
// single bad geometry from crashing the server goroutine.
func safePolyclipOp(fn func() polyclip.Polygon) (result polyclip.Polygon) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[MathSugg] PANIC in polyclip op: %v — returning empty result", r)
			result = polyclip.Polygon{}
		}
	}()
	return fn()
}

// usefulCircleArea returns the area (km²) of a simulated coverage circle of
// radiusKm centred on point that falls within countryLocal (Argentina's
// contour, already projected into the same local km frame) — the part of the
// circle that would actually contribute coverage on national territory.
func usefulCircleArea(point geometry.Point, radiusKm float64, countryLocal polyclip.Polygon) float64 {
	circle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), point))
	result := safePolyclipOp(func() polyclip.Polygon { return circle.Construct(polyclip.INTERSECTION, countryLocal) })
	return sumArea(fromPolyclip(result))
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
// sites. Returns +Inf for an empty sites slice; bestInteriorPoint dispatches
// to distToPolygonBoundary2 before reaching this function in that case, so
// +Inf acts only as a safety guard for unexpected callers.
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

// distToPolygonBoundary2 returns the squared minimum distance from pt to the
// nearest edge of poly. Used as the Pass-1 score for bestInteriorPoint in
// "virgin zone" mode (no branch sites): the point that maximises this distance
// is the true geometric Pole of Inaccessibility — the Chebyshev centre of the
// polygon, as deep as possible from every boundary.
func distToPolygonBoundary2(pt geometry.Point, poly geometry.Polygon) float64 {
	n := len(poly)
	if n < 2 {
		return 0
	}
	min2 := math.Inf(1)
	for i := 0; i < n; i++ {
		a, b := poly[i], poly[(i+1)%n]
		if d2 := pointToSegment2(pt, a, b); d2 < min2 {
			min2 = d2
		}
	}
	return min2
}

// pointToSegment2 returns the squared distance from pt to the line segment [a, b].
func pointToSegment2(pt, a, b geometry.Point) float64 {
	dx, dy := b.X-a.X, b.Y-a.Y
	if dx == 0 && dy == 0 {
		return geometry.Dist2(pt, a)
	}
	t := ((pt.X-a.X)*dx + (pt.Y-a.Y)*dy) / (dx*dx + dy*dy)
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	cx, cy := a.X+t*dx, a.Y+t*dy
	ddx, ddy := pt.X-cx, pt.Y-cy
	return ddx*ddx + ddy*ddy
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

	country := safePolyclipOp(func() polyclip.Polygon { return circle.Construct(polyclip.INTERSECTION, countryLocal) })
	actualAddedKm2 := sumArea(fromPolyclip(country))

	affected := make([]string, 0)
	for _, nc := range cells {
		cell := safePolyclipOp(func() polyclip.Polygon { return circle.Construct(polyclip.INTERSECTION, nc.poly) })
		if sumArea(fromPolyclip(cell)) > 0 {
			affected = append(affected, nc.name)
		}
	}
	return actualAddedKm2, affected
}
