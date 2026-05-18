package service

import (
	"math"
	"sort"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/vrp"
)

// safeRouteZonePenalty es el multiplicador que se aplica a la duración de
// un arco cuyo segmento recto atraviesa una zona peligrosa activa.
// 2.5 ≈ 150 % extra de tiempo: suficiente para que el VRP prefiera un desvío
// de hasta ~2.5x la distancia directa antes de cruzar la zona.
const safeRouteZonePenalty = 2.5

// applyZonePenaltiesToMatrix penaliza (in-place) los arcos de dur cuyos
// segmentos rectos atraviesan alguna zona peligrosa activa.
//
// coords contiene [depot, delivery0, delivery1, ...] — mismo orden que la
// matriz. Las coordenadas son WGS84; para el área típica de una sucursal
// (escala de ciudad) tratarlas como planares es suficiente.
//
// Regla: si el DESTINO j cae dentro de una zona, no se penaliza el arco i→j
// (el envío es una entrega dentro de la zona — no hay alternativa).
// Si el ORIGEN i cae dentro de una zona o el segmento i→j cruza el perímetro,
// se aplica el multiplicador.
// applyZonePenaltiesToMatrix penaliza (in-place) los arcos de dur cuyos
// segmentos rectos atraviesan alguna zona peligrosa activa.
// coords = [depot, delivery0, delivery1, ...] en el mismo orden que la matriz.
func applyZonePenaltiesToMatrix(dur [][]float64, coords []vrp.Coord, zones []model.Zone) {
	if len(zones) == 0 {
		return
	}
	n := len(coords)
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if i == j || dur[i][j] == 0 {
				continue
			}
			// Si el destino está dentro de una zona: entrega en la zona, no penalizar.
			if anyZoneContains(coords[j].Lat, coords[j].Lon, zones) {
				continue
			}
			if segCrossesAnyZone(coords[i].Lat, coords[i].Lon, coords[j].Lat, coords[j].Lon, zones) {
				dur[i][j] *= safeRouteZonePenalty
			}
		}
	}
}

// segCrossesAnyZone returns true if the straight line segment from (p1Lat, p1Lng)
// to (p2Lat, p2Lng) intersects the boundary of any active zone, or if the
// origin point is inside a zone (meaning the route starts inside a danger zone).
func segCrossesAnyZone(p1Lat, p1Lng, p2Lat, p2Lng float64, zones []model.Zone) bool {
	for _, z := range zones {
		if !z.Active || len(z.Polygon) < 3 {
			continue
		}
		// Origin inside zone counts as crossing.
		if pointInPolygon(p1Lat, p1Lng, z.Polygon) {
			return true
		}
		// Check if segment crosses any polygon edge.
		n := len(z.Polygon)
		for k := 0; k < n; k++ {
			a := z.Polygon[k]
			b := z.Polygon[(k+1)%n]
			if segmentsProperlyIntersect(p1Lat, p1Lng, p2Lat, p2Lng, a.Lat, a.Lng, b.Lat, b.Lng) {
				return true
			}
		}
	}
	return false
}

// anyZoneContains returns true if (lat, lng) falls inside any active zone polygon.
func anyZoneContains(lat, lng float64, zones []model.Zone) bool {
	for _, z := range zones {
		if z.Active && pointInPolygon(lat, lng, z.Polygon) {
			return true
		}
	}
	return false
}

// segmentsProperlyIntersect returns true if segment (p1,p2) properly crosses
// segment (p3,p4) — i.e., they share an interior point (not just endpoints).
// Uses the cross-product orientation test.
func segmentsProperlyIntersect(p1Lat, p1Lng, p2Lat, p2Lng, p3Lat, p3Lng, p4Lat, p4Lng float64) bool {
	d1 := crossProduct(p3Lat, p3Lng, p4Lat, p4Lng, p1Lat, p1Lng)
	d2 := crossProduct(p3Lat, p3Lng, p4Lat, p4Lng, p2Lat, p2Lng)
	d3 := crossProduct(p1Lat, p1Lng, p2Lat, p2Lng, p3Lat, p3Lng)
	d4 := crossProduct(p1Lat, p1Lng, p2Lat, p2Lng, p4Lat, p4Lng)
	return sign(d1) != sign(d2) && sign(d3) != sign(d4)
}

