package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type StatsExtendedHandler struct {
	svc *service.StatsExtendedService
}

func NewStatsExtendedHandler(svc *service.StatsExtendedService) *StatsExtendedHandler {
	return &StatsExtendedHandler{svc: svc}
}

func (h *StatsExtendedHandler) DriverPerformance(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		branchID = user.BranchID
	}

	result, err := h.svc.DriverPerformance(dateFrom, dateTo, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *StatsExtendedHandler) IncidentsByBranch(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		branchID = user.BranchID
	}

	result, err := h.svc.IncidentsByBranch(dateFrom, dateTo, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *StatsExtendedHandler) BillingMetrics(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		branchID = user.BranchID
	}

	result, err := h.svc.BillingMetrics(dateFrom, dateTo, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *StatsExtendedHandler) BranchRanking(c *gin.Context) {
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	// Ranking shows ALL branches regardless of role — no supervisor scoping.
	_ = c.Query("branch_id")

	result, err := h.svc.BranchRanking(dateFrom, dateTo, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *StatsExtendedHandler) VolumeByTimeWindow(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		branchID = user.BranchID
	}

	result, err := h.svc.VolumeByTimeWindow(dateFrom, dateTo, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *StatsExtendedHandler) ReturnMetrics(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		branchID = user.BranchID
	}

	result, err := h.svc.ReturnMetrics(dateFrom, dateTo, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *StatsExtendedHandler) SuccessRateByBranch(c *gin.Context) {
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		dateTo = &endOfDay
	}

	_ = c.Query("branch_id")

	result, err := h.svc.SuccessRateByBranch(dateFrom, dateTo, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
