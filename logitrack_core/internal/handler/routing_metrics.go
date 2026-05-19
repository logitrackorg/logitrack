package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

// RoutingMetricsHandler expone métricas de ruteo al admin.
// Todos los endpoints son adminOnly (registrado en main.go).
type RoutingMetricsHandler struct {
	svc *service.RoutingMetricsService
}

func NewRoutingMetricsHandler(svc *service.RoutingMetricsService) *RoutingMetricsHandler {
	return &RoutingMetricsHandler{svc: svc}
}

// parseDateRange lee ?from=YYYY-MM-DD&to=YYYY-MM-DD.
// Default: últimos 30 días.
func parseDateRange(c *gin.Context) (time.Time, time.Time) {
	now := time.Now().UTC()
	from := now.AddDate(0, 0, -30).Truncate(24 * time.Hour)
	to := now

	if s := c.Query("from"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			from = t.UTC()
		}
	}
	if s := c.Query("to"); s != "" {
		if t, err := time.Parse("2006-01-02", s); err == nil {
			to = t.UTC().Add(24*time.Hour - time.Second)
		}
	}
	return from, to
}

// GET /admin/routing/metrics/plan?branch_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
func (h *RoutingMetricsHandler) GetPlanMetrics(c *gin.Context) {
	from, to := parseDateRange(c)
	data, err := h.svc.ListPlanMetrics(c.Query("branch_id"), from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if data == nil {
		data = []model.PlanMetric{}
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

// GET /admin/routing/metrics/apply?branch_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
func (h *RoutingMetricsHandler) GetApplyMetrics(c *gin.Context) {
	from, to := parseDateRange(c)
	data, err := h.svc.ListApplyMetrics(c.Query("branch_id"), from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if data == nil {
		data = []model.ApplyMetric{}
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

// GET /admin/routing/metrics/hops?branch_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
func (h *RoutingMetricsHandler) GetHopMetrics(c *gin.Context) {
	from, to := parseDateRange(c)
	data, err := h.svc.ListHopMetrics(c.Query("branch_id"), from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if data == nil {
		data = []model.ShipmentHopMetric{}
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

// GET /admin/routing/metrics/od-volume?origin=X&destination=Y&from=YYYY-MM-DD&to=YYYY-MM-DD
func (h *RoutingMetricsHandler) GetODVolume(c *gin.Context) {
	from, to := parseDateRange(c)
	data, err := h.svc.ListODVolume(c.Query("origin"), c.Query("destination"), from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if data == nil {
		data = []model.ODPairVolume{}
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

// GET /admin/routing/metrics/summary?branch_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
func (h *RoutingMetricsHandler) GetSummary(c *gin.Context) {
	from, to := parseDateRange(c)
	data, err := h.svc.GetSummary(c.Query("branch_id"), from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if data == nil {
		data = []model.RoutingMetricsSummary{}
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}