// crossProduct returns the z-component of (b-a) × (c-a).
func crossProduct(aLat, aLng, bLat, bLng, cLat, cLng float64) float64 {
	return (bLng-aLng)*(cLat-aLat) - (bLat-aLat)*(cLng-aLng)
}

func sign(v float64) int {
	if v > 0 {
		return 1
	}
	if v < 0 {
		return -1
	}
	return 0
}

// bypassWaypointOffsetDeg separa los waypoints del perímetro de la zona.
// Con 0.003° (~330m) creamos un "halo" alrededor de la zona donde caen los
// waypoints — lo suficientemente lejos para que OSRM, al snappear a la calle
// más cercana, no caiga sobre una calle interior de la zona.
const bypassWaypointOffsetDeg = 0.003

// bypassSampleSpacingDeg densifica los waypoints a lo largo del perímetro.
// Sin esto, OSRM podría cortar por adentro de la zona al rutear entre dos
// vértices distantes. Con un waypoint cada ~220m, OSRM queda forzado a
// seguir el contorno de cerca.
const bypassSampleSpacingDeg = 0.002

// computeBypassWaypoints devuelve los waypoints intermedios para rodear las
// zonas peligrosas activas que cruza el segmento recto p1→p2. Devuelve solo
// los puntos intermedios (sin p1 ni p2). Vacío si no hay bypass necesario.
//
// Reglas:
//   - Si p2 cae dentro de alguna zona: no se evita (entrega adentro).
//   - Si p1 cae dentro: tampoco (saliendo de zona).
//   - Si el segmento cruza una zona "de paso": se rodea por los vértices del
//     polígono, eligiendo el camino más corto entre los dos posibles (horario
//     o antihorario).
//
// Estos waypoints luego se pasan a OSRM Route API como via-points; OSRM snappea
// cada uno a la calle más cercana y devuelve el trayecto real por calles.
func computeBypassWaypoints(p1, p2 vrp.Coord, zones []model.Zone) []vrp.Coord {
	activeZones := make([]model.Zone, 0, len(zones))
	for _, z := range zones {
		if z.Active && len(z.Polygon) >= 3 {
			activeZones = append(activeZones, z)
		}
	}
	if len(activeZones) == 0 {
		return nil
	}

	// Excepción: destino dentro de alguna zona → no se evita.
	for _, z := range activeZones {
		if pointInPolygon(p2.Lat, p2.Lon, z.Polygon) {
			return nil
		}
	}

	type bypassSegment struct {
		t         float64
		waypoints []vrp.Coord
	}
	var segments []bypassSegment

	for _, z := range activeZones {
		// Excepción: origen dentro de la zona → saliendo, no se rodea.
		if pointInPolygon(p1.Lat, p1.Lon, z.Polygon) {
			continue
		}

		polygon := z.Polygon
		n := len(polygon)

		type crossing struct {
			edgeIdx int
			point   vrp.Coord
			t       float64
		}
		var crossings []crossing
		for i := 0; i < n; i++ {
			v1 := polygon[i]
			v2 := polygon[(i+1)%n]
			if pt, t, ok := segmentSegmentIntersection(p1, p2, v1, v2); ok {
				crossings = append(crossings, crossing{i, pt, t})
			}
		}
		if len(crossings) < 2 {
			continue
		}
		sort.Slice(crossings, func(i, j int) bool { return crossings[i].t < crossings[j].t })
		enter := crossings[0]
		exit := crossings[len(crossings)-1]

		// Forward path: desde el vértice posterior al edge de entrada hasta
		// el del edge de salida, en orden de vértices.
		var pathForward []model.ZonePoint
		for i := (enter.edgeIdx + 1) % n; i != (exit.edgeIdx+1)%n; i = (i + 1) % n {
			pathForward = append(pathForward, polygon[i])
		}
		// Backward path: en orden inverso.
		var pathBackward []model.ZonePoint
		for i := enter.edgeIdx; i != exit.edgeIdx; i = (i - 1 + n) % n {
			pathBackward = append(pathBackward, polygon[i])
		}

		lenF := bypassPathLen(enter.point, pathForward, exit.point)
		lenB := bypassPathLen(enter.point, pathBackward, exit.point)
		chosen := pathForward
		if lenB < lenF {
			chosen = pathBackward
		}

		centroid := polygonCentroid(polygon)

		// Construir el path crudo del perímetro: enter → vértices elegidos → exit.
		// (Sin offset todavía — el offset y la densificación se aplican abajo.)
		perimPath := []vrp.Coord{enter.point}
		for _, v := range chosen {
			perimPath = append(perimPath, vrp.Coord{Lat: v.Lat, Lon: v.Lng})
		}
		perimPath = append(perimPath, exit.point)

		// Densificar y offsetear: cada punto del path se aleja del centroide
		// y entre cada par consecutivo se insertan samples (cada ~200m) también
		// offseteados. Resultado: una secuencia densa de puntos sobre el "halo"
		// que rodea la zona, sin huecos donde OSRM pueda cortar por adentro.
		waypoints := []vrp.Coord{}
		for i := 0; i < len(perimPath); i++ {
			pt := perimPath[i]
			waypoints = append(waypoints, offsetOutward(pt, centroid, bypassWaypointOffsetDeg))
			if i+1 < len(perimPath) {
				next := perimPath[i+1]
				edgeLen := math.Hypot(next.Lat-pt.Lat, next.Lon-pt.Lon)
				if edgeLen > bypassSampleSpacingDeg {
					numSamples := int(math.Floor(edgeLen / bypassSampleSpacingDeg))
					for k := 1; k <= numSamples; k++ {
						t := float64(k) / float64(numSamples+1)
						mid := vrp.Coord{
							Lat: pt.Lat + t*(next.Lat-pt.Lat),
							Lon: pt.Lon + t*(next.Lon-pt.Lon),
						}
						waypoints = append(waypoints, offsetOutward(mid, centroid, bypassWaypointOffsetDeg))
					}
				}
			}
		}
		segments = append(segments, bypassSegment{t: enter.t, waypoints: waypoints})
	}

	sort.Slice(segments, func(i, j int) bool { return segments[i].t < segments[j].t })
	var result []vrp.Coord
	for _, s := range segments {
		result = append(result, s.waypoints...)
	}
	return result
}

