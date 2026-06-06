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
	"github.com/logitrack/core/internal/ml"
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
	fleetML *ml.FleetMLService
}

func NewSLAMetricsHandler(db *sql.DB, logRepo *repository.PriorityLogRepository, svc *service.SLAAnomalyService, fleetML *ml.FleetMLService) *SLAMetricsHandler {
	return &SLAMetricsHandler{db: db, logRepo: logRepo, svc: svc, fleetML: fleetML}
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

	// ── 5. Fleet analysis: heuristic + ML in parallel ────────────────────────────
	fleetSugg, heuristicDiag, mlPred := h.analyzeFleet(now, delayedTotal, activeTotal)

	c.JSON(http.StatusOK, model.SLAMetrics{
		SlaHealthRate:      slaHealthRate,
		ActiveTotal:        activeTotal,
		DelayedTotal:       delayedTotal,
		Bottlenecks:        bottlenecks,
		DelayTrend:         trend,
		CurrentAverages:    currentAverages,
		FleetSuggestion:    fleetSugg,
		HeuristicDiagnosis: heuristicDiag,
		MLPrediction:       mlPred,
	})
}

// ── Fleet heuristic helper ────────────────────────────────────────────────────

// maxPackagesPerDriver is the daily capacity limit used to calculate how many
// extra drivers are needed to cover orphan shipments (Case B) and to detect
// near-capacity situations (Case C).
const maxPackagesPerDriver = 30

// analyzeFleet collects operational metrics from DB, runs the heuristic and
// (when available) the ML model, and returns all three results:
//   - FleetSuggestion  — operational metrics + heuristic status (backward compat)
//   - FleetDiagnosis   — heuristic classification with message
//   - *FleetDiagnosis  — ML classification with confidence; nil if model not loaded
//
// All DB queries use `now` (clock.Now()) for time-travel consistency.
func (h *SLAMetricsHandler) analyzeFleet(now time.Time, delayedTotal, activeTotal int) (
	model.FleetSuggestion, model.FleetDiagnosis, *model.FleetDiagnosis,
) {
	db := h.db

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

	var activeDriversLoad float64
	if busyDrivers > 0 {
		activeDriversLoad = math.Round(float64(totalAssigned)/float64(busyDrivers)*10) / 10
	}

	// ── Orphan shipments ───────────────────────────────────────────────────────
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

	// ── 1. Heuristic classification (always runs) ─────────────────────────────
	heurStatus := runHeuristic(delayRatePct, idleDrivers, orphanShipments, activeDriversLoad)
	heurMsg := fleetStatusMessage(heurStatus, idleDrivers, orphanShipments, activeDriversLoad)

	// Build the operational-metrics struct (backward compat).
	sugg := model.FleetSuggestion{
		Status:            heurStatus,
		Message:           heurMsg,
		DelayRatePct:      delayRatePct,
		ActiveDrivers:     activeDrivers,
		IdleDrivers:       idleDrivers,
		OrphanShipments:   orphanShipments,
		ActiveDriversLoad: activeDriversLoad,
	}
	if heurStatus == model.FleetStatusCritical {
		sugg.DriversNeeded = int(math.Ceil(float64(orphanShipments) / maxPackagesPerDriver))
	} else if heurStatus == model.FleetStatusPreventive {
		sugg.CapacityUsedPct = math.Round(activeDriversLoad/float64(maxPackagesPerDriver)*1000) / 10
	}

	rawMetrics := &model.FleetRawMetrics{
		TotalShipments:       activeTotal,
		SlaDelayPct:          delayRatePct,
		OrphanShipments:      orphanShipments,
		IdleDrivers:          idleDrivers,
		ActiveDrivers:        activeDrivers,
		ActiveDriversLoad:    activeDriversLoad,
		SuggestedDriverDelta: calcDriverDelta(delayRatePct, idleDrivers, orphanShipments, activeDrivers, activeTotal),
	}

	heurDiag := model.FleetDiagnosis{
		Status:     heurStatus,
		Message:    heurMsg,
		RawMetrics: rawMetrics,
	}

	// ── 2. ML classification (runs when model is loaded) ──────────────────────
	var mlPred *model.FleetDiagnosis
	if h.fleetML != nil && h.fleetML.IsReady() {
		mlStatus, confidence, voteDist := h.fleetML.PredictFleetState(
			int(now.Weekday()), activeTotal, delayRatePct,
			orphanShipments, idleDrivers, activeDriversLoad,
		)
		mlMsg := fleetStatusMessage(mlStatus, idleDrivers, orphanShipments, activeDriversLoad)
		mlPred = &model.FleetDiagnosis{
			Status:           mlStatus,
			Message:          mlMsg,
			Confidence:       math.Round(confidence*10000) / 10000,
			RawMetrics:       rawMetrics,
			VoteDistribution: voteDist,
		}
	}

	return sugg, heurDiag, mlPred
}

