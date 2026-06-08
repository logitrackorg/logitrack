package ml

import (
	"math"
	"math/rand"
)

// FleetSample is one synthetic training sample for the fleet-state Random Forest.
type FleetSample struct {
	Features []float64 // normalized values in FleetFactorOrder
	Class    int       // FleetClassCritical … FleetClassStable
}

// NormalizeFleetFeatures maps raw operational metrics to the [0,1] feature
// vector expected by the fleet model.  The normalization ceilings are the
// practical maxima defined in fleet_config.go; values above the ceiling
// saturate to 1.0.
//
// Parameters match the per-branch symbols collected in
// handler/sla_metrics.go:analyzeFleetByBranch — exactly the five branch
// metrics the product team approved (no day_of_week, no "carga promedio"):
//   - totalShipments : EnviosActivosTotales — active shipments for this branch
//   - slaDelayPct    : DemoraSLA — % of this branch's active shipments delayed
//   - idleDrivers    : ChoferesInactivos — active drivers with no route today
//   - activeDrivers  : ChoferesActivos — drivers based at this branch
//   - orphanShipments: Huerfanos — out_for_delivery shipments not in any route
func NormalizeFleetFeatures(
	totalShipments int,
	slaDelayPct float64,
	idleDrivers, activeDrivers, orphanShipments int,
) []float64 {
	return []float64{
		math.Min(float64(totalShipments)/fleetMaxShipments, 1.0),
		math.Min(slaDelayPct/fleetMaxDelay, 1.0),
		math.Min(float64(idleDrivers)/fleetMaxIdleDriver, 1.0),
		math.Min(float64(activeDrivers)/fleetMaxActiveDrivers, 1.0),
		math.Min(float64(orphanShipments)/fleetMaxOrphans, 1.0),
	}
}

// fleetClassify applies the same five-case priority-ordered heuristic that
// handler/sla_metrics.go:runHeuristic uses, so synthetic labels are generated
// from the same rules the ML model is meant to learn. utilizationRatio
// (totalShipments / activeDrivers) is the fleet-saturation signal that
// replaced "carga promedio" — same thresholds (90%/50% of 30 pkg/driver).
//
//	CRÍTICO    — SLA > 10 % AND no idle drivers AND orphan shipments exist
//	ADVERTENCIA— SLA > 10 % AND idle drivers exist
//	PREVENTIVO — SLA < 5 %  AND no idle drivers AND utilization > 90 % (27/30)
//	OCIOSO     — SLA < 2 %  AND utilization < 50 % (15/30)
//	ESTABLE    — everything else
func fleetClassify(delayRatePct float64, idleDrivers, activeDrivers, orphanShipments, totalShipments int) int {
	var utilizationRatio float64
	if activeDrivers > 0 {
		utilizationRatio = float64(totalShipments) / float64(activeDrivers)
	}

	if delayRatePct > 10.0 && idleDrivers > 0 {
		return FleetClassWarning
	}
	if delayRatePct > 10.0 && idleDrivers == 0 && orphanShipments > 0 {
		return FleetClassCritical
	}
	if delayRatePct < 5.0 && idleDrivers == 0 && utilizationRatio > 27.0 {
		return FleetClassPreventive
	}
	if delayRatePct < 2.0 && utilizationRatio < 15.0 {
		return FleetClassIdle
	}
	return FleetClassStable
}

// GenerateFleetDataset creates size synthetic FleetSamples with a seeded RNG.
// Feature distributions are chosen to produce a realistic class mix:
//   - TotalShipments : uniform 50–500
//   - SlaDelayPct    : uniform 0–30 %  (percentage points)
//   - IdleDrivers    : uniform 0–10
//   - ActiveDrivers  : uniform 1–30
//   - OrphanShipments: uniform 0–50
//
// FleetLabelNoiseRate (5 %) randomly re-labels a fraction of samples to
// prevent the forest from perfectly memorising the heuristic formula.
func GenerateFleetDataset(size int, seed int64) []FleetSample {
	rng := rand.New(rand.NewSource(seed))
	samples := make([]FleetSample, 0, size)

	for i := 0; i < size; i++ {
		totalShipments  := 50 + rng.Intn(451) // 50..500
		slaDelayPct     := rng.Float64() * 30.0 // 0..30 %
		idleDrivers     := rng.Intn(11)       // 0..10
		activeDrivers   := 1 + rng.Intn(30)   // 1..30
		orphanShipments := rng.Intn(51)       // 0..50

		class := fleetClassify(slaDelayPct, idleDrivers, activeDrivers, orphanShipments, totalShipments)
		features := NormalizeFleetFeatures(
			totalShipments, slaDelayPct, idleDrivers, activeDrivers, orphanShipments,
		)
		samples = append(samples, FleetSample{Features: features, Class: class})
	}

	// Apply label noise: flip FleetLabelNoiseRate fraction to a random other class.
	for i := range samples {
		if rng.Float64() < FleetLabelNoiseRate {
			other := rng.Intn(FleetNumClasses - 1)
			if other >= samples[i].Class {
				other++
			}
			samples[i].Class = other
		}
	}

	return samples
}
