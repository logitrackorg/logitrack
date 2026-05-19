package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

// fakeMetricsRepoForForecast retorna OD volume data fija para tests.
type fakeMetricsRepoForForecast struct {
	*fakeMetricsRepo
	odData []model.ODPairVolume
}

func (f *fakeMetricsRepoForForecast) ListODVolume(originBranch, destBranch string, from, to time.Time) ([]model.ODPairVolume, error) {
	var out []model.ODPairVolume
	for _, v := range f.odData {
		if originBranch != "" && v.OriginBranchID != originBranch {
			continue
		}
		if destBranch != "" && v.DestinationBranchID != destBranch {
			continue
		}
		d, err := time.Parse("2006-01-02", v.Date)
		if err != nil {
			continue
		}
		if d.Before(from) || d.After(to) {
			continue
		}
		out = append(out, v)
	}
	return out, nil
}

func newForecastTestService(odData []model.ODPairVolume) *ForecastService {
	repo := &fakeMetricsRepoForForecast{
		fakeMetricsRepo: &fakeMetricsRepo{},
		odData:          odData,
	}
	cabaLat, cabaLng := -34.6037, -58.3816
	cordLat, cordLng := -31.4201, -64.1888
	branchRepo := &fakeBranchRepoListActive{
		branches: []model.Branch{
			{ID: "caba", Latitude: &cabaLat, Longitude: &cabaLng, Status: model.BranchStatusActive},
			{ID: "cordoba", Latitude: &cordLat, Longitude: &cordLng, Status: model.BranchStatusActive},
		},
	}
	return NewForecastService(repo, branchRepo)
}

// fakeBranchRepoListActive devuelve la lista pasada en ListActive().
type fakeBranchRepoListActive struct {
	branches []model.Branch
}

func (f *fakeBranchRepoListActive) List() []model.Branch                            { return f.branches }
func (f *fakeBranchRepoListActive) ListActive() []model.Branch                      { return f.branches }
func (f *fakeBranchRepoListActive) GetByID(id string) (model.Branch, bool) {
	for _, b := range f.branches {
		if b.ID == id {
			return b, true
		}
	}
	return model.Branch{}, false
}
func (f *fakeBranchRepoListActive) GetByCity(city string) (model.Branch, bool)        { return model.Branch{}, false }
func (f *fakeBranchRepoListActive) GetByNameOrID(q string) []model.Branch              { return nil }
func (f *fakeBranchRepoListActive) Create(b model.Branch) error                          { return nil }
func (f *fakeBranchRepoListActive) Add(b model.Branch)                                   {}
func (f *fakeBranchRepoListActive) Update(id string, b model.Branch) error               { return nil }
func (f *fakeBranchRepoListActive) UpdateStatus(id string, s model.BranchStatus, u string) error {
	return nil
}

// =============================================================================
// Tests
// =============================================================================

// buildOD genera entradas históricas con un volumen fijo en cada lunes.
func buildOD(origin, dest string, count int, weight float64, daysBack int) []model.ODPairVolume {
	now := time.Now().UTC()
	var out []model.ODPairVolume
	for offset := 1; offset <= daysBack; offset++ {
		day := now.AddDate(0, 0, -offset)
		if day.Weekday() != time.Monday {
			continue // solo lunes para que el test sea claro
		}
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

func TestPredict_LearnsDayOfWeekPattern(t *testing.T) {
	// 12 lunes con 10 envíos cada uno → predicción del próximo lunes debería ser ~10
	odData := buildOD("caba", "cordoba", 10, 250, 90)
	svc := newForecastTestService(odData)

	forecasts, err := svc.Predict(14)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Buscar el próximo lunes en los forecasts
	now := time.Now().UTC()
	var mondayPred *model.ODForecast
	for offset := 1; offset <= 14; offset++ {
		target := now.AddDate(0, 0, offset)
		if target.Weekday() != time.Monday {
			continue
		}
		dateStr := target.Format("2006-01-02")
		for i := range forecasts {
			if forecasts[i].Date == dateStr && forecasts[i].OriginBranchID == "caba" && forecasts[i].DestinationBranchID == "cordoba" {
				mondayPred = &forecasts[i]
				break
			}
		}
		if mondayPred != nil {
			break
		}
	}

	if mondayPred == nil {
		t.Fatal("no encontró predicción para el próximo lunes")
	}
	if mondayPred.PredictedCount < 9 || mondayPred.PredictedCount > 11 {
		t.Errorf("predicción del lunes esperada ~10, got %.2f", mondayPred.PredictedCount)
	}
	if mondayPred.Confidence != "high" {
		t.Errorf("confianza esperada 'high' (≥12 obs), got %s", mondayPred.Confidence)
	}
}

func TestPredict_LowConfidenceWithLittleData(t *testing.T) {
	// Solo 2 lunes → confianza "low"
	odData := buildOD("caba", "cordoba", 10, 250, 14)
	svc := newForecastTestService(odData)

	forecasts, _ := svc.Predict(14)
	now := time.Now().UTC()
	for offset := 1; offset <= 14; offset++ {
		target := now.AddDate(0, 0, offset)
		if target.Weekday() != time.Monday {
			continue
		}
		dateStr := target.Format("2006-01-02")
		for _, f := range forecasts {
			if f.Date == dateStr && f.OriginBranchID == "caba" && f.DestinationBranchID == "cordoba" {
				if f.Confidence != "low" {
					t.Errorf("con ≤3 obs, confianza esperada 'low', got %s", f.Confidence)
				}
				return
			}
		}
	}
}

func TestPredict_NoneConfidenceWithoutData(t *testing.T) {
	svc := newForecastTestService(nil)
	forecasts, _ := svc.Predict(7)
	if len(forecasts) == 0 {
		t.Fatal("debería devolver predicciones aunque sean 'none'")
	}
	for _, f := range forecasts {
		if f.Confidence != "none" {
			t.Errorf("sin data, confianza esperada 'none', got %s", f.Confidence)
		}
		if f.PredictedCount != 0 {
			t.Errorf("sin data, predicción esperada 0, got %.2f", f.PredictedCount)
		}
	}
}

func TestPredict_DefaultHorizonIs7(t *testing.T) {
	svc := newForecastTestService(nil)
	forecasts, _ := svc.Predict(0) // 0 → debería usar default 7
	expectedRows := 7 * 2 // 7 días × 2 pares O-D (caba→cordoba y cordoba→caba)
	if len(forecasts) != expectedRows {
		t.Errorf("con horizonDays=0, esperado %d rows (7 días × 2 pares), got %d", expectedRows, len(forecasts))
	}
}
