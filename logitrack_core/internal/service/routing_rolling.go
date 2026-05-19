package service

import (
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// =============================================================================
// Phase 4 Sprint 11 — Rolling horizon multi-día
//
// Combina día 1 (firm — plan global real) con días 2-N (tentativos basados en
// forecast). Capacidad media usada para estimar vehículos necesarios.
// =============================================================================

const defaultAvgVehicleCapacityKg = 500.0

// RollingPlanService produce la vista multi-día del plan.
type RollingPlanService struct {
	forecast    *ForecastService
	planRepo    repository.RoutingPlanRepository
	vehicleRepo repository.VehicleRepository
}

func NewRollingPlanService(forecast *ForecastService, planRepo repository.RoutingPlanRepository, vehicleRepo repository.VehicleRepository) *RollingPlanService {
	return &RollingPlanService{forecast: forecast, planRepo: planRepo, vehicleRepo: vehicleRepo}
}

// Generate construye el rolling horizon plan para horizonDays.
func (s *RollingPlanService) Generate(horizonDays int) (model.RollingHorizonPlan, error) {
	if horizonDays <= 0 {
		horizonDays = 5
	}
	if horizonDays > 14 {
		horizonDays = 14 // límite razonable, más allá el forecasting pierde valor
	}

	now := clock.Now().In(clock.LocalTZ)
	avgCapacity := s.computeAvgCapacity()
	if avgCapacity <= 0 {
		avgCapacity = defaultAvgVehicleCapacityKg
	}

	days := make([]model.RollingHorizonDay, 0, horizonDays)

	// Día 1: plan global real (firm)
	todayStr := now.Format("2006-01-02")
	firmDay := model.RollingHorizonDay{
		Date:             todayStr,
		IsFirm:           true,
		ExpectedByODPair: []model.RollingHorizonODBucket{},
	}
	if globalPlan, err := s.planRepo.GetByDate(todayStr); err == nil && globalPlan != nil {
		firmDay.Summary = s.summarizeFirmDay(globalPlan, avgCapacity)
		firmDay.ExpectedByODPair = s.bucketsFromGlobalPlan(globalPlan)
	}
	days = append(days, firmDay)

	// Días 2..N: tentativos del forecast
	forecast, err := s.forecast.Predict(horizonDays - 1)
	if err != nil {
		return model.RollingHorizonPlan{}, err
	}
	byDate := map[string][]model.ODForecast{}
	for _, f := range forecast {
		byDate[f.Date] = append(byDate[f.Date], f)
	}

	for offset := 1; offset < horizonDays; offset++ {
		target := now.AddDate(0, 0, offset).Format("2006-01-02")
		entries := byDate[target]
		summary := model.RollingHorizonDaySummary{}
		buckets := make([]model.RollingHorizonODBucket, 0, len(entries))
		for _, f := range entries {
			if f.PredictedCount < 0.5 {
				continue // ruido bajo, no mostrar
			}
			summary.TotalExpectedShipments += int(f.PredictedCount + 0.5)
			summary.TotalExpectedWeightKg += f.PredictedWeightKg
			buckets = append(buckets, model.RollingHorizonODBucket{
				OriginBranchID:      f.OriginBranchID,
				DestinationBranchID: f.DestinationBranchID,
				ExpectedShipments:   f.PredictedCount,
				ExpectedWeightKg:    f.PredictedWeightKg,
				Confidence:          f.Confidence,
			})
		}
		summary.TotalExpectedWeightKg = round2(summary.TotalExpectedWeightKg)
		summary.EstimatedVehiclesNeeded = estimateVehicles(summary.TotalExpectedWeightKg, avgCapacity)
		days = append(days, model.RollingHorizonDay{
			Date:             target,
			IsFirm:           false,
			Summary:          summary,
			ExpectedByODPair: buckets,
		})
	}

	return model.RollingHorizonPlan{
		GeneratedAt: now,
		HorizonDays: horizonDays,
		Days:        days,
	}, nil
}

// summarizeFirmDay computa el summary del día 1 desde el plan global real.
func (s *RollingPlanService) summarizeFirmDay(plan *model.GlobalRoutingPlan, avgCapacity float64) model.RollingHorizonDaySummary {
	totalShipments := 0
	totalWeight := 0.0
	vehiclesUsed := map[string]bool{}
	for _, bp := range plan.BranchPlans {
		for _, lm := range bp.Plan.LastMile {
			totalShipments += len(lm.Shipments)
			totalWeight += lm.TotalWeightKg
		}
		for _, ib := range bp.Plan.InterBranch {
			totalShipments += len(ib.Shipments)
			totalWeight += ib.TotalWeightKg
			vehiclesUsed[ib.VehicleID] = true
		}
	}
	return model.RollingHorizonDaySummary{
		TotalExpectedShipments:  totalShipments,
		TotalExpectedWeightKg:   round2(totalWeight),
		EstimatedVehiclesNeeded: len(vehiclesUsed),
	}
}

// bucketsFromGlobalPlan agrupa los despachos reales en buckets por (origin, dest).
func (s *RollingPlanService) bucketsFromGlobalPlan(plan *model.GlobalRoutingPlan) []model.RollingHorizonODBucket {
	type key struct{ origin, dest string }
	agg := map[key]*model.RollingHorizonODBucket{}
	for _, bp := range plan.BranchPlans {
		for _, ib := range bp.Plan.InterBranch {
			k := key{origin: bp.BranchID, dest: ib.DestinationBranch}
			b, ok := agg[k]
			if !ok {
				b = &model.RollingHorizonODBucket{
					OriginBranchID:      bp.BranchID,
					DestinationBranchID: ib.DestinationBranch,
					Confidence:          "high", // es plan real, no predicción
				}
				agg[k] = b
			}
			b.ExpectedShipments += float64(len(ib.Shipments))
			b.ExpectedWeightKg += ib.TotalWeightKg
		}
	}
	out := make([]model.RollingHorizonODBucket, 0, len(agg))
	for _, b := range agg {
		b.ExpectedWeightKg = round2(b.ExpectedWeightKg)
		out = append(out, *b)
	}
	return out
}

// computeAvgCapacity calcula la capacidad promedio de los vehículos disponibles.
func (s *RollingPlanService) computeAvgCapacity() float64 {
	all := s.vehicleRepo.List()
	if len(all) == 0 {
		return 0
	}
	total := 0.0
	count := 0
	for _, v := range all {
		if v.CapacityKg > 0 {
			total += v.CapacityKg
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return total / float64(count)
}

// estimateVehicles devuelve la cantidad estimada de vehículos necesarios
// dado un peso esperado y una capacidad promedio. Redondea hacia arriba.
func estimateVehicles(weightKg, avgCapacity float64) int {
	if avgCapacity <= 0 || weightKg <= 0 {
		return 0
	}
	n := weightKg / avgCapacity
	if n != float64(int(n)) {
		return int(n) + 1
	}
	return int(n)
}

