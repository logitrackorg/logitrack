package handler

import (
	"database/sql"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
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
}

func NewSLAMetricsHandler(db *sql.DB, logRepo *repository.PriorityLogRepository) *SLAMetricsHandler {
	return &SLAMetricsHandler{db: db, logRepo: logRepo}
}

// Get computes and returns the three SLA metrics in a single response.
func (h *SLAMetricsHandler) Get(c *gin.Context) {
	now := time.Now()

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
	logs := h.logRepo.ListAll()
	dayCounts := map[string]int{}
	cutoff := now.AddDate(0, 0, -7).Truncate(24 * time.Hour)
	for _, entry := range logs {
		if entry.Timestamp.Before(cutoff) {
			continue
		}
		day := entry.Timestamp.Format("2006-01-02")
		dayCounts[day]++
	}
	// Fill all 7 days even when count is 0 so the chart has a continuous X axis.
	trend := make([]model.SLADayCount, 7)
	for i := 6; i >= 0; i-- {
		day := now.AddDate(0, 0, -i).Format("2006-01-02")
		trend[6-i] = model.SLADayCount{Date: day, Count: dayCounts[day]}
	}

	c.JSON(http.StatusOK, model.SLAMetrics{
		SlaHealthRate: slaHealthRate,
		ActiveTotal:   activeTotal,
		DelayedTotal:  delayedTotal,
		Bottlenecks:   bottlenecks,
		DelayTrend:    trend,
	})
}
