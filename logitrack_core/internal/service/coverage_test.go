package service

import (
	"math"
	"testing"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/planar"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/geometry"
	"github.com/logitrack/core/internal/ml"
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

func TestCoverage_Diagnose_Thresholds(t *testing.T) {
	cases := []struct {
		pct          float64
		wantGap      bool
		wantSeverity string
	}{
		{30, true, model.GapSeverityCritico},
		{49.999, true, model.GapSeverityCritico},
		{50, true, model.GapSeverityModerado},
		{84.999, true, model.GapSeverityModerado},
		{85, true, model.GapSeverityLeve},
		{89.999, true, model.GapSeverityLeve},
		{90, false, model.GapSeverityNone},
		{150, false, model.GapSeverityNone},
	}
	for _, c := range cases {
		gap, sev := simulationSeverity(c.pct)
		if gap != c.wantGap || sev != c.wantSeverity {
			t.Fatalf("simulationSeverity(%v) = (%v,%q), esperado (%v,%q)", c.pct, gap, sev, c.wantGap, c.wantSeverity)
		}
	}
}

func TestCoverage_Diagnose_PercentageAndDeficit(t *testing.T) {
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()

	// Área simulada menor que cualquier celda real: todas deben quedar como gap.
	minArea := math.Inf(1)
	for _, c := range d.Cells {
		if c.AreaKm2 < minArea {
			minArea = c.AreaKm2
		}
	}
	simArea := minArea / 4

	res := svc.Diagnose(simArea, nil, nil, false)
	if res.SimulatedAreaKm2 != simArea {
		t.Fatalf("SimulatedAreaKm2 = %v, esperado %v", res.SimulatedAreaKm2, simArea)
	}
	if len(res.Cells) != len(d.Cells) {
		t.Fatalf("esperaba %d celdas, dio %d", len(d.Cells), len(res.Cells))
	}

	areaByBranch := make(map[string]float64, len(d.Cells))
	for _, c := range d.Cells {
		areaByBranch[c.BranchID] = c.AreaKm2
	}

	for _, sc := range res.Cells {
		realArea := areaByBranch[sc.BranchID]
		// El área intersectada (celda ∩ círculo simulado) nunca puede superar
		// el área del círculo ni el área de la celda, así que el porcentaje
		// queda acotado por ambos límites — y nunca puede pasar de 100%.
		upperBoundPct := simArea / realArea * 100
		if sc.CoveragePercentage < 0 || sc.CoveragePercentage > upperBoundPct+1e-9 {
			t.Fatalf("celda %s: coverage_percentage = %v fuera de rango [0, %v]", sc.BranchID, sc.CoveragePercentage, upperBoundPct)
		}
		if sc.CoveragePercentage > 100+1e-9 {
			t.Fatalf("celda %s: coverage_percentage = %v supera el 100%%", sc.BranchID, sc.CoveragePercentage)
		}
		if !sc.IsGap || sc.Severity != model.GapSeverityCritico {
			t.Fatalf("celda %s: con área simulada muy chica se esperaba gap crítico, dio is_gap=%v severity=%q", sc.BranchID, sc.IsGap, sc.Severity)
		}
		// El déficit debe ser el complemento del área intersectada
		// (coverage_percentage) sobre el área real de la celda.
		intersectedArea := sc.CoveragePercentage / 100 * realArea
		wantDeficit := realArea - intersectedArea
		if math.Abs(sc.DeficitKm2-wantDeficit) > 1e-6 {
			t.Fatalf("celda %s: deficit_km2 = %v, esperado %v (consistente con coverage_percentage)", sc.BranchID, sc.DeficitKm2, wantDeficit)
		}
	}
}

func TestCoverage_Diagnose_AdequateWhenSimulatedAreaCoversCell(t *testing.T) {
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()

	// Radio ~6300km (área 1.25e8 km²) desde cualquier sitio cubre por completo
	// el territorio argentino, incluso celdas muy alargadas como la de Mendoza
	// (que se extiende hasta Tierra del Fuego): la intersección celda∩círculo
	// coincide con el polígono completo de la celda.
	const simArea = 1.25e8

	areaByBranch := make(map[string]float64, len(d.Cells))
	for _, c := range d.Cells {
		areaByBranch[c.BranchID] = c.AreaKm2
	}

	res := svc.Diagnose(simArea, nil, nil, false)
	for _, sc := range res.Cells {
		// Bug 1: el porcentaje nunca puede superar el 100%, ni siquiera por
		// errores de redondeo del recorte de polígonos.
		if sc.CoveragePercentage < 0 || sc.CoveragePercentage > 100+1e-9 {
			t.Fatalf("celda %s: coverage_percentage = %v fuera de rango [0, 100]", sc.BranchID, sc.CoveragePercentage)
		}
		// Con el círculo conteniendo geométricamente toda la celda, la
		// intersección es el polígono completo proyectado, que cae dentro
		// del umbral de "cobertura adecuada" (>= simCoverageAdequatePct).
		if sc.CoveragePercentage < simCoverageAdequatePct {
			t.Fatalf("celda %s: coverage_percentage = %v por debajo del umbral de adecuado (%v) con círculo que cubre toda la celda", sc.BranchID, sc.CoveragePercentage, simCoverageAdequatePct)
		}
		if sc.IsGap || sc.Severity != model.GapSeverityNone {
			t.Fatalf("celda %s: con área simulada que cubre toda la celda se esperaba cobertura adecuada, dio is_gap=%v severity=%q", sc.BranchID, sc.IsGap, sc.Severity)
		}
		realArea := areaByBranch[sc.BranchID]
		intersectedArea := sc.CoveragePercentage / 100 * realArea
		wantDeficit := realArea - intersectedArea
		if math.Abs(sc.DeficitKm2-wantDeficit) > 1e-6 {
			t.Fatalf("celda %s: deficit_km2 = %v, esperado %v (consistente con coverage_percentage)", sc.BranchID, sc.DeficitKm2, wantDeficit)
		}
	}
}

func TestCoverage_Diagnose_SuggestedLocationsForCriticalGap(t *testing.T) {
	// Área simulada muy chica frente a cualquier celda real: todas las celdas
	// quedan "crítico" y deberían producir al menos una sugerencia (el resto de
	// la celda, descontado el círculo simulado, sigue siendo enorme).
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()

	minArea := math.Inf(1)
	for _, c := range d.Cells {
		if c.AreaKm2 < minArea {
			minArea = c.AreaKm2
		}
	}
	simArea := minArea / 100

	res := svc.Diagnose(simArea, nil, nil, false)

	criticalBranches := make(map[string]bool)
	for _, sc := range res.Cells {
		if sc.Severity == model.GapSeverityCritico {
			criticalBranches[sc.BranchID] = true
		}
	}
	if len(criticalBranches) == 0 {
		t.Fatal("se esperaba al menos una celda con severidad crítica")
	}
	if len(res.SuggestedLocations) == 0 {
		t.Fatal("se esperaba al menos una ubicación sugerida para gaps críticos")
	}

	siteByBranch := make(map[string]model.LatLng, len(d.Cells))
	for _, c := range d.Cells {
		siteByBranch[c.BranchID] = c.Site
	}
	radiusKm := math.Sqrt(simArea / math.Pi)

	contour := geo.ArgentinaContour()
	// Tolerancia para puntos sobre (o casi sobre) la frontera del país: el
	// fragmento "hueco" resultante del DIFFERENCE suele tener su vértice más
	// lejano justo en el borde del territorio, y planar.MultiPolygonContains
	// puede dar falso negativo por errores de punto flotante en el borde
	// exacto. ~0.05° ≈ 5.5km.
	const borderToleranceDeg = 0.05

	for _, sug := range res.SuggestedLocations {
		if !criticalBranches[sug.BranchID] {
			t.Fatalf("sugerencia %+v asociada a una celda no crítica", sug)
		}
		if sug.GapAreaKm2 < coverageSuggestionMinFragmentAreaKm2 {
			t.Fatalf("sugerencia %+v: gap_area_km2 por debajo del umbral mínimo", sug)
		}
		pt := orb.Point{sug.Lng, sug.Lat}
		if !planar.MultiPolygonContains(contour, pt) && planar.DistanceFrom(contour, pt) > borderToleranceDeg {
			t.Fatalf("sugerencia %+v cae fuera del territorio argentino", sug)
		}

		// Bug 2: el vértice sugerido debe estar sobre el "hueco" (DIFFERENCE),
		// es decir fuera del círculo de cobertura simulado alrededor de su
		// propia sucursal — nunca dentro de la zona ya cubierta.
		site := siteByBranch[sug.BranchID]
		proj := newProjector(site.Lat, site.Lng)
		p := proj.project(sug.Lat, sug.Lng)
		dist := math.Sqrt(p.X*p.X + p.Y*p.Y)
		if dist < radiusKm-1e-6 {
			t.Fatalf("sugerencia %+v cae dentro del círculo de cobertura simulado (dist=%v km < radio=%v km)", sug, dist, radiusKm)
		}
	}
}

func TestCoverage_Diagnose_IterativeGreedyCoveringFillsLargeGap(t *testing.T) {
	// Área simulada muy chica frente a las celdas reales: el "hueco" que deja
	// el círculo simulado en cada celda crítica es enorme — mucho más grande
	// que lo que una sola sugerencia (con su propio círculo de cobertura)
	// podría representar. fillFragmentIteratively debe rellenar ese hueco con
	// varias sugerencias en lugar de una sola.
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	d := svc.Refresh()

	minArea := math.Inf(1)
	for _, c := range d.Cells {
		if c.AreaKm2 < minArea {
			minArea = c.AreaKm2
		}
	}
	simArea := minArea / 100
	radiusKm := math.Sqrt(simArea / math.Pi)

	res := svc.Diagnose(simArea, nil, nil, false)

	byBranch := make(map[string][]model.SuggestedLocation)
	for _, sug := range res.SuggestedLocations {
		byBranch[sug.BranchID] = append(byBranch[sug.BranchID], sug)
	}

	multi := false
	for branchID, sugs := range byBranch {
		if len(sugs) > coverageSuggestionMaxPerFragment {
			t.Fatalf("sucursal %s: %d sugerencias supera el límite de seguridad %d", branchID, len(sugs), coverageSuggestionMaxPerFragment)
		}
		if len(sugs) > 1 {
			multi = true
		}

		// Update 2 garantiza que cada nueva sugerencia cae fuera del círculo
		// de cobertura de las anteriores: la distancia entre cualquier par de
		// sugerencias de la misma sucursal debe ser >= radiusKm.
		for i := range sugs {
			for j := i + 1; j < len(sugs); j++ {
				dist := ml.HaversineKm(sugs[i].Lat, sugs[i].Lng, sugs[j].Lat, sugs[j].Lng)
				if dist < radiusKm-1e-6 {
					t.Fatalf("sucursal %s: sugerencias %+v y %+v separadas por %v km, esperado >= %v km (radio simulado)",
						branchID, sugs[i], sugs[j], dist, radiusKm)
				}
			}
		}
	}
	if !multi {
		t.Fatal("se esperaba al menos una sucursal con más de una sugerencia (llenado iterativo)")
	}
}

func TestCoverage_Diagnose_NoSuggestionsWhenAdequate(t *testing.T) {
	// Área simulada que cubre por completo todas las celdas (ver
	// TestCoverage_Diagnose_AdequateWhenSimulatedAreaCoversCell): ninguna
	// celda queda crítica, así que no debe haber sugerencias.
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)
	svc.Refresh()

	const simArea = 1.25e8

	res := svc.Diagnose(simArea, nil, nil, false)
	if len(res.SuggestedLocations) != 0 {
		t.Fatalf("no se esperaban sugerencias con cobertura adecuada, dio %+v", res.SuggestedLocations)
	}
	// Regression: SuggestedLocations debe ser un slice vacío no-nil, no nil —
	// un nil slice se serializa como `null` en JSON, y el frontend
	// (SlaTab.tsx) llama `.length` sobre suggested_locations sin chequear
	// null, lo que crashea la página (pantalla en blanco) cuando un área
	// simulada grande no produce sugerencias.
	if res.SuggestedLocations == nil {
		t.Fatal("SuggestedLocations no debe ser nil (debe serializar como [] en JSON, no null)")
	}
}

