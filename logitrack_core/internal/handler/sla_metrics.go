package handler

import (
	"database/sql"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

// slaMonitoredStatuses mirrors the SLA engine's default allow-list — only
// these states are evaluated for delay. Terminal/pre-operative states are
// excluded intentionally.
var slaMonitoredStatuses = map[string]bool{
	"at_origin_hub":        true,
	"at_hub":               true,
	"loaded":               true,
	"in_transit":           true,
	"out_for_delivery":     true,
	"redelivery_scheduled": true,
	"ready_for_return":     true,
}

// slaStatusLabel maps raw DB codes to Spanish display names (same map as the
// anomaly service so the frontend always shows consistent labels).
var slaStatusLabel = map[string]string{
	"at_origin_hub":        "En sucursal de origen",
	"at_hub":               "En sucursal (intermedia/destino)",
	"loaded":               "Cargado en vehículo",
	"in_transit":           "En tránsito",
	"out_for_delivery":     "Última milla",
	"redelivery_scheduled": "Reentrega agendada",
	"ready_for_return":     "Listo para devolución",
}

// delayThresholdHours must match the SLA engine and the frontend badge.
const delayThresholdHours = 36.0

// SLAMetricsHandler exposes aggregated SLA health metrics for the Dashboard.
type SLAMetricsHandler struct {
	db      *sql.DB
	logRepo *repository.PriorityLogRepository
	svc     *service.SLAAnomalyService
}

func NewSLAMetricsHandler(db *sql.DB, logRepo *repository.PriorityLogRepository, svc *service.SLAAnomalyService) *SLAMetricsHandler {
	return &SLAMetricsHandler{db: db, logRepo: logRepo, svc: svc}
}

// Get computes and returns the three SLA metrics in a single response.
func (h *SLAMetricsHandler) Get(c *gin.Context) {
	// CRITICAL: use clock.Now() — not time.Now() — so that the dwell-time
	// calculation stays on the same timeline as the executor and the shipment
	// updated_at timestamps. Using time.Now() when the admin clock is advanced
	// (time-travel testing) produces negative dwell values → 0 delays reported.
	now := clock.Now()

	// ── 1. Query active shipments (status + updated_at) ──────────────────────
	rows, err := h.db.Query(`
		SELECT status, updated_at
		FROM shipments
		WHERE status NOT IN (
			'delivered','returned','cancelled','lost','destroyed',
			'draft','expired','pending_payment'
		)`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error consultando envíos activos"})
		return
	}
	defer rows.Close()

	type activeRow struct {
		status    string
		updatedAt time.Time
	}
	var actives []activeRow
	for rows.Next() {
		var r activeRow
		if err := rows.Scan(&r.status, &r.updatedAt); err != nil {
			continue
		}
		actives = append(actives, r)
	}

	// ── 2. Compute health rate and bottlenecks ────────────────────────────────
	activeTotal := len(actives)
	bottleneckMap := map[string]int{}

	for _, r := range actives {
		if !slaMonitoredStatuses[r.status] {
			continue
		}
		dwellH := now.Sub(r.updatedAt).Hours()
		if dwellH > delayThresholdHours {
			bottleneckMap[r.status]++
		}
	}

	delayedTotal := 0
	for _, cnt := range bottleneckMap {
		delayedTotal += cnt
	}

	var slaHealthRate float64 = 100
	if activeTotal > 0 {
		slaHealthRate = math.Round(float64(activeTotal-delayedTotal)/float64(activeTotal)*1000) / 10
	}

	bottlenecks := make([]model.SLABottleneck, 0, len(bottleneckMap))
	for code, cnt := range bottleneckMap {
		label := slaStatusLabel[code]
		if label == "" {
			label = code
		}
		bottlenecks = append(bottlenecks, model.SLABottleneck{Status: label, Count: cnt})
	}
	sort.Slice(bottlenecks, func(i, j int) bool {
		return bottlenecks[i].Count > bottlenecks[j].Count
	})

	// ── 3. Delay trend from priority_logs.json (last 7 calendar days) ─────────
	// Anchor the 7-day window to the LATEST timestamp in the log, not to
	// clock.Now(). This prevents the time-travel testing scenario from
	// producing an empty chart: log entries are written with clock.Now()
	// (e.g. +7d), and using clock.Now() as "today" would still work only if
	// the clock is identical at read time. Using the log's own max timestamp
	// makes the window self-consistent regardless of when the endpoint is hit.
	logs := h.logRepo.ListAll()
	var trend []model.SLADayCount
	if len(logs) == 0 {
		// No log entries yet — return an explicitly empty slice (not nil) so
		// the chart receives [] and can show an appropriate empty state.
		trend = []model.SLADayCount{}
	} else {
		// Find the most recent entry to anchor the 7-day window.
		var maxTs time.Time
		for _, entry := range logs {
			if entry.Timestamp.After(maxTs) {
				maxTs = entry.Timestamp
			}
		}
		cutoff := maxTs.AddDate(0, 0, -7).Truncate(24 * time.Hour)
		dayCounts := map[string]int{}
		for _, entry := range logs {
			if entry.Timestamp.Before(cutoff) {
				continue
			}
			day := entry.Timestamp.Format("2006-01-02")
			dayCounts[day]++
		}
		// Fill all 7 days relative to maxTs, even when count is 0, so the
		// chart always has a continuous X axis.
		trend = make([]model.SLADayCount, 7)
		for i := 6; i >= 0; i-- {
			day := maxTs.AddDate(0, 0, -i).Format("2006-01-02")
			trend[6-i] = model.SLADayCount{Date: day, Count: dayCounts[day]}
		}
	}

	// ── 4. Current per-status averages from the Collector in-memory cache ───────
	currentAvgMap := h.svc.GetCurrentAverages()
	currentAverages := make([]model.SLAStateAverage, 0, len(currentAvgMap))
	for code, avgH := range currentAvgMap {
		label := slaStatusLabel[code]
		if label == "" {
			label = code
		}
		currentAverages = append(currentAverages, model.SLAStateAverage{Status: label, AvgHours: math.Round(avgH*10) / 10})
	}
	sort.Slice(currentAverages, func(i, j int) bool {
		return currentAverages[i].AvgHours > currentAverages[j].AvgHours
	})

	// ── 5. Fleet capacity heuristic ─────────────────────────────────────────────
	fleetSugg := analyzeFleet(h.db, now, delayedTotal, activeTotal)

	c.JSON(http.StatusOK, model.SLAMetrics{
		SlaHealthRate:   slaHealthRate,
		ActiveTotal:     activeTotal,
		DelayedTotal:    delayedTotal,
		Bottlenecks:     bottlenecks,
		DelayTrend:      trend,
		CurrentAverages: currentAverages,
		FleetSuggestion: fleetSugg,
	})
}

// ── Fleet heuristic helper ────────────────────────────────────────────────────

// analyzeFleet applies three priority-ordered rules to decide fleet status:
//
//	DÉFICIT  — SLA delay rate > 15 % (overloaded fleet)
//	OCIOSO   — delay rate < 2 % AND shipment volume dropped ≥ 10 % vs last week
//	ESTABLE  — everything else
//
// Volume data is queried relative to `now` (clock.Now()) to stay consistent
// with time-travel testing. Errors from the volume query are handled
// gracefully: if the query fails the volume metrics default to 0 and the
// rule falls through to ESTABLE.
func analyzeFleet(db *sql.DB, now time.Time, delayedTotal, activeTotal int) model.FleetSuggestion {
	// ── Delay rate ─────────────────────────────────────────────────────────────
	var delayRatePct float64
	if activeTotal > 0 {
		delayRatePct = math.Round(float64(delayedTotal)/float64(activeTotal)*1000) / 10
	}

	// ── Volume trend: this week vs last week ───────────────────────────────────
	thisWeekStart := now.AddDate(0, 0, -7)
	lastWeekStart := now.AddDate(0, 0, -14)

	var thisWeekCount, lastWeekCount int
	_ = db.QueryRow(
		`SELECT COUNT(*) FROM shipments WHERE created_at >= $1 AND created_at < $2`,
		thisWeekStart, now,
	).Scan(&thisWeekCount)
	_ = db.QueryRow(
		`SELECT COUNT(*) FROM shipments WHERE created_at >= $1 AND created_at < $2`,
		lastWeekStart, thisWeekStart,
	).Scan(&lastWeekCount)

	var volumeChangePct float64
	if lastWeekCount > 0 {
		volumeChangePct = math.Round(
			float64(thisWeekCount-lastWeekCount)/float64(lastWeekCount)*1000,
		) / 10
	}

	base := model.FleetSuggestion{
		DelayRatePct:    delayRatePct,
		VolumeChangePct: volumeChangePct,
		ThisWeekCount:   thisWeekCount,
		LastWeekCount:   lastWeekCount,
	}

	// ── RULE 1: DÉFICIT — delay rate exceeds critical threshold ───────────────
	if delayRatePct > 15.0 {
		base.Status = model.FleetStatusCritical
		base.Message = "⚠️ ALERTA: Déficit de capacidad detectado. Se sugiere asignar o contratar choferes de refuerzo para estabilizar la operación."
		return base
	}

	// ── RULE 2: OCIOSO — low delay AND volume dropped ≥ 10 % ─────────────────
	if delayRatePct < 2.0 && volumeChangePct <= -10.0 {
		base.Status = model.FleetStatusIdle
		base.Message = "💡 INFO: Capacidad ociosa detectada. Oportunidad para optimizar rutas o reducir flota activa temporalmente."
		return base
	}

	// ── RULE 3: ESTABLE — balanced ────────────────────────────────────────────
	base.Status = model.FleetStatusStable
	base.Message = "✅ OPERACIÓN ESTABLE: Flota equilibrada con la demanda actual."
	return base
}
