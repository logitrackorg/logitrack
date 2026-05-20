package handler

import (
	"math"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

const dashboardHistoryLimit = 30

type SupervisorFatigueHandler struct {
	authRepo    repository.AuthRepository
	checkinRepo *repository.CheckinRepository
	fatigueSvc  *service.FatigueConfigService
}

func NewSupervisorFatigueHandler(
	authRepo repository.AuthRepository,
	fatigueSvc *service.FatigueConfigService,
) *SupervisorFatigueHandler {
	return &SupervisorFatigueHandler{
		authRepo:    authRepo,
		checkinRepo: repository.NewCheckinRepository(),
		fatigueSvc:  fatigueSvc,
	}
}

// GetDashboard returns the fatigue status for every active driver in a branch.
// Supervisors always see their own branch.
// Managers can specify ?branch_id= to filter; empty means all drivers.
func (h *SupervisorFatigueHandler) GetDashboard(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	branchID := user.BranchID
	if branchID == "" {
		// manager/admin: use query param (empty = all branches)
		branchID = c.Query("branch_id")
	}

	cfg := h.fatigueSvc.Get()
	today := todayAR()

	drivers := h.authRepo.ListByRole(model.RoleDriver, branchID)

	statuses := make([]model.DriverFatigueStatus, 0, len(drivers))
	for _, d := range drivers {
		if d.Status == model.UserStatusInactive {
			continue
		}
		statuses = append(statuses, h.buildStatus(d, today, cfg))
	}

	c.JSON(http.StatusOK, model.FatigueDashboardResponse{
		BranchID: branchID,
		Date:     today,
		Drivers:  statuses,
		GreenMax: cfg.RiskThresholds.GreenMax,
		RedMin:   cfg.RiskThresholds.RedMin,
	})
}

func (h *SupervisorFatigueHandler) buildStatus(
	driver model.User,
	today string,
	cfg model.FatigueConfig,
) model.DriverFatigueStatus {
	fullName := strings.TrimSpace(driver.FirstName + " " + driver.LastName)
	if fullName == "" {
		fullName = driver.Username
	}

	status := model.DriverFatigueStatus{
		DriverID:  driver.ID,
		FullName:  fullName,
		Username:  driver.Username,
		RiskLevel: model.RiskPending,
	}

	// Today's check-in
	if checkin, ok := h.checkinRepo.Get(driver.ID, today); ok {
		status.CheckinToday = true
		t := checkin.RecordedAt
		status.CheckinTime = &t

		if checkin.Skipped {
			// Driver bypassed the gate — no KSS/voice data to evaluate.
			status.RiskLevel = model.RiskSkipped
		} else {
			kss := checkin.KSSLevel
			horas := checkin.HorasSueno
			status.KSSLevel = &kss
			status.HorasSueno = &horas
			status.DriftScore = checkin.DriftScore
			status.HasVoice = checkin.VoiceMetrics != nil
			status.PVTMetrics = checkin.PVTMetrics

			score, level := fatigueRiskScore(checkin, cfg)
			status.RiskScore = &score
			status.RiskLevel = level
		}
	}

	// History — all check-ins for this driver, sorted newest first.
	// AllForDriver may return nil (no records); we normalize to empty slice so
	// the JSON field serializes as [] instead of null.
	all := h.checkinRepo.AllForDriver(driver.ID)
	sort.Slice(all, func(i, j int) bool { return all[i].Date > all[j].Date })
	if len(all) > dashboardHistoryLimit {
		all = all[:dashboardHistoryLimit]
	}
	if all == nil {
		all = []model.DriverCheckin{}
	}
	status.History = all

	return status
}

// normalizeKSS maps the 8-point KSS level to a fixed 0–100 risk scale.
// The scale excludes the original neutral midpoint (old level 5).
//   1–4 (alert)                                  →   0 risk
//   5–6 (signs of drowsiness / moderate effort)  →  50 risk
//   7–8 (high drowsiness / fighting sleep)        → 100 risk
func normalizeKSS(level int) float64 {
	switch {
	case level >= 7:
		return 100
	case level >= 5:
		return 50
	default:
		return 0
	}
}

// fatigueRiskScore computes a weighted composite score (0–100) using the
// per-test weights and enabled flags from FatigueConfig.
//
// Only ENABLED tests contribute to the score. If an enabled test has no data
// yet (e.g. voice drift requires a baseline), its weight is redistributed
// proportionally among enabled tests that do have data.
func fatigueRiskScore(checkin model.DriverCheckin, cfg model.FatigueConfig) (score int, level model.DriverRiskLevel) {
	type testData struct {
		value        float64 // normalised 0–100
		configWeight float64 // weight from the config
	}

	var parts []testData

	// ── KSS ───────────────────────────────────────────────────────────────────
	if cfg.KSSEnabled {
		parts = append(parts, testData{normalizeKSS(checkin.KSSLevel), cfg.KSSWeight})
	}

	// ── Voice drift — already 0–100; only when a baseline exists ─────────────
	if cfg.VoiceEnabled && checkin.DriftScore != nil {
		parts = append(parts, testData{float64(*checkin.DriftScore), cfg.VoiceWeight})
	}

	// ── Touch-event misfires — cap at 10 total (= 100 risk) ──────────────────
	if cfg.TactileEnabled && len(checkin.TouchEvents) > 0 {
		total := 0
		for _, e := range checkin.TouchEvents {
			total += e.Misfires
		}
		parts = append(parts, testData{math.Min(float64(total)*10.0, 100.0), cfg.TactileWeight})
	}

	// ── PVT latency — 0 ms = 0 risk, ≥ 500 ms = 100 risk ───────────────────
	if cfg.PVTEnabled && checkin.PVTMetrics != nil {
		parts = append(parts, testData{math.Min(checkin.PVTMetrics.LatenciaPromedioMs/5.0, 100.0), cfg.PVTWeight})
	}

	if len(parts) == 0 {
		// No enabled tests have data — classify as green (no evidence of risk).
		return 0, model.RiskGreen
	}

	// Proportional redistribution among the parts that have data.
	totalWeight := 0.0
	for _, p := range parts {
		totalWeight += p.configWeight
	}

	composite := 0.0
	for _, p := range parts {
		composite += (p.configWeight / totalWeight) * p.value
	}

	score = int(math.Round(composite))
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	switch {
	case score >= cfg.RiskThresholds.RedMin:
		level = model.RiskRed
	case score > cfg.RiskThresholds.GreenMax:
		level = model.RiskAmber
	default:
		level = model.RiskGreen
	}
	return
}