// TestMathematicalSuggestions_SmallCustomZone is the regression test for the
// original bug: computeMathematicalSuggestions returned nothing for small custom
// zones (e.g. AMBA ~10 600 km²) because the hardcoded 50 000 km² threshold
// blocked every void fragment. The adaptive threshold (2 % of TierraFértil area,
// floor 200 km²) must generate at least one suggestion when a branch's coverage
// circle leaves meaningful uncovered area inside the zone.
func TestMathematicalSuggestions_SmallCustomZone(t *testing.T) {
	// One branch inside a small zone. A modest coverage radius (radius ≈ 56 km,
	// area = 10 000 km²) leaves a visible void in the ~10 600 km² AMBA polygon.
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
		coverageBranch("cordoba", "CORD", "Córdoba", -31.42, -64.18),
		coverageBranch("mendoza", "MEND", "Mendoza", -32.89, -68.82),
	)

	// Approximate AMBA bounding box as the custom boundary.
	amba := []model.LatLng{
		{Lat: -34.22, Lng: -59.05},
		{Lat: -34.22, Lng: -57.90},
		{Lat: -35.20, Lng: -57.90},
		{Lat: -35.20, Lng: -59.05},
	}

	// 10 000 km² → radius ≈ 56 km. Covers ~9 852 km² of AMBA's ~10 600 km²,
	// leaving a void of ~750 km² — well above the adaptive floor of 200 km².
	const simArea = 10_000.0

	res := svc.Diagnose(simArea, amba, nil, false)

	if len(res.MathematicalSuggestions) == 0 {
		t.Fatal("se esperaba al menos una MathematicalSuggestion para la zona AMBA con cobertura parcial")
	}

	// Every suggestion must fall inside the AMBA polygon.
	ambaProj := newProjector(-34.71, -58.475)
	ambaPoly := projectRings([][]model.LatLng{amba}, ambaProj)
	for i, s := range res.MathematicalSuggestions {
		pt := ambaProj.project(s.Lat, s.Lng)
		inAMBA := false
		for _, c := range ambaPoly {
			ring := make(geometry.Polygon, len(c))
			for j, v := range c {
				ring[j] = geometry.Point{X: v.X, Y: v.Y}
			}
			if ring.Contains(pt) {
				inAMBA = true
				break
			}
		}
		if !inAMBA {
			t.Errorf("sugerencia[%d] %+v cae fuera del polígono AMBA", i, s.LatLng)
		}
	}
}

