package service

import (
	"log"

	"github.com/ctessum/polyclip-go"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/geometry"
	"github.com/logitrack/core/internal/model"
)

const (
	// coverageMathMinFragAreaRatio is the fraction of TierraFértil area a void
	// fragment must represent to produce a MathematicalSuggestion.
	// Using 2 % allows a 10 000 km² region (e.g. AMBA) to surface suggestions
	// for voids as small as 200 km², while the national canvas (~2.8 M km²)
	// naturally gets a ~56 000 km² floor — close to the per-cell constant.
	coverageMathMinFragAreaRatio = 0.02

	// coverageMathAbsMinFragAreaKm2 is the absolute lower bound on the adaptive
	// threshold so that only true floating-point noise slivers (< 0.1 km² ≈
	// 316 m × 316 m) from polygon clipping are ignored. The adaptive ratio
	// (coverageMathMinFragAreaRatio × fertileArea) governs filtering for any
	// zone ≥ 5 km²; this floor only kicks in for smaller zones, allowing a
	// single-neighbourhood custom area to still receive a suggestion.
	coverageMathAbsMinFragAreaKm2 = 0.1
)

// computeTierraFertil builds the "Tierra Fértil" — the canvas available for
// branch-placement analysis — by starting from the given boundary polygon (or
// Argentina's national outline when boundary has fewer than 3 points) and
// iteratively subtracting each dangerous zone via DIFFERENCE. All coordinates
// are projected into the planar km frame defined by proj before any boolean
// operation.
//
// Returns nil when dangerous zones consume the entire canvas. Safe to call when
// dangerousZones is nil/empty — behaves identically to the former two-branch
// if/else that projected only the boundary.
func computeTierraFertil(boundary []model.LatLng, dangerousZones [][]model.LatLng, proj equirectProjector) polyclip.Polygon {
	var fertile polyclip.Polygon
	if len(boundary) >= 3 {
		fertile = projectRings([][]model.LatLng{boundary}, proj)
	} else {
		fertile = projectCountry(geo.ArgentinaContour(), proj)
	}
	// Ensure every outer ring is CCW (positive signed area) regardless of the
	// source — user-drawn polygons are often CW, and geo.ArgentinaContour()
	// also uses CW winding. polyclip boolean operations and voidFragments both
	// rely on CCW = outer, CW = hole.
	for i, c := range fertile {
		if len(c) < 3 {
			continue
		}
		ring := make(geometry.Polygon, len(c))
		for j, v := range c {
			ring[j] = geometry.Point{X: v.X, Y: v.Y}
		}
		if ring.SignedArea() < 0 {
			for l, r := 0, len(fertile[i])-1; l < r; l, r = l+1, r-1 {
				fertile[i][l], fertile[i][r] = fertile[i][r], fertile[i][l]
			}
		}
	}
	for _, zone := range dangerousZones {
		if len(zone) < 3 {
			continue
		}
		hazard := projectRings([][]model.LatLng{zone}, proj)
		fertile = fertile.Construct(polyclip.DIFFERENCE, hazard)
		if len(fertile) == 0 {
			return nil
		}
	}
	return fertile
}

// voidFragments converts the polyclip result of a boolean DIFFERENCE into
// genuine uncovered fragments, discarding:
//   - degenerate rings (< 3 vertices),
//   - hole rings — contours whose signed area is negative (clockwise winding),
//     which polyclip inserts when a dangerous-zone subtraction leaves an
//     interior hole in the canvas.
//
// Without this filter, hole contours would appear as large "uncovered" polygons
// whose Pole of Inaccessibility points land inside a dangerous zone.
func voidFragments(p polyclip.Polygon) []geometry.Polygon {
	out := make([]geometry.Polygon, 0, len(p))
	for idx, c := range p {
		if len(c) < 3 {
			log.Printf("[MathSugg] voidFragments: ring[%d] vertices=%d → SKIP (degenerate)", idx, len(c))
			continue
		}
		ring := make(geometry.Polygon, len(c))
		for i, v := range c {
			ring[i] = geometry.Point{X: v.X, Y: v.Y}
		}
		sa := ring.SignedArea()
		// Hole rings have negative signed area (clockwise winding in polyclip).
		// Skip them — they represent excluded zones, not uncovered territory.
		if sa < 0 {
			log.Printf("[MathSugg] voidFragments: ring[%d] signedArea=%.2f km² → SKIP (hole/CW)", idx, sa)
			continue
		}
		log.Printf("[MathSugg] voidFragments: ring[%d] signedArea=%.2f km² vertices=%d → KEEP", idx, sa, len(ring))
		out = append(out, ring)
	}
	return out
}

