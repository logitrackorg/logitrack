package service

import (
	"math"
	"testing"

	"github.com/logitrack/core/internal/geometry"
)

// TestBestInteriorPoint_BalancesMultipleSites verifies the core "Pole of
// Inaccessibility" behaviour: with two existing branch sites pulling from
// different directions, the winning point is the one that maximizes the
// distance to the *nearest* of them — here, the midpoint of the opposite
// edge — rather than a vertex of the fragment. This is the fix for
// suggestions pinning to fragment vertices (which sit on the country border
// or the simulated coverage circle's arc).
func TestBestInteriorPoint_BalancesMultipleSites(t *testing.T) {
	square := geometry.Polygon{
		{X: 0, Y: 0},
		{X: 10, Y: 0},
		{X: 10, Y: 10},
		{X: 0, Y: 10},
	}
	// Both sites sit on the bottom edge; the point balancing the distance to
	// each is the midpoint of the top edge, (5, 10).
	sites := []geometry.Point{{X: 0, Y: 0}, {X: 10, Y: 0}}

	pt, ok := bestInteriorPoint(square, sites)
	if !ok {
		t.Fatal("expected an interior point to be found")
	}
	if math.Abs(pt.X-5) > 1e-6 || math.Abs(pt.Y-10) > 1e-6 {
		t.Errorf("expected the point balancing both sites at (5,10), got %+v", pt)
	}
	for _, v := range square {
		if math.Abs(pt.X-v.X) < 1e-6 && math.Abs(pt.Y-v.Y) < 1e-6 {
			t.Errorf("expected a non-vertex point, got a fragment vertex %+v", pt)
		}
	}
}

// TestBestInteriorPoint_ResultIsInsidePolygon verifies the grid search only
// ever returns points that lie inside (or on the boundary of) the fragment —
// candidates outside are discarded.
func TestBestInteriorPoint_ResultIsInsidePolygon(t *testing.T) {
	square := geometry.Polygon{
		{X: 0, Y: 0},
		{X: 10, Y: 0},
		{X: 10, Y: 10},
		{X: 0, Y: 10},
	}
	sites := []geometry.Point{{X: -50, Y: -50}}

	pt, ok := bestInteriorPoint(square, sites)
	if !ok {
		t.Fatal("expected an interior point to be found")
	}
	if !square.Contains(pt) {
		t.Fatalf("returned point %+v is not inside the polygon", pt)
	}
}

// TestBestInteriorPoint_NoneForDegenerateFragment verifies a degenerate
// (zero-area, < 3 vertex) fragment reports ok=false so callers fall back to
// farthestVertex.
func TestBestInteriorPoint_NoneForDegenerateFragment(t *testing.T) {
	line := geometry.Polygon{{X: 0, Y: 0}, {X: 1, Y: 0}}
	if _, ok := bestInteriorPoint(line, nil); ok {
		t.Error("expected no interior point for a degenerate (zero-area) fragment")
	}
}

func TestBoundingBox(t *testing.T) {
	poly := geometry.Polygon{{X: -2, Y: 5}, {X: 3, Y: -1}, {X: 0, Y: 8}}
	bb := boundingBox(poly)
	if bb.MinX != -2 || bb.MaxX != 3 || bb.MinY != -1 || bb.MaxY != 8 {
		t.Errorf("unexpected bbox %+v", bb)
	}
}

func TestNearestSiteDist2(t *testing.T) {
	sites := []geometry.Point{{X: 0, Y: 0}, {X: 10, Y: 0}}
	if got := nearestSiteDist2(geometry.Point{X: 1, Y: 0}, sites); math.Abs(got-1) > 1e-9 {
		t.Errorf("expected dist2=1, got %v", got)
	}
	if !math.IsInf(nearestSiteDist2(geometry.Point{X: 1, Y: 0}, nil), 1) {
		t.Error("expected +Inf for an empty sites slice")
	}
}