// TestMathematicalSuggestions_ZeroBranches verifies that when no branches
// exist the entire TierraFértil is the void and at least one suggestion is
// produced (the pole of the entire zone).
func TestMathematicalSuggestions_ZeroBranches(t *testing.T) {
	svc := newCoverageSvc() // no branches

	amba := []model.LatLng{
		{Lat: -34.22, Lng: -59.05},
		{Lat: -34.22, Lng: -57.90},
		{Lat: -35.20, Lng: -57.90},
		{Lat: -35.20, Lng: -59.05},
	}

	res := svc.Diagnose(10_000.0, amba, nil, false)

	// With 0 branches the void = entire AMBA; the pole must be found.
	if len(res.MathematicalSuggestions) == 0 {
		t.Fatal("con 0 sucursales se esperaba al menos una MathematicalSuggestion")
	}
}

// TestMathematicalSuggestions_DangerousZoneExcluded verifies that dangerous
// zones are correctly subtracted from TierraFértil: no suggestion may fall
// inside a dangerous-zone polygon.
func TestMathematicalSuggestions_DangerousZoneExcluded(t *testing.T) {
	svc := newCoverageSvc(
		coverageBranch("caba", "CABA", "Buenos Aires", -34.60, -58.38),
	)

	amba := []model.LatLng{
		{Lat: -34.22, Lng: -59.05},
		{Lat: -34.22, Lng: -57.90},
		{Lat: -35.20, Lng: -57.90},
		{Lat: -35.20, Lng: -59.05},
	}
	// A dangerous zone covering the south half of AMBA.
	danger := []model.LatLng{
		{Lat: -34.71, Lng: -59.05},
		{Lat: -34.71, Lng: -57.90},
		{Lat: -35.20, Lng: -57.90},
		{Lat: -35.20, Lng: -59.05},
	}

	res := svc.Diagnose(10_000.0, amba, [][]model.LatLng{danger}, false)

	// No suggestion should fall inside the dangerous zone.
	dangerProj := newProjector(-34.955, -58.475)
	dangerPoly := projectRings([][]model.LatLng{danger}, dangerProj)
	for i, s := range res.MathematicalSuggestions {
		pt := dangerProj.project(s.Lat, s.Lng)
		for _, c := range dangerPoly {
			ring := make(geometry.Polygon, len(c))
			for j, v := range c {
				ring[j] = geometry.Point{X: v.X, Y: v.Y}
			}
			if ring.Contains(pt) {
				t.Errorf("sugerencia[%d] %+v cae dentro de la zona peligrosa", i, s.LatLng)
			}
		}
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
