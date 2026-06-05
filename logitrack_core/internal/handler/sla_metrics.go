package handler

import (
	"database/sql"
	"fmt"
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

	// ── 4. Current per-status averages — filtered to states with active shipments
	// Build a set of status codes that actually have ≥ 1 active shipment so that
	// ghost states (states in the Collector cache but empty in the DB) are not
	// sent to the frontend and produce phantom bars in the chart.
	activeStatusSet := make(map[string]bool, len(actives))
	for _, r := range actives {
		activeStatusSet[r.status] = true
	}
	currentAvgMap := h.svc.GetCurrentAverages()
	currentAverages := make([]model.SLAStateAverage, 0, len(currentAvgMap))
	for code, avgH := range currentAvgMap {
		if !activeStatusSet[code] {
			continue // skip states with no active shipments
		}
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

// maxPackagesPerDriver is the daily capacity limit used to calculate how many
// extra drivers are needed to cover orphan shipments (Case B) and to detect
// near-capacity situations (Case C).
const maxPackagesPerDriver = 30

// analyzeFleet applies a five-case priority-ordered heuristic that crosses
// SLA delay data with real-time fleet and route information:
//
//	CASO A (ADVERTENCIA)  — SLA > 10 % AND idle drivers exist
//	CASO B (CRÍTICO)      — SLA > 10 % AND no idle drivers AND orphan shipments
//	CASO C (PREVENTIVO)   — SLA < 5 % AND no idle drivers AND load > 90 % capacity
//	CASO D (OCIOSO)       — SLA < 2 % AND load < 50 % capacity
//	DEFAULT (ESTABLE)     — everything else
//
// All DB queries use `now` (clock.Now()) so time-travel testing stays
// consistent. Query errors default to 0 and fall through to ESTABLE.
func analyzeFleet(db *sql.DB, now time.Time, delayedTotal, activeTotal int) model.FleetSuggestion {
	// ── Delay rate ─────────────────────────────────────────────────────────────
	var delayRatePct float64
	if activeTotal > 0 {
		delayRatePct = math.Round(float64(delayedTotal)/float64(activeTotal)*1000) / 10
	}

	// ── Active drivers ─────────────────────────────────────────────────────────
	var activeDrivers int
	_ = db.QueryRow(
		`SELECT COUNT(*) FROM users WHERE role = 'driver' AND status = 'activo'`,
	).Scan(&activeDrivers)

	// ── Today's route assignments ─────────────────────────────────────────────
	// Fetch each active driver's assigned shipment count from today's routes.
	// Routes in 'pendiente' or 'en_curso' are both considered active.
	today := now.Format("2006-01-02")
	type driverLoad struct {
		driverID    string
		shipmentCnt int
	}
	var loads []driverLoad
	routeRows, err := db.Query(
		`SELECT driver_id, jsonb_array_length(shipment_ids)
		 FROM routes
		 WHERE date = $1 AND status IN ('pendiente','en_curso')`,
		today,
	)
	if err == nil {
		defer routeRows.Close()
		for routeRows.Next() {
			var dl driverLoad
			if scanErr := routeRows.Scan(&dl.driverID, &dl.shipmentCnt); scanErr == nil {
				loads = append(loads, dl)
			}
		}
	}

	// Drivers with ≥ 1 shipment assigned today.
	driversWithLoad := make(map[string]int, len(loads))
	totalAssigned := 0
	for _, dl := range loads {
		driversWithLoad[dl.driverID] += dl.shipmentCnt
		totalAssigned += dl.shipmentCnt
	}
	busyDrivers := len(driversWithLoad)
	idleDrivers := activeDrivers - busyDrivers
	if idleDrivers < 0 {
		idleDrivers = 0
	}

	// Average load per busy driver (not per all active drivers, to avoid
	// diluting the metric with truly idle drivers).
	var activeDriversLoad float64
	if busyDrivers > 0 {
		activeDriversLoad = math.Round(float64(totalAssigned)/float64(busyDrivers)*10) / 10
	}

	// ── Orphan shipments ───────────────────────────────────────────────────────
	// out_for_delivery shipments whose tracking_id does not appear in any
	// active route for today.
	var orphanShipments int
	_ = db.QueryRow(
		`SELECT COUNT(*)
		 FROM shipments s
		 WHERE s.status = 'out_for_delivery'
		   AND NOT EXISTS (
		       SELECT 1
		       FROM routes r
		       WHERE r.date = $1
		         AND r.status IN ('pendiente','en_curso')
		         AND r.shipment_ids @> to_jsonb(s.tracking_id::text)
		   )`,
		today,
	).Scan(&orphanShipments)

	base := model.FleetSuggestion{
		DelayRatePct:      delayRatePct,
		ActiveDrivers:     activeDrivers,
		IdleDrivers:       idleDrivers,
		OrphanShipments:   orphanShipments,
		ActiveDriversLoad: activeDriversLoad,
	}

	// ── CASO A: Ineficiencia de ruteo ─────────────────────────────────────────
	// SLA comprometido pero hay choferes desocupados → problema de asignación,
	// no de capacidad. Debe resolverse antes de contratar.
	if delayRatePct > 10.0 && idleDrivers > 0 {
		base.Status = model.FleetStatusWarning
		base.Message = "⚠️ Ineficiencia detectada: SLA comprometido, pero hay " +
			itoa(idleDrivers) + " chofer(es) inactivo(s). " +
			"Revise la asignación de rutas antes de sumar flota."
		return base
	}

	// ── CASO B: Déficit crítico ───────────────────────────────────────────────
	// SLA comprometido, sin choferes libres y hay envíos sin asignar.
	if delayRatePct > 10.0 && idleDrivers == 0 && orphanShipments > 0 {
		driversNeeded := int(math.Ceil(float64(orphanShipments) / maxPackagesPerDriver))
		base.Status = model.FleetStatusCritical
		base.DriversNeeded = driversNeeded
		base.Message = "🚨 Capacidad rebasada: Todos los choferes están ocupados. " +
			"Se requieren " + itoa(driversNeeded) + " vehículo(s) extra para absorber " +
			itoa(orphanShipments) + " envío(s) estancado(s)."
		return base
	}

	// ── CASO C: Alerta preventiva ─────────────────────────────────────────────
	// SLA estable pero la flota está cerca del límite físico → riesgo ante picos.
	capacityThresholdHigh := float64(maxPackagesPerDriver) * 0.90
	if delayRatePct < 5.0 && idleDrivers == 0 && activeDriversLoad > capacityThresholdHigh {
		capacityUsedPct := math.Round(activeDriversLoad/float64(maxPackagesPerDriver)*1000) / 10
		base.Status = model.FleetStatusPreventive
		base.CapacityUsedPct = capacityUsedPct
		base.Message = "⚡ Flota al límite: El SLA es estable, pero la operación está al " +
			ftoa(capacityUsedPct) + "% de su capacidad física. " +
			"Riesgo alto ante un pico de demanda."
		return base
	}

	// ── CASO D: Capacidad ociosa ──────────────────────────────────────────────
	capacityThresholdLow := float64(maxPackagesPerDriver) * 0.50
	if delayRatePct < 2.0 && activeDriversLoad < capacityThresholdLow {
		base.Status = model.FleetStatusIdle
		base.Message = "💡 Optimización posible: Baja demanda. Se pueden consolidar rutas " +
			"y desafectar vehículos temporalmente sin impactar el servicio."
		return base
	}

	// ── DEFAULT: Operación equilibrada ────────────────────────────────────────
	base.Status = model.FleetStatusStable
	base.Message = "✅ Operación equilibrada: La proporción entre envíos, asignaciones y cumplimiento SLA es óptima."
	return base
}

// itoa converts an int to its decimal string representation without importing strconv.
func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

// ftoa formats a float64 with one decimal place.
func ftoa(f float64) string {
	return fmt.Sprintf("%.1f", f)
}
