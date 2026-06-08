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

// activeRow is one active shipment's status/dwell-time/destination-branch,
// shared between the global SLA aggregation and the per-branch fleet analysis.
type activeRow struct {
	status            string
	updatedAt         time.Time
	receivingBranchID string
}

// SLAMetricsHandler exposes aggregated SLA health metrics for the Dashboard.
type SLAMetricsHandler struct {
	db         *sql.DB
	logRepo    *repository.PriorityLogRepository
	svc        *service.SLAAnomalyService
	fleetML    *ml.FleetMLService
	branchRepo repository.BranchRepository
}

func NewSLAMetricsHandler(db *sql.DB, logRepo *repository.PriorityLogRepository, svc *service.SLAAnomalyService, fleetML *ml.FleetMLService, branchRepo repository.BranchRepository) *SLAMetricsHandler {
	return &SLAMetricsHandler{db: db, logRepo: logRepo, svc: svc, fleetML: fleetML, branchRepo: branchRepo}
}

// Get computes and returns the three SLA metrics in a single response.
func (h *SLAMetricsHandler) Get(c *gin.Context) {
	// CRITICAL: use clock.Now() — not time.Now() — so that the dwell-time
	// calculation stays on the same timeline as the executor and the shipment
	// updated_at timestamps. Using time.Now() when the admin clock is advanced
	// (time-travel testing) produces negative dwell values → 0 delays reported.
	now := clock.Now()

	// ── 1. Query active shipments (status + updated_at + receiving branch) ───
	rows, err := h.db.Query(`
		SELECT status, updated_at, receiving_branch_id
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

	var actives []activeRow
	activeByBranch := map[string][]activeRow{}
	for rows.Next() {
		var r activeRow
		if err := rows.Scan(&r.status, &r.updatedAt, &r.receivingBranchID); err != nil {
			continue
		}
		actives = append(actives, r)
		activeByBranch[r.receivingBranchID] = append(activeByBranch[r.receivingBranchID], r)
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

	// ── 4. Current per-status averages — one row per monitored status, always
	// Iterate the canonical monitored-status list (not the Collector cache map)
	// so every state the SLA engine tracks gets its own row, regardless of
	// whether the Collector has historical data for it yet or whether any
	// shipment is currently sitting in that state. States without enough
	// historical transitions come back as AvgHours=0 / HasData=false so the
	// frontend can render an explanatory tooltip instead of hiding the row.
	currentAvgMap := h.svc.GetCurrentAverages()
	monitoredCodes := model.MonitoredStatusCodes()
	currentAverages := make([]model.SLAStateAverage, 0, len(monitoredCodes))
	for _, code := range monitoredCodes {
		avgH, hasData := currentAvgMap[code]
		label := slaStatusLabel[code]
		if label == "" {
			label = code
		}
		currentAverages = append(currentAverages, model.SLAStateAverage{
			Status:   label,
			AvgHours: math.Round(avgH*10) / 10,
			HasData:  hasData,
		})
	}
	sort.Slice(currentAverages, func(i, j int) bool {
		return currentAverages[i].AvgHours > currentAverages[j].AvgHours
	})

	// ── 5. Fleet analysis: heuristic + ML, evaluated independently per branch ──
	fleetDiagnoses := h.analyzeFleetByBranch(now, activeByBranch)

	c.JSON(http.StatusOK, model.SLAMetrics{
		SlaHealthRate:   slaHealthRate,
		ActiveTotal:     activeTotal,
		DelayedTotal:    delayedTotal,
		Bottlenecks:     bottlenecks,
		DelayTrend:      trend,
		CurrentAverages: currentAverages,
		FleetDiagnoses:  fleetDiagnoses,
	})
}

// ── Fleet heuristic helper ────────────────────────────────────────────────────

// maxPackagesPerDriver is the daily capacity limit used to calculate how many
// extra drivers are needed to cover orphan shipments (Case B) and to detect
// near-capacity situations (Case C).
const maxPackagesPerDriver = 30

// analyzeFleetByBranch evaluates the deterministic heuristic and (when the
// model is loaded) the Random Forest independently for each active branch:
// each engine only sees that branch's active shipments and that branch's
// drivers — there is no longer a single global fleet diagnosis.
//
// All DB queries use `now` (clock.Now()) for time-travel consistency.
func (h *SLAMetricsHandler) analyzeFleetByBranch(now time.Time, activeByBranch map[string][]activeRow) []model.BranchFleetDiagnosis {
	db := h.db
	today := now.Format("2006-01-02")

	branches := h.branchRepo.ListActive()
	diagnoses := make([]model.BranchFleetDiagnosis, 0, len(branches))

	for _, branch := range branches {
		actives := activeByBranch[branch.ID]
		totalShipments := len(actives)

		delayed := 0
		for _, r := range actives {
			if !slaMonitoredStatuses[r.status] {
				continue
			}
			if now.Sub(r.updatedAt).Hours() > delayThresholdHours {
				delayed++
			}
		}
		var delayRatePct float64
		if totalShipments > 0 {
			delayRatePct = math.Round(float64(delayed)/float64(totalShipments)*1000) / 10
		}

		// ── Active drivers based at this branch ───────────────────────────────
		var activeDrivers int
		_ = db.QueryRow(
			`SELECT COUNT(*) FROM users WHERE role = 'driver' AND status = 'activo' AND branch_id = $1`,
			branch.ID,
		).Scan(&activeDrivers)

		// ── Today's route assignments for this branch's drivers ───────────────
		busyDrivers := map[string]bool{}
		routeRows, err := db.Query(
			`SELECT DISTINCT r.driver_id
			 FROM routes r
			 JOIN users u ON u.id = r.driver_id
			 WHERE r.date = $1 AND r.status IN ('pendiente','en_curso') AND u.branch_id = $2`,
			today, branch.ID,
		)
		if err == nil {
			for routeRows.Next() {
				var driverID string
				if scanErr := routeRows.Scan(&driverID); scanErr == nil {
					busyDrivers[driverID] = true
				}
			}
			routeRows.Close()
		}

		idleDrivers := activeDrivers - len(busyDrivers)
		if idleDrivers < 0 {
			idleDrivers = 0
		}

		// ── Orphan shipments destined to this branch ──────────────────────────
		var orphanShipments int
		_ = db.QueryRow(
			`SELECT COUNT(*)
			 FROM shipments s
			 WHERE s.status = 'out_for_delivery'
			   AND s.receiving_branch_id = $1
			   AND NOT EXISTS (
			       SELECT 1
			       FROM routes r
			       WHERE r.date = $2
			         AND r.status IN ('pendiente','en_curso')
			         AND r.shipment_ids @> to_jsonb(s.tracking_id::text)
			   )`,
			branch.ID, today,
		).Scan(&orphanShipments)

		// ── Fleet utilization ratio — replaces "carga promedio" as the signal
		// behind PREVENTIVO/OCIOSO: total active shipments per active driver,
		// compared against the same maxPackagesPerDriver capacity ceiling.
		var utilizationRatio float64
		if activeDrivers > 0 {
			utilizationRatio = float64(totalShipments) / float64(activeDrivers)
		}

		rawMetrics := &model.FleetRawMetrics{
			TotalShipments:       totalShipments,
			SlaDelayPct:          delayRatePct,
			OrphanShipments:      orphanShipments,
			IdleDrivers:          idleDrivers,
			ActiveDrivers:        activeDrivers,
			SuggestedDriverDelta: calcDriverDelta(delayRatePct, idleDrivers, orphanShipments, activeDrivers, totalShipments),
		}

		// ── 1. Heuristic classification (always runs) ─────────────────────────
		heurStatus := runHeuristic(delayRatePct, idleDrivers, orphanShipments, utilizationRatio)
		heurDiag := model.FleetDiagnosis{
			Status:     heurStatus,
			Message:    fleetStatusMessage(heurStatus, idleDrivers, orphanShipments, utilizationRatio),
			RawMetrics: rawMetrics,
		}

		// ── 2. ML classification (runs when model is loaded) ──────────────────
		var mlPred *model.FleetDiagnosis
		if h.fleetML != nil && h.fleetML.IsReady() {
			mlStatus, confidence, voteDist := h.fleetML.PredictFleetState(
				totalShipments, delayRatePct, idleDrivers, activeDrivers, orphanShipments,
			)
			mlPred = &model.FleetDiagnosis{
				Status:           mlStatus,
				Message:          fleetStatusMessage(mlStatus, idleDrivers, orphanShipments, utilizationRatio),
				Confidence:       math.Round(confidence*10000) / 10000,
				RawMetrics:       rawMetrics,
				VoteDistribution: voteDist,
			}
		}

		diagnoses = append(diagnoses, model.BranchFleetDiagnosis{
			BranchID:   branch.ID,
			BranchName: branch.Name,
			Heuristic:  heurDiag,
			ML:         mlPred,
		})
	}

	return diagnoses
}

// runHeuristic applies the deterministic five-case fleet classification.
// utilizationRatio (active shipments per active driver) is the fleet-wide
// saturation signal that replaced "carga promedio" (avg load of busy drivers
// only) — same thresholds, same five-case ordering, scoped to one branch.
func runHeuristic(delayRatePct float64, idleDrivers, orphanShipments int, utilizationRatio float64) model.FleetStatus {
	if delayRatePct > 10.0 && idleDrivers > 0 {
		return model.FleetStatusWarning
	}
	if delayRatePct > 10.0 && idleDrivers == 0 && orphanShipments > 0 {
		return model.FleetStatusCritical
	}
	if delayRatePct < 5.0 && idleDrivers == 0 && utilizationRatio > float64(maxPackagesPerDriver)*0.90 {
		return model.FleetStatusPreventive
	}
	if delayRatePct < 2.0 && utilizationRatio < float64(maxPackagesPerDriver)*0.50 {
		return model.FleetStatusIdle
	}
	return model.FleetStatusStable
}

// fleetStatusMessage returns the operator-facing message for a given fleet status.
func fleetStatusMessage(status model.FleetStatus, idleDrivers, orphanShipments int, utilizationRatio float64) string {
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
		utilizationPct := math.Round(utilizationRatio/float64(maxPackagesPerDriver)*1000) / 10
		return "⚡ Flota al límite: El SLA es estable, pero la relación envíos/chofer está al " +
			ftoa(utilizationPct) + "% de la capacidad de la sucursal. " +
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
