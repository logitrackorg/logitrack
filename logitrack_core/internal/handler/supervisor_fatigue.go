package handler

import (
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

// fatigueRiskScore computes a composite 0–100 risk score combining the acoustic
// drift score and the KSS level penalty defined in FatigueConfig, then classifies
// the result into a DriverRiskLevel colour band.
func fatigueRiskScore(checkin model.DriverCheckin, cfg model.FatigueConfig) (score int, level model.DriverRiskLevel) {
	// KSS → penalty points from config
	var kssPenalty int
	switch {
	case checkin.KSSLevel >= 8:
		kssPenalty = cfg.KSSScores.KSS89
	case checkin.KSSLevel >= 5:
		kssPenalty = cfg.KSSScores.KSS57
	default:
		kssPenalty = cfg.KSSScores.KSS14
	}

	// Drift score (0 when no baseline yet — first check-in)
	drift := 0
	if checkin.DriftScore != nil {
		drift = *checkin.DriftScore
	}

	score = drift + kssPenalty
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
