package service

import (
	"testing"

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
		if len(c.Polygon) < 3 {
			t.Fatalf("celda %s con polígono inválido (%d vértices)", c.BranchID, len(c.Polygon))
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
	// Dos sucursales del AMBA a ~30 km. Con margen de bbox, cada celda debe estar
	// en un rango de miles de km² (no millones, no fracciones) — sanity check de
	// que la proyección a km funciona.
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("laplata", "LP", "Buenos Aires", -34.92, -57.95),
	)
	d := svc.Refresh()
	if len(d.Cells) != 2 {
		t.Fatalf("esperaba 2 celdas")
	}
	for _, c := range d.Cells {
		if c.AreaKm2 < 100 || c.AreaKm2 > 500000 {
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
	svc := newCoverageSvcThreshold(500000,
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
