package handler

import (
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

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
	historyRepo *repository.HistoryAccessRequestRepository
	fatigueSvc  *service.FatigueConfigService
}

func NewSupervisorFatigueHandler(
	authRepo repository.AuthRepository,
	fatigueSvc *service.FatigueConfigService,
) *SupervisorFatigueHandler {
	return &SupervisorFatigueHandler{
		authRepo:    authRepo,
		checkinRepo: repository.NewCheckinRepository(),
		historyRepo: repository.NewHistoryAccessRequestRepository(),
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
		DriverID:   driver.ID,
		FullName:   fullName,
		Username:   driver.Username,
		DriverType: driver.DriverType,
		RiskLevel:  model.RiskPending,
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

			// Los choferes inter-sucursal no realizan entregas directas al
			// destinatario, por lo que nunca generan touch events.
			// Excluir la prueba táctil de su cálculo para que el peso no se
			// redistribuya artificialmente entre las otras pruebas.
			effectiveCfg := cfg
			if driver.DriverType == model.DriverTypeInterBranch {
				effectiveCfg.TactileEnabled = false
			}

			score, level := fatigueRiskScore(checkin, effectiveCfg)
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

// GetHistory returns aggregated fatigue metrics for the branch over the last 30 days.
// Used by the Dashboard "Fatiga" tab (supervisor + manager).
func (h *SupervisorFatigueHandler) GetHistory(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	branchID := user.BranchID
	if branchID == "" {
		branchID = c.Query("branch_id")
	}

	cfg := h.fatigueSvc.Get()
	drivers := h.authRepo.ListByRole(model.RoleDriver, branchID)

	type dailyEntry struct {
		verde, amarillo, rojo, salteado int
		totalSueno                      float64
		suenoCount                      int
		totalRisk                       float64
		riskCount                       int
	}

	dailyMap := map[string]*dailyEntry{}
	ranking := make([]model.DriverRankingItem, 0, len(drivers))

	for _, d := range drivers {
		if d.Status == model.UserStatusInactive {
			continue
		}
		fullName := strings.TrimSpace(d.FirstName + " " + d.LastName)
		if fullName == "" {
			fullName = d.Username
		}

		all := h.checkinRepo.AllForDriver(d.ID)

		var driverTotalRisk float64
		var driverRiskCount int
		var driverTotalSueno float64
		var driverSuenoCount int

		for _, checkin := range all {
			entry, ok := dailyMap[checkin.Date]
			if !ok {
				entry = &dailyEntry{}
				dailyMap[checkin.Date] = entry
			}

			if checkin.Skipped {
				entry.salteado++
			} else {
				effectiveCfg := cfg
				if d.DriverType == model.DriverTypeInterBranch {
					effectiveCfg.TactileEnabled = false
				}
				score, level := fatigueRiskScore(checkin, effectiveCfg)

				switch level {
				case model.RiskGreen:
					entry.verde++
				case model.RiskAmber:
					entry.amarillo++
				case model.RiskRed:
					entry.rojo++
				}

				f := float64(score)
				entry.totalRisk += f
				entry.riskCount++
				driverTotalRisk += f
				driverRiskCount++
			}

			entry.totalSueno += float64(checkin.HorasSueno)
			entry.suenoCount++
			driverTotalSueno += float64(checkin.HorasSueno)
			driverSuenoCount++
		}

		item := model.DriverRankingItem{
			DriverID:      d.ID,
			FullName:      fullName,
			Username:      d.Username,
			TotalCheckins: len(all),
			RiskLevel:     string(model.RiskPending),
		}
		if driverRiskCount > 0 {
			avg := driverTotalRisk / float64(driverRiskCount)
			item.AvgRiskScore = math.Round(avg*10) / 10
			switch {
			case avg >= float64(cfg.RiskThresholds.RedMin):
				item.RiskLevel = string(model.RiskRed)
			case avg > float64(cfg.RiskThresholds.GreenMax):
				item.RiskLevel = string(model.RiskAmber)
			default:
				item.RiskLevel = string(model.RiskGreen)
			}
		}
		if driverSuenoCount > 0 {
			item.AvgHorasSueno = math.Round(driverTotalSueno/float64(driverSuenoCount)*10) / 10
		}
		ranking = append(ranking, item)
	}

	// Sort ranking by avg risk score descending, then by name ascending.
	sort.Slice(ranking, func(i, j int) bool {
		if ranking[i].AvgRiskScore != ranking[j].AvgRiskScore {
			return ranking[i].AvgRiskScore > ranking[j].AvgRiskScore
		}
		return ranking[i].FullName < ranking[j].FullName
	})

	// Build sorted daily slice (ascending by date), capped at last 30 days.
	dates := make([]string, 0, len(dailyMap))
	for date := range dailyMap {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	if len(dates) > 30 {
		dates = dates[len(dates)-30:]
	}

	dailyMetrics := make([]model.FatigueDailyMetric, 0, len(dates))
	for _, date := range dates {
		e := dailyMap[date]
		m := model.FatigueDailyMetric{
			Date:     date,
			Verde:    e.verde,
			Amarillo: e.amarillo,
			Rojo:     e.rojo,
			Salteado: e.salteado,
		}
		if e.suenoCount > 0 {
			m.AvgHorasSueno = math.Round(e.totalSueno/float64(e.suenoCount)*10) / 10
		}
		if e.riskCount > 0 {
			m.AvgRiskScore = math.Round(e.totalRisk/float64(e.riskCount)*10) / 10
		}
		dailyMetrics = append(dailyMetrics, m)
	}

	c.JSON(http.StatusOK, model.FatigueHistoryResponse{
		BranchID:      branchID,
		DailyMetrics:  dailyMetrics,
		DriverRanking: ranking,
		GreenMax:      cfg.RiskThresholds.GreenMax,
		RedMin:        cfg.RiskThresholds.RedMin,
	})
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

// ── Historial personal de check-ins ──────────────────────────────────────────

// ListHistoryRequests returns all history access requests (optionally filtered
// by ?status=pending|approved|rejected). Used by supervisors in the Fatigue panel.
func (h *SupervisorFatigueHandler) ListHistoryRequests(c *gin.Context) {
	statusFilter := model.HistoryRequestStatus(c.Query("status"))

	var requests []model.HistoryAccessRequest
	if statusFilter != "" {
		requests = h.historyRepo.ListByStatus(statusFilter)
	} else {
		requests = h.historyRepo.ListAll()
	}

	// Enrich with driver name for display.
	type enriched struct {
		model.HistoryAccessRequest
		FullName string `json:"full_name"`
		Username string `json:"username"`
	}
	result := make([]enriched, 0, len(requests))
	for _, req := range requests {
		e := enriched{HistoryAccessRequest: req}
		if driver, err := h.authRepo.GetUserByID(req.DriverID); err == nil {
			fullName := strings.TrimSpace(driver.FirstName + " " + driver.LastName)
			if fullName == "" {
				fullName = driver.Username
			}
			e.FullName = fullName
			e.Username = driver.Username
		}
		result = append(result, e)
	}

	// Sort: pending first, then by request date descending.
	sort.Slice(result, func(i, j int) bool {
		if result[i].Status != result[j].Status {
			if result[i].Status == model.HistoryRequestPending {
				return true
			}
			if result[j].Status == model.HistoryRequestPending {
				return false
			}
		}
		return result[i].RequestDate.After(result[j].RequestDate)
	})

	c.JSON(http.StatusOK, gin.H{"requests": result, "total": len(result)})
}

// ReviewHistoryRequest approves or rejects a driver's history access request.
// Body: { "action": "approve" | "reject", "note": "..." (optional) }
func (h *SupervisorFatigueHandler) ReviewHistoryRequest(c *gin.Context) {
	reviewer := c.MustGet(middleware.UserKey).(model.User)
	driverID := c.Param("driver_id")

	var body struct {
		Action string `json:"action" binding:"required"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "se requiere el campo 'action'"})
		return
	}

	var newStatus model.HistoryRequestStatus
	switch body.Action {
	case "approve":
		newStatus = model.HistoryRequestApproved
	case "reject":
		newStatus = model.HistoryRequestRejected
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "acción inválida — debe ser 'approve' o 'reject'"})
		return
	}

	req, ok := h.historyRepo.Get(driverID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "no existe una solicitud para este chofer"})
		return
	}
	if req.Status != model.HistoryRequestPending {
		c.JSON(http.StatusConflict, gin.H{"error": "la solicitud ya fue revisada"})
		return
	}

	now := time.Now()
	req.Status = newStatus
	req.ReviewedBy = reviewer.Username
	req.ReviewedAt = &now
	req.ReviewNote = body.Note

	if err := h.historyRepo.Upsert(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar la revisión"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "request": req})
}
