package geo

import (
	_ "embed"
	"sync"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geojson"
	"github.com/paulmach/orb/planar"
)

// parques_industriales.geojson is the official IGN dataset
// "áreas de fabricación y procesamiento" (industria-servicios:
// areas_de_fabricacion_y_procesamiento_AC070), which covers industrial parks
// and petrochemical complexes across Argentina. Downloaded once from the IGN
// GeoServer WFS in EPSG:4326 and embedded so coverage analysis never depends on
// a live network call (no Overpass timeouts, works offline, deterministic).
//
//go:embed data/parques_industriales.geojson
var industrialGeoJSON []byte

// industrialZone is one IGN industrial-area feature, pre-indexed with its
// bounding box and centre point for fast spatial filtering.
type industrialZone struct {
	name   string
	geom   orb.MultiPolygon
	bound  orb.Bound
	centre orb.Point // bound centre, [lng, lat]
}

var (
	industrialOnce  sync.Once
	industrialZones []industrialZone
)

// loadIndustrialZones parses the embedded IGN dataset once, lazily. Panics on a
// malformed asset — a packaging error, not a runtime condition callers handle.
func loadIndustrialZones() {
	industrialOnce.Do(func() {
		fc, err := geojson.UnmarshalFeatureCollection(industrialGeoJSON)
		if err != nil {
			panic("geo: parques_industriales.geojson inválido: " + err.Error())
		}
		for _, f := range fc.Features {
			var mp orb.MultiPolygon
			switch g := f.Geometry.(type) {
			case orb.MultiPolygon:
				mp = g
			case orb.Polygon:
				mp = orb.MultiPolygon{g}
			default:
				continue
			}
			if len(mp) == 0 {
				continue
			}
			b := mp.Bound()
			name, _ := f.Properties["nombre_geografico"].(string)
			industrialZones = append(industrialZones, industrialZone{
				name:   name,
				geom:   mp,
				bound:  b,
				centre: b.Center(),
			})
		}
	})
}

// IndustrialZoneCount returns how many industrial zones the embedded IGN dataset
// holds. Useful for a startup log line / health check.
func IndustrialZoneCount() int {
	loadIndustrialZones()
	return len(industrialZones)
}

// IndustrialRingsInBBox returns the outer rings of every IGN industrial zone
// whose bounding box intersects the query box, as closed [lat, lng] rings ready
// for Leaflet. The query box is in degrees: minLng, minLat, maxLng, maxLat.
// Inner rings (holes) are omitted — they are irrelevant for an overlay fill.
func IndustrialRingsInBBox(minLng, minLat, maxLng, maxLat float64) [][][2]float64 {
	loadIndustrialZones()
	query := orb.Bound{
		Min: orb.Point{minLng, minLat},
		Max: orb.Point{maxLng, maxLat},
	}
	rings := make([][][2]float64, 0, 64)
	for _, z := range industrialZones {
		if !z.bound.Intersects(query) {
			continue
		}
		for _, poly := range z.geom {
			if len(poly) == 0 || len(poly[0]) < 3 {
				continue
			}
			outer := poly[0] // outer ring; holes ignored for display
			ring := make([][2]float64, len(outer))
			for i, pt := range outer {
				ring[i] = [2]float64{pt[1], pt[0]} // orb is [lng,lat] → [lat,lng]
			}
			rings = append(rings, ring)
		}
	}
	return rings
}

// IndustrialZoneNear reports whether any IGN industrial zone lies within
// radiusKm of (lat, lng). A point inside a zone always counts as a match; a
// point whose distance to a zone's bounding-box centre is within the radius also
// matches (a faithful, more accurate replacement for the previous centroid-based
// Overpass heuristic).
func IndustrialZoneNear(lat, lng, radiusKm float64) bool {
	loadIndustrialZones()
	p := orb.Point{lng, lat}
	for _, z := range industrialZones {
		if haversine(lat, lng, z.centre[1], z.centre[0]) <= radiusKm {
			return true
		}
		if planar.MultiPolygonContains(z.geom, p) {
			return true
		}
	}
	return false
}
