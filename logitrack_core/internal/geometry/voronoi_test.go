package geometry

import (
	"math"
	"testing"
)

var unitBox = BBox{MinX: 0, MinY: 0, MaxX: 10, MaxY: 10}

func TestVoronoi_TwoSites_SplitInHalf(t *testing.T) {
	// Dos sitios espejados horizontalmente: la frontera es x = 5, cada celda
	// cubre la mitad del box (50 unidades²).
	sites := []Point{{3, 5}, {7, 5}}
	cells := VoronoiCells(sites, unitBox)
	if len(cells) != 2 {
		t.Fatalf("esperaba 2 celdas, dio %d", len(cells))
	}
	for i, cell := range cells {
		if cell == nil {
			t.Fatalf("celda %d es nil", i)
		}
		if a := cell.Area(); !almostEqual(a, 50.0, 1e-6) {
			t.Fatalf("celda %d área = %v, esperado 50", i, a)
		}
	}
}

func TestVoronoi_CellsContainTheirSite(t *testing.T) {
	sites := []Point{{2, 2}, {8, 2}, {5, 8}, {2, 8}}
	cells := VoronoiCells(sites, unitBox)
	for i, site := range sites {
		if cells[i] == nil {
			t.Fatalf("celda %d nil", i)
		}
		if !cells[i].Contains(site) {
			t.Fatalf("la celda %d no contiene su propio sitio %+v", i, site)
		}
	}
}

func TestVoronoi_AreasSumToBox(t *testing.T) {
	// La unión de las celdas debe cubrir exactamente el box (sin solapamiento ni
	// huecos), por lo que la suma de áreas == área del box.
	sites := []Point{{1, 1}, {9, 1}, {9, 9}, {1, 9}, {5, 5}}
	cells := VoronoiCells(sites, unitBox)
	var total float64
	for i, c := range cells {
		if c == nil {
			t.Fatalf("celda %d nil", i)
		}
		total += c.Area()
	}
	boxArea := 100.0
	if !almostEqual(total, boxArea, 1e-6) {
		t.Fatalf("suma de áreas = %v, esperado %v (área del box)", total, boxArea)
	}
}

func TestVoronoi_NearestSiteWins(t *testing.T) {
	// Para puntos de prueba, la celda que los contiene debe corresponder al
	// sitio euclidianamente más cercano.
	sites := []Point{{2, 2}, {8, 2}, {8, 8}, {2, 8}}
	cells := VoronoiCells(sites, unitBox)
	probes := []Point{{1, 1}, {9, 1}, {9, 9}, {1, 9}, {3, 3}, {7, 7}}
	for _, probe := range probes {
		nearest := 0
		best := math.Inf(1)
		for i, s := range sites {
			if d := Dist2(probe, s); d < best {
				best = d
				nearest = i
			}
		}
		if !cells[nearest].Contains(probe) {
			t.Fatalf("punto %+v debería caer en la celda del sitio más cercano #%d", probe, nearest)
		}
	}
}

func TestVoronoi_CoincidentSites_EmptyCell(t *testing.T) {
	sites := []Point{{5, 5}, {5, 5}}
	cells := VoronoiCells(sites, unitBox)
	if cells[0] != nil || cells[1] != nil {
		t.Fatalf("sitios coincidentes deberían producir celdas vacías, dio %+v", cells)
	}
}

func TestVoronoi_SingleSite_CoversBox(t *testing.T) {
	sites := []Point{{5, 5}}
	cells := VoronoiCells(sites, unitBox)
	if len(cells) != 1 || cells[0] == nil {
		t.Fatalf("un solo sitio debe cubrir todo el box")
	}
	if a := cells[0].Area(); !almostEqual(a, 100.0, 1e-9) {
		t.Fatalf("área con un solo sitio = %v, esperado 100", a)
	}
}
