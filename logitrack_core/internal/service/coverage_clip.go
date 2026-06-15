package service

import (
	"math"

	"github.com/ctessum/polyclip-go"
	"github.com/paulmach/orb"

	"github.com/logitrack/core/internal/geometry"
	"github.com/logitrack/core/internal/model"
)

// toPolyclip wraps a single ring (km-space) as a one-contour polyclip.Polygon.
func toPolyclip(p geometry.Polygon) polyclip.Polygon {
	c := make(polyclip.Contour, len(p))
	for i, v := range p {
		c[i] = polyclip.Point{X: v.X, Y: v.Y}
	}
	return polyclip.Polygon{c}
}

// fromPolyclip converts a (possibly multi-contour) polyclip.Polygon back into
// a list of geometry.Polygon rings — one per disconnected fragment. Contours
// with fewer than 3 points (degenerate intersections) are dropped.
func fromPolyclip(p polyclip.Polygon) []geometry.Polygon {
	out := make([]geometry.Polygon, 0, len(p))
	for _, c := range p {
		if len(c) < 3 {
			continue
		}
		ring := make(geometry.Polygon, len(c))
		for i, v := range c {
			ring[i] = geometry.Point{X: v.X, Y: v.Y}
		}
		out = append(out, ring)
	}
	return out
}

// circlePolygon returns a regular polygon with the given number of vertices
// approximating a circle of radiusKm centred at the origin, in the planar km
// frame. Used to model a simulated branch coverage radius for the DIFFERENCE
// operation against a Voronoi cell.
func circlePolygon(radiusKm float64, vertices int) geometry.Polygon {
	poly := make(geometry.Polygon, vertices)
	for i := 0; i < vertices; i++ {
		theta := 2 * math.Pi * float64(i) / float64(vertices)
		poly[i] = geometry.Point{
			X: radiusKm * math.Cos(theta),
			Y: radiusKm * math.Sin(theta),
		}
	}
	return poly
}

// projectRings projects geographic rings (lat/lng) into the planar km frame
// defined by proj, producing one polyclip contour per ring. Used to bring a
// CoverageCell's already country-clipped geometry back into km space for
// boolean operations against the simulated coverage circle.
func projectRings(rings [][]model.LatLng, proj equirectProjector) polyclip.Polygon {
	var poly polyclip.Polygon
	for _, ring := range rings {
		c := make(polyclip.Contour, len(ring))
		for i, v := range ring {
			p := proj.project(v.Lat, v.Lng)
			c[i] = polyclip.Point{X: p.X, Y: p.Y}
		}
		poly = append(poly, c)
	}
	return poly
}

// projectCountry projects a geographic MultiPolygon (orb, [lng,lat] degrees)
// into the planar km frame defined by proj, producing a polyclip.Polygon with
// one contour per ring (outer boundaries and holes alike). It is recomputed
// per Refresh because proj is centred on the current branch set's centroid.
func projectCountry(mp orb.MultiPolygon, proj equirectProjector) polyclip.Polygon {
	var poly polyclip.Polygon
	for _, p := range mp {
		for _, ring := range p {
			c := make(polyclip.Contour, len(ring))
			for i, pt := range ring {
				// orb points are [lng, lat].
				v := proj.project(pt[1], pt[0])
				c[i] = polyclip.Point{X: v.X, Y: v.Y}
			}
			poly = append(poly, c)
		}
	}
	return poly
}
