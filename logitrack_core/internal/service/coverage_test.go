package service

import (
	"math"
	"testing"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/planar"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/geometry"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func fp(v float64) *float64 { return &v }

func coverageBranch(id, name, province string, lat, lng float64) model.Branch {
	return model.Branch{
		ID:        id,
		Name:      name,
		Province:  province,
		Status:    model.BranchStatusActive,
		Latitude:  fp(lat),
		Longitude: fp(lng),
	}
}

// stubCoverageConfig implements coverageConfigProvider with a fixed threshold.
type stubCoverageConfig struct{ threshold float64 }

func (s stubCoverageConfig) Get() model.SystemConfig {
	return model.SystemConfig{MaxCoverageAreaKm2: s.threshold}
}

func newCoverageSvc(branches ...model.Branch) *CoverageService {
	return newCoverageSvcThreshold(0, branches...)
}

func newCoverageSvcThreshold(threshold float64, branches ...model.Branch) *CoverageService {
	repo := repository.NewInMemoryBranchRepository()
	for _, b := range branches {
		repo.Add(b)
	}
	return NewCoverageService(repo, stubCoverageConfig{threshold: threshold})
}

func TestCoverage_CellPerActiveBranch(t *testing.T) {
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()
	if d.BranchCount != 3 || len(d.Cells) != 3 {
		t.Fatalf("esperaba 3 celdas, dio branchCount=%d cells=%d", d.BranchCount, len(d.Cells))
	}
	for _, c := range d.Cells {
		if c.AreaKm2 <= 0 {
			t.Fatalf("celda %s con área no positiva: %v", c.BranchID, c.AreaKm2)
		}
		if len(c.Polygon) == 0 {
			t.Fatalf("celda %s sin fragmentos de polígono", c.BranchID)
		}
		for i, ring := range c.Polygon {
			if len(ring) < 3 {
				t.Fatalf("celda %s, fragmento %d con polígono inválido (%d vértices)", c.BranchID, i, len(ring))
			}
		}
	}
}

func TestCoverage_SkipsBranchesWithoutCoords(t *testing.T) {
	noCoords := model.Branch{ID: "x", Name: "X", Status: model.BranchStatusActive}
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		noCoords,
	)
	d := svc.Refresh()
	if d.BranchCount != 2 {
		t.Fatalf("la sucursal sin coordenadas debe excluirse; branchCount=%d", d.BranchCount)
	}
}

func TestCoverage_AreasAreRealisticKm2(t *testing.T) {
	// Dos sucursales del AMBA a ~30 km. El diagrama usa un bounding box nacional
	// fijo (~6.7M km²), así que cada celda debe ser una fracción de ese total —
	// del orden de millones de km² (no fracciones, no un múltiplo absurdo del
	// área del país) — sanity check de que la proyección a km funciona.
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("laplata", "LP", "Buenos Aires", -34.92, -57.95),
	)
	d := svc.Refresh()
	if len(d.Cells) != 2 {
		t.Fatalf("esperaba 2 celdas")
	}
	for _, c := range d.Cells {
		if c.AreaKm2 < 1000 || c.AreaKm2 > 7000000 {
			t.Fatalf("área fuera de rango plausible para %s: %v km²", c.BranchID, c.AreaKm2)
		}
	}
}

func TestCoverage_EmptyWhenNoBranches(t *testing.T) {
	svc := newCoverageSvc()
	d := svc.Refresh()
	if d.BranchCount != 0 || len(d.Cells) != 0 {
		t.Fatalf("sin sucursales el diagrama debe quedar vacío, dio %+v", d)
	}
}

