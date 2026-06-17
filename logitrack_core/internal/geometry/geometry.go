// Package geometry implements pure 2D computational geometry used by the
// branch-coverage detector: polygon area (Shoelace), centroid, point-in-polygon
// and Voronoi cell construction by half-plane intersection.
//
// The package is intentionally domain-free: it knows nothing about branches,
// shipments or geography. Callers project geographic coordinates onto a planar
// metric space (kilometres) before using these primitives — see
// internal/service/coverage.go.
package geometry

import "math"

// Point is a 2D point in an arbitrary planar coordinate system.
type Point struct {
	X float64
	Y float64
}

// Polygon is an ordered list of vertices describing a simple polygon. The first
// and last vertices are joined implicitly (the ring is closed automatically);
// callers should NOT repeat the first vertex at the end.
type Polygon []Point

// BBox is an axis-aligned bounding box.
type BBox struct {
	MinX float64
	MinY float64
	MaxX float64
	MaxY float64
}

// Rect returns the bounding box as a counter-clockwise polygon.
func (b BBox) Rect() Polygon {
	return Polygon{
		{b.MinX, b.MinY},
		{b.MaxX, b.MinY},
		{b.MaxX, b.MaxY},
		{b.MinX, b.MaxY},
	}
}

// Pad returns a copy of the bbox expanded by margin on every side.
func (b BBox) Pad(margin float64) BBox {
	return BBox{b.MinX - margin, b.MinY - margin, b.MaxX + margin, b.MaxY + margin}
}

// SignedArea returns the signed area of the polygon via the Shoelace formula.
// Positive for counter-clockwise winding, negative for clockwise.
func (p Polygon) SignedArea() float64 {
	n := len(p)
	if n < 3 {
		return 0
	}
	var sum float64
	for i := 0; i < n; i++ {
		a := p[i]
		b := p[(i+1)%n]
		sum += a.X*b.Y - b.X*a.Y
	}
	return sum / 2
}

// Area returns the absolute (unsigned) area of the polygon.
func (p Polygon) Area() float64 {
	return math.Abs(p.SignedArea())
}

// Centroid returns the area-weighted centroid of the polygon. For a degenerate
// polygon (fewer than 3 vertices, or zero area) it falls back to the arithmetic
// mean of the vertices.
func (p Polygon) Centroid() Point {
	n := len(p)
	if n == 0 {
		return Point{}
	}
	if n < 3 {
		return p.vertexMean()
	}
	var cx, cy, a2 float64
	for i := 0; i < n; i++ {
		a := p[i]
		b := p[(i+1)%n]
		cross := a.X*b.Y - b.X*a.Y
		cx += (a.X + b.X) * cross
		cy += (a.Y + b.Y) * cross
		a2 += cross
	}
	if a2 == 0 {
		return p.vertexMean()
	}
	return Point{X: cx / (3 * a2), Y: cy / (3 * a2)}
}

func (p Polygon) vertexMean() Point {
	var sx, sy float64
	for _, v := range p {
		sx += v.X
		sy += v.Y
	}
	n := float64(len(p))
	return Point{X: sx / n, Y: sy / n}
}

// Contains reports whether pt lies inside the polygon (boundary counts as
// inside) using the ray-casting / even-odd rule. Vertices and edges are treated
// as inside so that shipment-to-cell assignment never leaves a boundary point
// unassigned.
func (p Polygon) Contains(pt Point) bool {
	n := len(p)
	if n < 3 {
		return false
	}
	inside := false
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		a := p[i]
		b := p[j]
		if onSegment(a, b, pt) {
			return true
		}
		// Ray cast to the +X direction.
		if (a.Y > pt.Y) != (b.Y > pt.Y) {
			xCross := (b.X-a.X)*(pt.Y-a.Y)/(b.Y-a.Y) + a.X
			if pt.X < xCross {
				inside = !inside
			}
		}
	}
	return inside
}

const epsilon = 1e-9

// onSegment reports whether pt lies on the closed segment a-b (within epsilon).
func onSegment(a, b, pt Point) bool {
	cross := (b.X-a.X)*(pt.Y-a.Y) - (b.Y-a.Y)*(pt.X-a.X)
	if math.Abs(cross) > epsilon {
		return false
	}
	// Collinear: check it falls within the bounding box of the segment.
	if pt.X < math.Min(a.X, b.X)-epsilon || pt.X > math.Max(a.X, b.X)+epsilon {
		return false
	}
	if pt.Y < math.Min(a.Y, b.Y)-epsilon || pt.Y > math.Max(a.Y, b.Y)+epsilon {
		return false
	}
	return true
}

// Dist2 returns the squared Euclidean distance between two points.
func Dist2(a, b Point) float64 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	return dx*dx + dy*dy
}
