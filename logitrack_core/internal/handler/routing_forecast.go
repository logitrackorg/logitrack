package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

// RoutingForecastHandler expone forecasting de demanda y rolling horizon plan.
// Admin + manager only (registrado en main.go).
type RoutingForecastHandler struct {
	forecast    *service.ForecastService
	rollingPlan *service.RollingPlanService
}

func NewRoutingForecastHandler(forecast *service.ForecastService, rollingPlan *service.RollingPlanService) *RoutingForecastHandler {
	return &RoutingForecastHandler{forecast: forecast, rollingPlan: rollingPlan}
}

// GET /admin/routing/forecast?days=7
func (h *RoutingForecastHandler) GetForecast(c *gin.Context) {
	days := 7
	if s := c.Query("days"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 30 {
			days = n
		}
	}
	data, err := h.forecast.Predict(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if data == nil {
		data = []model.ODForecast{}
	}
	c.JSON(http.StatusOK, gin.H{"horizon_days": days, "forecasts": data})
}

// GET /admin/routing/forecast/quality
func (h *RoutingForecastHandler) GetForecastQuality(c *gin.Context) {
	q, err := h.forecast.BacktestMAPE()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, q)
}

// GET /admin/routing/rolling-plan?days=5
func (h *RoutingForecastHandler) GetRollingPlan(c *gin.Context) {
	days := 5
	if s := c.Query("days"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 14 {
			days = n
		}
	}
	plan, err := h.rollingPlan.Generate(days)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, plan)
}
