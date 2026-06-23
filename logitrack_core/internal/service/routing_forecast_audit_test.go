package service

import (
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

// =============================================================================
// Auditoría Phase 4: escenarios end-to-end con datos sintéticos cercanos al seed
// =============================================================================

// generateSyntheticHistory imita el seed real: 90 días con patrón día-de-semana.
func generateSyntheticHistory(origin, dest string, baseCount int, baseWeight float64) []model.ODPairVolume {
	now := time.Now().UTC()
	dowMultiplier := map[time.Weekday]float64{
		time.Monday:    1.2,
		time.Tuesday:   1.1,
		time.Wednesday: 1.1,
		time.Thursday:  0.9,
		time.Friday:    0.8,
		time.Saturday:  0.4,
		time.Sunday:    0.3,
	}

	var out []model.ODPairVolume
	for offset := 1; offset <= 90; offset++ {
		day := now.AddDate(0, 0, -offset)
		mult := dowMultiplier[day.Weekday()]
		count := int(float64(baseCount)*mult + 0.5)
		if count < 1 {
			continue
		}
		weight := baseWeight * mult
		out = append(out, model.ODPairVolume{
			OriginBranchID:      origin,
			DestinationBranchID: dest,
			Date:                day.Format("2006-01-02"),
			ShipmentCount:       count,
			TotalWeightKg:       weight,
		})
	}
	return out
}

// =============================================================================
// SCENARIO 1: el modelo aprende patrón día-de-semana con datos sin ruido
// =============================================================================

func TestAudit_ForecastLearnsDayOfWeekFromSeedLikeData(t *testing.T) {
	odData := generateSyntheticHistory("caba", "cordoba", 18, 250)
	svc := newForecastTestService(odData)
	forecasts, err := svc.Predict(7)
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	now := time.Now().UTC()
	// Buscar predicción para próximo lunes y comparar con base × multiplier
	for offset := 1; offset <= 7; offset++ {
		target := now.AddDate(0, 0, offset)
		dateStr := target.Format("2006-01-02")
		for _, f := range forecasts {
			if f.Date != dateStr || f.OriginBranchID != "caba" || f.DestinationBranchID != "cordoba" {
				continue
			}
			expected := 18.0
			switch target.Weekday() {
			case time.Monday:
				expected = 18 * 1.2
			case time.Tuesday, time.Wednesday:
				expected = 18 * 1.1
			case time.Thursday:
				expected = 18 * 0.9
			case time.Friday:
				expected = 18 * 0.8
			case time.Saturday:
				expected = 18 * 0.4
			case time.Sunday:
				expected = 18 * 0.3
			}
			// Tolerancia 15% por el redondeo a int en el dato sintético
			if math.Abs(f.PredictedCount-expected)/expected > 0.15 {
				t.Errorf("[%s %s] esperado ~%.1f, got %.1f (diff %.1f%%)",
					dateStr, target.Weekday(), expected, f.PredictedCount,
					math.Abs(f.PredictedCount-expected)/expected*100,
				)
			}
		}
	}
}

// =============================================================================
// SCENARIO 2: BacktestMAPE no debe explotar con datos seed-like
// =============================================================================

func TestAudit_BacktestMAPEStaysReasonable(t *testing.T) {
	odData := generateSyntheticHistory("caba", "cordoba", 18, 250)
	svc := newForecastTestService(odData)

	q, err := svc.BacktestMAPE()
	if err != nil {
		t.Fatalf("error: %v", err)
	}

	// Datos sin ruido → MAPE debe ser bajo (< 30% según mi propio gate del roadmap)
	if q.SampleSize == 0 {
		t.Skip("sin sample size en backtest — verificar setup de fechas")
	}
	if q.MAPE > 30 {
		t.Errorf("MAPE inesperadamente alto sobre datos sintéticos limpios: %.1f%% (sample=%d)", q.MAPE, q.SampleSize)
	}
	t.Logf("backtest MAPE=%.1f%% sample=%d pares=%d", q.MAPE, q.SampleSize, q.ODPairsCovered)
}

// =============================================================================
// BUG CHECK: MAPE inflation when actual=0 and pred>0
// =============================================================================

func TestAudit_MAPEHandlesZeroActualGracefully(t *testing.T) {
	// Edge case: histórico tiene 5 envíos los martes pero el último martes hubo 0
	// (anomalía). MAPE no debe inflarse a 1000%.
	now := time.Now().UTC()
	var odData []model.ODPairVolume
	for offset := 1; offset <= 90; offset++ {
		day := now.AddDate(0, 0, -offset)
		if day.Weekday() != time.Tuesday {
			continue
		}
		count := 5
		if offset <= 14 && offset > 7 {
			// Última semana de eval: 0 envíos un martes (anomalía)
			count = 0
		}
		if count == 0 {
			// IncrementODVolume sería 0 → en DB no aparece. Simulamos eso skipeando.
			continue
		}
		odData = append(odData, model.ODPairVolume{
			OriginBranchID:      "caba",
			DestinationBranchID: "cordoba",
			Date:                day.Format("2006-01-02"),
			ShipmentCount:       count,
			TotalWeightKg:       100,
		})
	}
	svc := newForecastTestService(odData)
	q, _ := svc.BacktestMAPE()
	// Si MAPE > 200% es señal de que el cálculo está inflado por ceros
	if q.SampleSize > 0 && q.MAPE > 200 {
		t.Errorf("MAPE inflado por ceros: %.1f%% (sample=%d)", q.MAPE, q.SampleSize)
	}
	t.Logf("MAPE con ceros en eval: %.1f%% (sample=%d)", q.MAPE, q.SampleSize)
}

// =============================================================================
// BUG CHECK: prediction para sucursales sin historia
// =============================================================================

func TestAudit_PredictionForUnobservedPairReturnsNoneConfidence(t *testing.T) {
	// Solo hay datos de caba→cordoba, pero el branchRepo expone ambas branches.
	// La predicción de cordoba→caba debe devolver predicted=0 + confidence=none.
	odData := generateSyntheticHistory("caba", "cordoba", 10, 100)
	svc := newForecastTestService(odData)
	forecasts, _ := svc.Predict(7)

	foundCabaCord := false
	foundCordCaba := false
	for _, f := range forecasts {
		if f.OriginBranchID == "caba" && f.DestinationBranchID == "cordoba" {
			foundCabaCord = true
			if f.Confidence == "none" {
				t.Errorf("caba→cordoba con 90 días de data debería tener confianza ≠ none, got %s", f.Confidence)
			}
		}
		if f.OriginBranchID == "cordoba" && f.DestinationBranchID == "caba" {
			foundCordCaba = true
			if f.Confidence != "none" {
				t.Errorf("cordoba→caba sin data debería tener confianza 'none', got %s", f.Confidence)
			}
			if f.PredictedCount != 0 {
				t.Errorf("cordoba→caba sin data debería predicción 0, got %.2f", f.PredictedCount)
			}
		}
	}
	if !foundCabaCord {
		t.Error("no se encontró predicción caba→cordoba")
	}
	if !foundCordCaba {
		t.Error("no se encontró predicción cordoba→caba (debería existir como 'none')")
	}
}

// =============================================================================
// BUG CHECK: confidence bands no contienen negativos
// =============================================================================

func TestAudit_ConfidenceBandsNonNegative(t *testing.T) {
	// Pred = 2, stdev = 5 → CI_low = -3 sin clamping. Mi código tiene math.Max(0, ...).
	// Verificarlo con datos sintéticos de alta varianza.
	now := time.Now().UTC()
	var odData []model.ODPairVolume
	values := []int{0, 1, 10, 0, 8, 1, 0, 12, 0, 15, 1, 14}
	idx := 0
	for offset := 1; offset <= 90 && idx < len(values); offset++ {
		day := now.AddDate(0, 0, -offset)
		if day.Weekday() != time.Monday {
			continue
		}
		odData = append(odData, model.ODPairVolume{
			OriginBranchID:      "caba",
			DestinationBranchID: "cordoba",
			Date:                day.Format("2006-01-02"),
			ShipmentCount:       values[idx],
			TotalWeightKg:       float64(values[idx]) * 10,
		})
		idx++
	}
	svc := newForecastTestService(odData)
	forecasts, _ := svc.Predict(14)
	for _, f := range forecasts {
		if f.CILow < 0 {
			t.Errorf("CI low negativo: %s pred=%.2f ci_low=%.2f", f.Date, f.PredictedCount, f.CILow)
		}
		if f.CIHigh < f.CILow {
			t.Errorf("CI high < CI low: %s ci_low=%.2f ci_high=%.2f", f.Date, f.CILow, f.CIHigh)
		}
	}
}

// =============================================================================
// BUG CHECK: el horizon clamp y el default funcionan
// =============================================================================

func TestAudit_HorizonClampedAndDefaulted(t *testing.T) {
	svc := newForecastTestService(nil)
	tests := []struct {
		in       int
		expected int
	}{
		{0, 7},  // default
		{-5, 7}, // default
		{1, 1},
		{30, 30},
	}
	for _, tc := range tests {
		forecasts, _ := svc.Predict(tc.in)
		// 2 branches → 2×1=2 pares O-D (caba→cordoba y cordoba→caba)
		expected := tc.expected * 2
		if len(forecasts) != expected {
			t.Errorf("horizon=%d: esperado %d forecasts, got %d", tc.in, expected, len(forecasts))
		}
	}
}

// =============================================================================
// SCENARIO 3: muestro qué predice el modelo con setup tipo demo
// =============================================================================

func TestAudit_DemoForecast_SnapshotForVisualInspection(t *testing.T) {
	odData := generateSyntheticHistory("caba", "cordoba", 18, 250)
	svc := newForecastTestService(odData)
	forecasts, _ := svc.Predict(7)

	t.Log("=== Predicción 7 días caba→cordoba (datos sintéticos seed-like) ===")
	now := time.Now().UTC()
	for offset := 1; offset <= 7; offset++ {
		target := now.AddDate(0, 0, offset)
		dateStr := target.Format("2006-01-02")
		for _, f := range forecasts {
			if f.Date == dateStr && f.OriginBranchID == "caba" && f.DestinationBranchID == "cordoba" {
				t.Logf("%s (%s): pred=%.1f [%.1f - %.1f] conf=%s",
					dateStr, target.Weekday(), f.PredictedCount, f.CILow, f.CIHigh, f.Confidence)
			}
		}
	}
	// Este test siempre pasa — es para visual inspection.
	fmt.Println("=== Demo snapshot guardado en logs ===")
}