// runHeuristic applies the deterministic five-case fleet classification.
func runHeuristic(delayRatePct float64, idleDrivers, orphanShipments int, activeDriversLoad float64) model.FleetStatus {
	if delayRatePct > 10.0 && idleDrivers > 0 {
		return model.FleetStatusWarning
	}
	if delayRatePct > 10.0 && idleDrivers == 0 && orphanShipments > 0 {
		return model.FleetStatusCritical
	}
	if delayRatePct < 5.0 && idleDrivers == 0 && activeDriversLoad > float64(maxPackagesPerDriver)*0.90 {
		return model.FleetStatusPreventive
	}
	if delayRatePct < 2.0 && activeDriversLoad < float64(maxPackagesPerDriver)*0.50 {
		return model.FleetStatusIdle
	}
	return model.FleetStatusStable
}

// fleetStatusMessage returns the operator-facing message for a given fleet status.
func fleetStatusMessage(status model.FleetStatus, idleDrivers, orphanShipments int, activeDriversLoad float64) string {
	switch status {
	case model.FleetStatusWarning:
		return "⚠️ Ineficiencia detectada: SLA comprometido, pero hay " +
			itoa(idleDrivers) + " chofer(es) inactivo(s). " +
			"Revise la asignación de rutas antes de sumar flota."
	case model.FleetStatusCritical:
		driversNeeded := int(math.Ceil(float64(orphanShipments) / maxPackagesPerDriver))
		return "🚨 Capacidad rebasada: Todos los choferes están ocupados. " +
			"Se requieren " + itoa(driversNeeded) + " vehículo(s) extra para absorber " +
			itoa(orphanShipments) + " envío(s) estancado(s)."
	case model.FleetStatusPreventive:
		capacityUsedPct := math.Round(activeDriversLoad/float64(maxPackagesPerDriver)*1000) / 10
		return "⚡ Flota al límite: El SLA es estable, pero la operación está al " +
			ftoa(capacityUsedPct) + "% de su capacidad física. " +
			"Riesgo alto ante un pico de demanda."
	case model.FleetStatusIdle:
		return "💡 Optimización posible: Baja demanda. Se pueden consolidar rutas " +
			"y desafectar vehículos temporalmente sin impactar el servicio."
	default:
		return "✅ Operación equilibrada: La proporción entre envíos, asignaciones y cumplimiento SLA es óptima."
	}
}

// calcDriverDelta returns the recommended change in driver headcount:
//
//	> 0  hire/activate that many drivers  (SLA crisis, no idle drivers, orphan shipments exist)
//	< 0  temporarily deactivate abs(n)    (very low demand, more drivers than needed)
//	  0  no staffing action required
func calcDriverDelta(delayRatePct float64, idleDrivers, orphanShipments, activeDrivers, totalShipments int) int {
	// AGREGAR: SLA crítico, todos los choferes ocupados y envíos sin cubrir.
	if delayRatePct > 10.0 && idleDrivers == 0 && orphanShipments > 0 {
		return int(math.Ceil(float64(orphanShipments) / float64(maxPackagesPerDriver)))
	}
	// QUITAR: demanda muy baja — hay más capacidad instalada que carga real.
	if delayRatePct < 2.0 {
		driversNeeded := int(math.Ceil(float64(totalShipments) / float64(maxPackagesPerDriver)))
		if surplus := activeDrivers - driversNeeded; surplus > 0 {
			return -surplus
		}
	}
	return 0
}

// itoa converts an int to its decimal string representation without importing strconv.
func itoa(n int) string {
	return fmt.Sprintf("%d", n)
}

// ftoa formats a float64 with one decimal place.
func ftoa(f float64) string {
	return fmt.Sprintf("%.1f", f)
}
