package geometry

// VoronoiCells computes, for each input site, its Voronoi cell clipped to bbox.
//
// The diagram is built by half-plane intersection rather than Delaunay +
// circumcenters: each cell starts as the bounding rectangle and is clipped by
// the perpendicular-bisector half-plane between its site and every other site,
// keeping the half that is closer to the site. For the handful of branches a
// network has, the O(n²) cost per cell is negligible, and the method handles
// unbounded boundary cells naturally (they are simply truncated by the bbox).
//
// The returned slice is index-aligned with sites. A site that coincides with
// another (or whose cell collapses) yields a nil/empty polygon.
func VoronoiCells(sites []Point, bbox BBox) []Polygon {
	cells := make([]Polygon, len(sites))
	rect := bbox.Rect()
	for i, site := range sites {
		cell := rect
		for j, other := range sites {
			if i == j {
				continue
			}
			if site == other {
				// Coincident sites: bisector is undefined. Leave the cell empty
				// so the caller can surface it as a configuration error.
				cell = nil
				break
			}
			a, b, c := bisectorHalfPlane(site, other)
			cell = clipHalfPlane(cell, a, b, c)
			if len(cell) < 3 {
				cell = nil
				break
			}
		}
		cells[i] = cell
	}
	return cells
}

// bisectorHalfPlane returns coefficients (a, b, c) of the half-plane
// a*x + b*y <= c describing the points at least as close to keep as to other.
//
// Derivation: |x-keep|² <= |x-other|²  ⇒  2(other-keep)·x <= |other|² - |keep|².
func bisectorHalfPlane(keep, other Point) (a, b, c float64) {
	a = 2 * (other.X - keep.X)
	b = 2 * (other.Y - keep.Y)
	c = (other.X*other.X + other.Y*other.Y) - (keep.X*keep.X + keep.Y*keep.Y)
	return a, b, c
}

// clipHalfPlane clips poly against the half-plane a*x + b*y <= c using the
// Sutherland-Hodgman algorithm, returning the part that satisfies the
// inequality. Returns nil if the polygon is fully outside.
func clipHalfPlane(poly Polygon, a, b, c float64) Polygon {
	n := len(poly)
	if n == 0 {
		return nil
	}
	out := make(Polygon, 0, n+2)
	for i := 0; i < n; i++ {
		cur := poly[i]
		nxt := poly[(i+1)%n]
		curVal := a*cur.X + b*cur.Y - c
		nxtVal := a*nxt.X + b*nxt.Y - c
		curIn := curVal <= epsilon
		nxtIn := nxtVal <= epsilon
		if curIn {
			out = append(out, cur)
		}
		// Edge crosses the boundary: add the intersection point.
		if curIn != nxtIn {
			t := curVal / (curVal - nxtVal)
			out = append(out, Point{
				X: cur.X + t*(nxt.X-cur.X),
				Y: cur.Y + t*(nxt.Y-cur.Y),
			})
		}
	}
	if len(out) < 3 {
		return nil
	}
	return out
}