func TestCoverage_GapClassificationAndSuggestion(t *testing.T) {
	// Tres sucursales muy separadas (escala nacional) con umbral bajo: todas las
	// celdas deben superar el umbral y marcarse como gap con sugerencia.
	svc := newCoverageSvcThreshold(1000,
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()
	if d.ThresholdKm2 != 1000 {
		t.Fatalf("threshold del diagrama = %v, esperado 1000", d.ThresholdKm2)
	}
	if d.GapCount == 0 {
		t.Fatal("con umbral bajo y celdas grandes se esperaban gaps")
	}
	for _, c := range d.Cells {
		if c.IsGap {
			if c.GapSeverity == model.GapSeverityNone {
				t.Fatalf("celda gap %s sin severidad", c.BranchID)
			}
			if c.Suggestion == nil {
				t.Fatalf("celda gap %s sin sugerencia de ubicación", c.BranchID)
			}
		}
	}
}

func TestCoverage_NoGapsWhenThresholdHigh(t *testing.T) {
	// El bounding box nacional fijo tiene ~6.7-6.9M km² de área total, así que
	// ninguna celda individual puede superar ese total; un umbral de 8M km²
	// (dentro del rango permitido, 100-10000000) garantiza cero gaps.
	svc := newCoverageSvcThreshold(8000000,
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
	)
	d := svc.Refresh()
	if d.GapCount != 0 {
		t.Fatalf("con umbral alto no debería haber gaps, dio %d", d.GapCount)
	}
	for _, c := range d.Cells {
		if c.Suggestion != nil {
			t.Fatalf("celda sin gap no debería tener sugerencia: %s", c.BranchID)
		}
	}
}

func TestGapSeverity_Thresholds(t *testing.T) {
	cases := []struct {
		area, threshold float64
		wantGap         bool
		wantSeverity    string
	}{
		{500, 1000, false, model.GapSeverityNone},
		{1000, 1000, false, model.GapSeverityNone}, // límite exacto no es gap
		{1500, 1000, true, model.GapSeverityLeve},
		{2500, 1000, true, model.GapSeverityModerado},
		{5000, 1000, true, model.GapSeverityCritico},
		{9999, 0, false, model.GapSeverityNone}, // umbral 0 = deshabilitado
	}
	for _, c := range cases {
		gap, sev := gapSeverity(c.area, c.threshold)
		if gap != c.wantGap || sev != c.wantSeverity {
			t.Fatalf("gapSeverity(%v,%v) = (%v,%q), esperado (%v,%q)",
				c.area, c.threshold, gap, sev, c.wantGap, c.wantSeverity)
		}
	}
}

func TestCoverage_DiagramCachesAndLazyComputes(t *testing.T) {
	svc := newCoverageSvc(coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38))
	// Diagram() sin Refresh previo debe computar perezosamente.
	d := svc.Diagram()
	if d == nil || d.BranchCount != 1 {
		t.Fatalf("Diagram() debería computar perezosamente, dio %+v", d)
	}
}

func TestCoverage_ClipReducesAreaForCoastalBranch(t *testing.T) {
	// CABA está sobre la costa del Río de la Plata: su celda de Voronoi cruda
	// (sin recortar) se extiende sobre el agua. El recorte contra el contorno
	// real de Argentina debe reducir su área.
	branches := []model.Branch{
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	}
	svc := newCoverageSvc(branches...)
	d := svc.Refresh()

	// Recompute the raw (pre-clip) Voronoi cells with the same projection and
	// bbox Refresh uses, so the comparison is apples-to-apples.
	var sumLat, sumLng float64
	for _, b := range branches {
		sumLat += *b.Latitude
		sumLng += *b.Longitude
	}
	proj := newProjector(sumLat/float64(len(branches)), sumLng/float64(len(branches)))

	pts := make([]geometry.Point, len(branches))
	for i, b := range branches {
		pts[i] = proj.project(*b.Latitude, *b.Longitude)
	}
	minPt := proj.project(coverageBBoxMinLat, coverageBBoxMinLng)
	maxPt := proj.project(coverageBBoxMaxLat, coverageBBoxMaxLng)
	bbox := geometry.BBox{
		MinX: math.Min(minPt.X, maxPt.X),
		MinY: math.Min(minPt.Y, maxPt.Y),
		MaxX: math.Max(minPt.X, maxPt.X),
		MaxY: math.Max(minPt.Y, maxPt.Y),
	}
	rawCells := geometry.VoronoiCells(pts, bbox)

	rawArea := rawCells[0].Area() // index 0 == caba
	var clippedArea float64
	for _, c := range d.Cells {
		if c.BranchID == "caba" {
			clippedArea = c.AreaKm2
		}
	}
	if clippedArea <= 0 || rawArea <= 0 {
		t.Fatalf("áreas no positivas: cruda=%v recortada=%v", rawArea, clippedArea)
	}
	if clippedArea >= rawArea {
		t.Fatalf("el recorte contra el contorno de Argentina debería reducir el área de CABA: cruda=%v recortada=%v", rawArea, clippedArea)
	}
}

func TestCoverage_SuggestionFallsWithinArgentina(t *testing.T) {
	// Umbral bajo a escala nacional: todas las celdas quedan marcadas como gap
	// con sugerencia. Cada sugerencia debe caer dentro del contorno real del
	// país (nunca en el océano ni en un país limítrofe).
	svc := newCoverageSvcThreshold(1000,
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()

	contour := geo.ArgentinaContour()
	found := false
	for _, c := range d.Cells {
		if c.Suggestion == nil {
			continue
		}
		found = true
		pt := orb.Point{c.Suggestion.Lng, c.Suggestion.Lat}
		if !planar.MultiPolygonContains(contour, pt) {
			t.Fatalf("sugerencia de %s cae fuera del territorio argentino: %+v", c.BranchID, c.Suggestion)
		}
	}
	if !found {
		t.Fatal("se esperaba al menos una celda con sugerencia")
	}
}
