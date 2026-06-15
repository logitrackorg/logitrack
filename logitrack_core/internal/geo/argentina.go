// Package geo provides static geographic reference data — currently the
// national outline of Argentina, used by the branch-coverage detector to
// clip Voronoi cells to real territory.
package geo

import (
	_ "embed"
	"sync"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geojson"
)

//go:embed data/argentina.geojson
var argentinaGeoJSON []byte

var (
	argentinaOnce sync.Once
	argentinaMP   orb.MultiPolygon
)

// ArgentinaContour returns the national outline of Argentina as a
// MultiPolygon in [lng, lat] degrees (mainland + Tierra del Fuego). Parsed
// once, lazily, from the embedded GeoJSON asset (Natural Earth 1:50m,
// simplified). Panics if the embedded asset is missing or invalid — this is
// a packaging error, not a runtime condition callers should handle.
func ArgentinaContour() orb.MultiPolygon {
	argentinaOnce.Do(func() {
		fc, err := geojson.UnmarshalFeatureCollection(argentinaGeoJSON)
		if err != nil {
			panic("geo: argentina.geojson inválido: " + err.Error())
		}
		for _, f := range fc.Features {
			switch g := f.Geometry.(type) {
			case orb.Polygon:
				argentinaMP = append(argentinaMP, g)
			case orb.MultiPolygon:
				argentinaMP = append(argentinaMP, g...)
			}
		}
		if len(argentinaMP) == 0 {
			panic("geo: argentina.geojson sin geometría de polígono")
		}
	})
	return argentinaMP
}
