package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/clock"
)

// ClockHandler expone endpoints admin para inspeccionar y manipular el reloj
// global del sistema (testing). Sin servicio dedicado: delega directo al
// paquete clock.
type ClockHandler struct{}

func NewClockHandler() *ClockHandler { return &ClockHandler{} }

type clockState struct {
	SystemNow string `json:"system_now"`
	RealNow   string `json:"real_now"`
	OffsetMs  int64  `json:"offset_ms"`
	IsActive  bool   `json:"is_active"`
}

func currentState() clockState {
	real := time.Now().UTC()
	off := clock.Offset()
	return clockState{
		SystemNow: real.Add(off).Format(time.RFC3339Nano),
		RealNow:   real.Format(time.RFC3339Nano),
		OffsetMs:  off.Milliseconds(),
		IsActive:  clock.IsActive(),
	}
}

func (h *ClockHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, currentState())
}

type setClockRequest struct {
	OverrideAt string `json:"override_at"`
}

func (h *ClockHandler) Set(c *gin.Context) {
	var req setClockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	target, err := time.Parse(time.RFC3339, req.OverrideAt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "override_at debe ser una fecha en formato RFC3339"})
		return
	}
	// Evitar typos catastróficos: cap de ±10 años desde el momento real.
	now := time.Now()
	if target.Before(now.AddDate(-10, 0, 0)) || target.After(now.AddDate(10, 0, 0)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "override_at fuera de rango (±10 años)"})
		return
	}
	clock.SetOverride(target)
	c.JSON(http.StatusOK, currentState())
}

func (h *ClockHandler) Clear(c *gin.Context) {
	clock.ClearOverride()
	c.JSON(http.StatusOK, currentState())
}