// segmentSegmentIntersection returns (point, t, true) if segment p1→p2 crosses
// segment v1→v2. t is the position along p1→p2 (0..1).
func segmentSegmentIntersection(p1, p2 vrp.Coord, v1, v2 model.ZonePoint) (vrp.Coord, float64, bool) {
	x1, y1 := p1.Lon, p1.Lat
	x2, y2 := p2.Lon, p2.Lat
	x3, y3 := v1.Lng, v1.Lat
	x4, y4 := v2.Lng, v2.Lat
	denom := (y4-y3)*(x2-x1) - (x4-x3)*(y2-y1)
	if math.Abs(denom) < 1e-12 {
		return vrp.Coord{}, 0, false
	}
	t := ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / denom
	u := ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / denom
	if t < 0 || t > 1 || u < 0 || u > 1 {
		return vrp.Coord{}, 0, false
	}
	return vrp.Coord{Lat: y1 + t*(y2-y1), Lon: x1 + t*(x2-x1)}, t, true
}

func polygonCentroid(polygon []model.ZonePoint) vrp.Coord {
	var lat, lng float64
	for _, p := range polygon {
		lat += p.Lat
		lng += p.Lng
	}
	n := float64(len(polygon))
	return vrp.Coord{Lat: lat / n, Lon: lng / n}
}

func offsetOutward(p, centroid vrp.Coord, offsetDeg float64) vrp.Coord {
	dlat := p.Lat - centroid.Lat
	dlon := p.Lon - centroid.Lon
	norm := math.Hypot(dlat, dlon)
	if norm < 1e-9 {
		return p
	}
	return vrp.Coord{
		Lat: p.Lat + (dlat/norm)*offsetDeg,
		Lon: p.Lon + (dlon/norm)*offsetDeg,
	}
}

func bypassPathLen(enter vrp.Coord, mid []model.ZonePoint, exit vrp.Coord) float64 {
	total := 0.0
	prev := enter
	for _, p := range mid {
		curr := vrp.Coord{Lat: p.Lat, Lon: p.Lng}
		total += ml.HaversineKm(prev.Lat, prev.Lon, curr.Lat, curr.Lon)
		prev = curr
	}
	total += ml.HaversineKm(prev.Lat, prev.Lon, exit.Lat, exit.Lon)
	return total
}