// computeMathematicalSuggestions finds Pole-of-Inaccessibility points in the
// global uncovered void: the Tierra Fértil area that remains after subtracting
// every existing branch's simulated coverage circle in one combined pass.
//
// Unlike SuggestedLocations (per-cell, only for "crítico" cells), this function
// operates on the entire uncovered canvas so suggestions are never clipped to a
// single branch's Voronoi territory. It works correctly for small custom zones
// (e.g. AMBA ~10 600 km²) by using an adaptive minimum-fragment threshold
// instead of the large national-scale constant.
//
// Edge cases:
//   - 0 branches: the entire TierraFértil is the void — find its pole directly.
//   - Branch outside boundary: its circle won't intersect TierraFértil; the
//     DIFFERENCE is a no-op, which is correct.
//   - Hole rings from dangerous zones: filtered by voidFragments.
//
// Returns nil when radiusKm ≤ 0, when tierraFertil is empty, or when all of
// TierraFértil is already covered.
func computeMathematicalSuggestions(
	tierraFertil polyclip.Polygon,
	branchSites []model.LatLng,
	radiusKm float64,
	proj equirectProjector,
	otherCells []namedCellPoly,
	maxSuggestions int,
) (out []model.SuggestedLocation) {
	// Top-level panic guard: polyclip can panic on degenerate geometry produced
	// by successive boolean operations. We prefer returning 0 suggestions over
	// crashing the server goroutine.
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[MathSugg] PANIC recovered in computeMathematicalSuggestions: %v — returning 0 suggestions", r)
			out = nil
		}
	}()

	log.Printf("[MathSugg] computeMathematicalSuggestions: branchSites=%d, radiusKm=%.3f, tierraFertil contours=%d",
		len(branchSites), radiusKm, len(tierraFertil))

	if radiusKm <= 0 || len(tierraFertil) == 0 {
		log.Printf("[MathSugg] ABORT early-guard: radiusKm=%.3f tierraFertil=%d", radiusKm, len(tierraFertil))
		return nil
	}

	// Adaptive minimum-fragment threshold: 2 % of TierraFértil area, with an
	// absolute floor so degenerate slivers are always skipped.
	fertileAreaKm2 := sumArea(fromPolyclip(tierraFertil))
	minFragAreaKm2 := fertileAreaKm2 * coverageMathMinFragAreaRatio
	if minFragAreaKm2 < coverageMathAbsMinFragAreaKm2 {
		minFragAreaKm2 = coverageMathAbsMinFragAreaKm2
	}
	log.Printf("[MathSugg] fertileAreaKm2=%.2f → minFragAreaKm2=%.3f (ratio=%.0f%% floor=%.2f)",
		fertileAreaKm2, minFragAreaKm2, coverageMathMinFragAreaRatio*100, coverageMathAbsMinFragAreaKm2)

	// Projected branch sites as the repulsion set for bestInteriorPoint.
	// This slice grows inside fillFragmentIteratively as new suggestions are
	// placed, so subsequent fragments also repel from already-placed points.
	projSites := make([]geometry.Point, len(branchSites))
	for i, s := range branchSites {
		projSites[i] = proj.project(s.Lat, s.Lng)
	}

	// Compute the global void: TierraFértil minus every branch's coverage circle.
	// When branchSites is empty (0 branches in the system), void = tierraFertil
	// unchanged — the entire canvas is the void.
	void := tierraFertil
	for i, site := range branchSites {
		pt := proj.project(site.Lat, site.Lng)
		circle := toPolyclip(translatePolygon(circlePolygon(radiusKm, coverageSuggestionCircleVertices), pt))
		before := len(void)
		void = void.Construct(polyclip.DIFFERENCE, circle)
		log.Printf("[MathSugg] circle subtract[%d] site=(%.4f,%.4f) proj=(%.1f,%.1f): void contours %d→%d",
			i, site.Lat, site.Lng, pt.X, pt.Y, before, len(void))
		if len(void) == 0 {
			log.Printf("[MathSugg] ABORT: void is empty after circle[%d] → entire TierraFértil is covered", i)
			return nil
		}
	}

	// A synthetic cell with empty attribution — mathematical suggestions are
	// derived from the global void, not any single branch's territory.
	globalCell := model.CoverageCell{BranchID: "", BranchName: ""}

	frags := voidFragments(void)
	log.Printf("[MathSugg] voidFragments: void had %d contours → %d outer fragments", len(void), len(frags))

	for i, frag := range frags {
		if maxSuggestions > 0 && len(out) >= maxSuggestions {
			log.Printf("[MathSugg] fragment[%d]: reached maxSuggestions=%d — stopping early", i, maxSuggestions)
			break
		}
		area := frag.Area()
		if area < minFragAreaKm2 {
			log.Printf("[MathSugg] fragment[%d]: area=%.3f km² < threshold %.3f → SKIP", i, area, minFragAreaKm2)
			continue
		}
		log.Printf("[MathSugg] fragment[%d]: area=%.3f km² ≥ threshold %.3f → calling fillFragmentIteratively", i, area, minFragAreaKm2)
		before := len(out)
		newSuggs := fillFragmentIteratively(
			globalCell, proj, frag, radiusKm,
			&projSites, tierraFertil, otherCells,
			minFragAreaKm2, coverageSuggestionMaxPerFragment,
		)
		if maxSuggestions > 0 && len(out)+len(newSuggs) > maxSuggestions {
			newSuggs = newSuggs[:maxSuggestions-len(out)]
		}
		out = append(out, newSuggs...)
		log.Printf("[MathSugg] fragment[%d]: fillFragmentIteratively added %d suggestions (total so far: %d)",
			i, len(out)-before, len(out))
	}
	log.Printf("[MathSugg] DONE: returning %d MathematicalSuggestions", len(out))
	return out
}
