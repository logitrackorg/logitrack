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
// Parameters match the symbols collected in handler/sla_metrics.go:
//   - dayOfWeek     : 0 (Sunday) … 6 (Saturday)  — time.Weekday() value
//   - totalShipments: count of active (non-terminal) shipments
//   - slaDelayPct   : percentage of active shipments that are delayed (0–100)
//   - orphanShipments: out_for_delivery shipments not in any driver route today
//   - idleDrivers   : active drivers with no shipment assigned today
//   - activeDriversLoad: avg shipments per driver that has ≥1 assignment today
func NormalizeFleetFeatures(
	dayOfWeek, totalShipments int,
	slaDelayPct float64,
	orphanShipments, idleDrivers int,
	activeDriversLoad float64,
) []float64 {
	return []float64{
		float64(dayOfWeek) / 6.0,
		math.Min(float64(totalShipments)/fleetMaxShipments, 1.0),
		math.Min(slaDelayPct/fleetMaxDelay, 1.0),
		math.Min(float64(orphanShipments)/fleetMaxOrphans, 1.0),
		math.Min(float64(idleDrivers)/fleetMaxIdleDriver, 1.0),
		math.Min(activeDriversLoad/fleetMaxLoad, 1.0),
	}
}

// fleetClassify applies the same five-case priority-ordered heuristic that
// handler/sla_metrics.go:analyzeFleet uses, so synthetic labels are
// generated from the same rules the ML model is meant to learn.
//
//	CRÍTICO    — SLA > 10 % AND no idle drivers AND orphan shipments exist
//	ADVERTENCIA— SLA > 10 % AND idle drivers exist
//	PREVENTIVO — SLA < 5 %  AND no idle drivers AND load > 90 % capacity (27/30)
//	OCIOSO     — SLA < 2 %  AND load < 50 % capacity (15/30)
//	ESTABLE    — everything else
func fleetClassify(delayRatePct float64, idleDrivers, orphanShipments int, activeDriversLoad float64) int {
	if delayRatePct > 10.0 && idleDrivers > 0 {
		return FleetClassWarning
	}
	if delayRatePct > 10.0 && idleDrivers == 0 && orphanShipments > 0 {
		return FleetClassCritical
	}
	if delayRatePct < 5.0 && idleDrivers == 0 && activeDriversLoad > 27.0 {
		return FleetClassPreventive
	}
	if delayRatePct < 2.0 && activeDriversLoad < 15.0 {
		return FleetClassIdle
	}
	return FleetClassStable
}

// GenerateFleetDataset creates size synthetic FleetSamples with a seeded RNG.
// Feature distributions are chosen to produce a realistic class mix:
//   - DayOfWeek      : uniform 0–6
//   - TotalShipments : uniform 50–500
//   - SlaDelayPct    : uniform 0–30 %  (percentage points)
//   - OrphanShipments: uniform 0–50
//   - IdleDrivers    : uniform 0–10
//   - ActiveLoad     : uniform 5–35 pkg/driver
//
// FleetLabelNoiseRate (5 %) randomly re-labels a fraction of samples to
// prevent the forest from perfectly memorising the heuristic formula.
func GenerateFleetDataset(size int, seed int64) []FleetSample {
	rng := rand.New(rand.NewSource(seed))
	samples := make([]FleetSample, 0, size)

	for i := 0; i < size; i++ {
		dayOfWeek       := rng.Intn(7)
		totalShipments  := 50 + rng.Intn(451)         // 50..500
		slaDelayPct     := rng.Float64() * 30.0        // 0..30 %
		orphanShipments := rng.Intn(51)                // 0..50
		idleDrivers     := rng.Intn(11)                // 0..10
		activeLoad      := 5.0 + rng.Float64()*30.0    // 5..35

		class := fleetClassify(slaDelayPct, idleDrivers, orphanShipments, activeLoad)
		features := NormalizeFleetFeatures(
			dayOfWeek, totalShipments, slaDelayPct,
			orphanShipments, idleDrivers, activeLoad,
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
