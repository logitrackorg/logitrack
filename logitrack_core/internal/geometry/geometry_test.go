package geometry

import (
	"math"
	"testing"
)

func almostEqual(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

func TestPolygonArea_UnitSquare(t *testing.T) {
	sq := Polygon{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	if got := sq.Area(); !almostEqual(got, 1.0, 1e-9) {
		t.Fatalf("área cuadrado unitario = %v, esperado 1.0", got)
	}
}

func TestPolygonArea_WindingIndependent(t *testing.T) {
	ccw := Polygon{{0, 0}, {2, 0}, {2, 3}, {0, 3}}
	cw := Polygon{{0, 0}, {0, 3}, {2, 3}, {2, 0}}
	if a := ccw.Area(); !almostEqual(a, 6.0, 1e-9) {
		t.Fatalf("área CCW = %v, esperado 6.0", a)
	}
	if a := cw.Area(); !almostEqual(a, 6.0, 1e-9) {
		t.Fatalf("área CW = %v, esperado 6.0", a)
	}
}

func TestPolygonArea_Triangle(t *testing.T) {
	tri := Polygon{{0, 0}, {4, 0}, {0, 3}}
	if got := tri.Area(); !almostEqual(got, 6.0, 1e-9) {
		t.Fatalf("área triángulo = %v, esperado 6.0", got)
	}
}

func TestPolygonArea_Degenerate(t *testing.T) {
	if a := (Polygon{{0, 0}, {1, 1}}).Area(); a != 0 {
		t.Fatalf("polígono con 2 vértices debe tener área 0, dio %v", a)
	}
}

func TestCentroid_Square(t *testing.T) {
	sq := Polygon{{0, 0}, {2, 0}, {2, 2}, {0, 2}}
	c := sq.Centroid()
	if !almostEqual(c.X, 1.0, 1e-9) || !almostEqual(c.Y, 1.0, 1e-9) {
		t.Fatalf("centroide cuadrado = %+v, esperado {1,1}", c)
	}
}

func TestContains_Inside(t *testing.T) {
	sq := Polygon{{0, 0}, {4, 0}, {4, 4}, {0, 4}}
	if !sq.Contains(Point{2, 2}) {
		t.Fatal("el centro debería estar dentro")
	}
}

func TestContains_Outside(t *testing.T) {
	sq := Polygon{{0, 0}, {4, 0}, {4, 4}, {0, 4}}
	if sq.Contains(Point{5, 2}) {
		t.Fatal("punto externo no debería estar dentro")
	}
}

func TestContains_OnBoundary(t *testing.T) {
	sq := Polygon{{0, 0}, {4, 0}, {4, 4}, {0, 4}}
	// Punto sobre una arista cuenta como dentro (asignación no debe perder bordes).
	if !sq.Contains(Point{4, 2}) {
		t.Fatal("punto sobre la arista debería contar como dentro")
	}
	if !sq.Contains(Point{0, 0}) {
		t.Fatal("vértice debería contar como dentro")
	}
}

func TestContains_OnBoundaryCorner(t *testing.T) {
	tri := Polygon{{0, 0}, {6, 0}, {0, 6}}
	// Punto sobre la hipotenusa.
	if !tri.Contains(Point{3, 3}) {
		t.Fatal("punto sobre la hipotenusa debería contar como dentro")
	}
}
