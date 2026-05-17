package service

import (
	"math"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// =============================================================================
// Phase 4 Sprint 9 — Demand forecasting
//
// Modelo: promedio por día de semana sobre los últimos 90 días, con banda de
// confianza basada en stdev de las observaciones. Sin ML — estadística pura.
// Suficiente para 6 sucursales con datos limitados (POC).
// =============================================================================

const historyWindowDays = 90
const minObsForHighConfidence = 12

// observation interna del forecasting.
type forecastObs struct {
	dow      time.Weekday
	count    float64
	weightKg float64
}

// ForecastService computa predicciones de demanda por par O-D para los próximos N días.
type ForecastService struct {
	metricsRepo repository.RoutingMetricsRepository
	branchRepo  repository.BranchRepository
}

func NewForecastService(metricsRepo repository.RoutingMetricsRepository, branchRepo repository.BranchRepository) *ForecastService {
	return &ForecastService{metricsRepo: metricsRepo, branchRepo: branchRepo}
}

// loadHistoryByPair carga el histórico y lo indexa por (origin|dest) → []forecastObs.
func (s *ForecastService) loadHistoryByPair(from, to time.Time) (map[string][]forecastObs, error) {
	history, err := s.metricsRepo.ListODVolume("", "", from, to)
	if err != nil {
		return nil, err
	}
	byPair := map[string][]forecastObs{}
	for _, v := range history {
		d, err := time.Parse("2006-01-02", v.Date)
		if err != nil {
			continue
		}
		key := v.OriginBranchID + "|" + v.DestinationBranchID
		byPair[key] = append(byPair[key], forecastObs{
			dow:      d.Weekday(),
			count:    float64(v.ShipmentCount),
			weightKg: v.TotalWeightKg,
		})
	}
	return byPair, nil
}

// Predict devuelve forecast por (origin, dest, fecha) para los próximos horizonDays.
func (s *ForecastService) Predict(horizonDays int) ([]model.ODForecast, error) {
	if horizonDays <= 0 {
		horizonDays = 7
	}

	now := clock.Now().In(clock.LocalTZ)
	byPair, err := s.loadHistoryByPair(now.AddDate(0, 0, -historyWindowDays), now)
	if err != nil {
		return nil, err
	}

	branches := s.branchRepo.ListActive()
	result := make([]model.ODForecast, 0, len(branches)*len(branches)*horizonDays)
	for _, origin := range branches {
		for _, dest := range branches {
			if origin.ID == dest.ID {
				continue
			}
			obs := byPair[origin.ID+"|"+dest.ID]
			for offset := 1; offset <= horizonDays; offset++ {
				target := now.AddDate(0, 0, offset)
				dowObs := filterByDow(obs, target.Weekday())
				meanC, stdC := meanStdCount(dowObs)
				meanW := meanWeight(dowObs)
				result = append(result, model.ODForecast{
					OriginBranchID:      origin.ID,
					DestinationBranchID: dest.ID,
					Date:                target.Format("2006-01-02"),
					PredictedCount:      roundForecast(meanC),
					PredictedWeightKg:   roundForecast(meanW),
					CILow:               roundForecast(math.Max(0, meanC-stdC)),
					CIHigh:              roundForecast(meanC + stdC),
					Confidence:          confidenceLevel(len(dowObs)),
				})
			}
		}
	}
	return result, nil
}

// BacktestMAPE evalúa el modelo: predice los últimos 14 días con solo lo anterior
// y reporta MAPE (Mean Absolute Percentage Error).
func (s *ForecastService) BacktestMAPE() (model.ForecastQuality, error) {
	now := clock.Now().In(clock.LocalTZ)
	evalFrom := now.AddDate(0, 0, -14)
	evalTo := now.AddDate(0, 0, -1)

	histFrom := evalFrom.AddDate(0, 0, -historyWindowDays)
	byPair, err := s.loadHistoryByPair(histFrom, evalFrom.AddDate(0, 0, -1))
	if err != nil {
		return model.ForecastQuality{}, err
	}
	realData, err := s.metricsRepo.ListODVolume("", "", evalFrom, evalTo)
	if err != nil {
		return model.ForecastQuality{}, err
	}

	totalErr := 0.0
	count := 0
	odPairs := map[string]bool{}
	for _, r := range realData {
		d, err := time.Parse("2006-01-02", r.Date)
		if err != nil {
			continue
		}
		key := r.OriginBranchID + "|" + r.DestinationBranchID
		odPairs[key] = true
		obs := filterByDow(byPair[key], d.Weekday())
		pred, _ := meanStdCount(obs)
		actual := float64(r.ShipmentCount)
		if actual == 0 && pred == 0 {
			continue
		}
		denom := actual
		if denom < 0.5 {
			denom = 0.5 // smoothing
		}
		errPct := math.Abs(pred-actual) / denom * 100
		totalErr += errPct
		count++
	}

	q := model.ForecastQuality{
		EvaluatedFrom:  evalFrom.Format("2006-01-02"),
		EvaluatedTo:    evalTo.Format("2006-01-02"),
		ODPairsCovered: len(odPairs),
		SampleSize:     count,
	}
	if count > 0 {
		q.MAPE = roundForecast(totalErr / float64(count))
	}
	return q, nil
}

// --- helpers ---

func filterByDow(obs []forecastObs, target time.Weekday) []forecastObs {
	var out []forecastObs
	for _, o := range obs {
		if o.dow == target {
			out = append(out, o)
		}
	}
	return out
}

func meanStdCount(obs []forecastObs) (mean, std float64) {
	if len(obs) == 0 {
		return 0, 0
	}
	sum := 0.0
	for _, o := range obs {
		sum += o.count
	}
	mean = sum / float64(len(obs))
	if len(obs) < 2 {
		return mean, 0
	}
	var sqdiff float64
	for _, o := range obs {
		diff := o.count - mean
		sqdiff += diff * diff
	}
	std = math.Sqrt(sqdiff / float64(len(obs)-1))
	return mean, std
}

func meanWeight(obs []forecastObs) float64 {
	if len(obs) == 0 {
		return 0
	}
	sum := 0.0
	for _, o := range obs {
		sum += o.weightKg
	}
	return sum / float64(len(obs))
}

func confidenceLevel(n int) string {
	switch {
	case n >= minObsForHighConfidence:
		return "high"
	case n >= 4:
		return "medium"
	case n >= 1:
		return "low"
	default:
		return "none"
	}
}

func roundForecast(v float64) float64 {
	return math.Round(v*100) / 100
}
