package service

import (
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// lessUserID compares two user IDs for the deterministic tiebreak ("menor ID de
// usuario"). IDs are stored as strings but are numeric ("1","5","12"); a plain
// string compare would rank "12" before "5". We compare numerically when both
// parse as integers, falling back to lexicographic order otherwise.
func lessUserID(a, b string) bool {
	ai, aerr := strconv.Atoi(a)
	bi, berr := strconv.Atoi(b)
	if aerr == nil && berr == nil {
		return ai < bi
	}
	return a < b
}

// EmployeeOfMonthService calculates and persists monthly employee rankings.
type EmployeeOfMonthService struct {
	branchRepo   repository.BranchRepository
	shipmentRepo repository.ShipmentRepository
	routeRepo    repository.RouteRepository
	tripRepo     repository.InterBranchTripRepository
	claimRepo    repository.ClaimRepository
	authRepo     repository.AuthRepository
	checkinRepo  *repository.CheckinRepository
	fatigueConfigSvc *FatigueConfigService
	eomRepo      repository.EmployeeOfMonthRepository
}

func NewEmployeeOfMonthService(
	branchRepo repository.BranchRepository,
	shipmentRepo repository.ShipmentRepository,
	routeRepo repository.RouteRepository,
	tripRepo repository.InterBranchTripRepository,
	claimRepo repository.ClaimRepository,
	authRepo repository.AuthRepository,
	checkinRepo *repository.CheckinRepository,
	fatigueConfigSvc *FatigueConfigService,
	eomRepo repository.EmployeeOfMonthRepository,
) *EmployeeOfMonthService {
	return &EmployeeOfMonthService{
		branchRepo:       branchRepo,
		shipmentRepo:     shipmentRepo,
		routeRepo:        routeRepo,
		tripRepo:         tripRepo,
		claimRepo:        claimRepo,
		authRepo:         authRepo,
		checkinRepo:      checkinRepo,
		fatigueConfigSvc: fatigueConfigSvc,
		eomRepo:          eomRepo,
	}
}

// ComputeAndPersist runs the monthly ranking for the given period (any time within
// the target month). It uses the full calendar month as the scoring window.
func (s *EmployeeOfMonthService) ComputeAndPersist(period time.Time) error {
	periodStart, periodEnd := monthBounds(period)

	branches := s.branchRepo.List()
	enabledBranchIDs := map[string]bool{}
	for _, b := range branches {
		if b.EmployeeOfMonthEnabled && b.Status == model.BranchStatusActive {
			enabledBranchIDs[b.ID] = true
		}
	}

	// Per-branch categories: last_mile_driver and operator.
	for _, b := range branches {
		if !enabledBranchIDs[b.ID] {
			continue
		}
		if err := s.computeLastMile(b.ID, periodStart, periodEnd); err != nil {
			return err
		}
		if err := s.computeOperator(b.ID, periodStart, periodEnd); err != nil {
			return err
		}
	}

	// Network-wide category: inter_branch_driver.
	return s.computeInterBranch(enabledBranchIDs, periodStart, periodEnd)
}

// ── last-mile driver ──────────────────────────────────────────────────────────

func (s *EmployeeOfMonthService) computeLastMile(branchID string, from, to time.Time) error {
	drivers := s.authRepo.ListByRole(model.RoleDriver, branchID)
	var lastMileDrivers []model.User
	for _, d := range drivers {
		if d.DriverType == model.DriverTypeLastMile {
			lastMileDrivers = append(lastMileDrivers, d)
		}
	}

	// No filtramos por created_at: la ventana temporal de "entregas del mes" la
	// determina la fecha de la ruta (día de reparto), no la fecha de creación del
	// envío — un envío creado en un mes anterior puede entregarse en este período.
	// La intersección con driverShipmentIDs (rutas en [from, to]) acota el tiempo.
	shipments, _ := s.shipmentRepo.List(model.ShipmentFilter{
		ReceivingBranchID: branchID,
	})

	routes := s.routeRepo.ListByDateRange(from, to)

	claims, _ := s.claimRepo.ListAll()
	badTreatmentByTracking := map[string]int{}
	for _, c := range claims {
		if c.ClaimType == model.ClaimTypeBadTreatment &&
			!c.CreatedAt.Before(from) && !c.CreatedAt.After(to) {
			badTreatmentByTracking[c.TrackingID]++
		}
	}

	type candidate struct {
		user          model.User
		deliveries    int
		firstAttempt  int
		onTimeSLA     int
		complaints    int
		score         float64
	}

	var candidates []candidate
	for _, d := range lastMileDrivers {
		// Build set of shipment IDs from this driver's routes in the period.
		driverShipmentIDs := map[string]bool{}
		for _, r := range routes {
			if r.DriverID == d.ID {
				for _, id := range r.ShipmentIDs {
					driverShipmentIDs[id] = true
				}
			}
		}

		deliveries := 0
		firstAttempt := 0
		onTimeSLA := 0
		complaints := 0

		for _, s := range shipments {
			if s.Status != model.StatusDelivered {
				continue
			}
			if s.DeliveredAt == nil || !driverShipmentIDs[s.TrackingID] {
				continue
			}
			deliveries++
			if s.DeliveryAttempts == 0 {
				firstAttempt++
			}
			if s.EstimatedDeliveryAt != nil && !s.DeliveredAt.After(*s.EstimatedDeliveryAt) {
				onTimeSLA++
			}
			complaints += badTreatmentByTracking[s.TrackingID]
		}

		if deliveries < model.EOMMinLastMileDeliveries {
			continue
		}

		fa := float64(firstAttempt) / float64(deliveries)
		sla := float64(onTimeSLA) / float64(deliveries)
		comp := math.Min(float64(complaints)/float64(deliveries), 1.0)
		score := (model.EOMLastMileWeightFirstAttempt*fa +
			model.EOMLastMileWeightSLA*sla +
			model.EOMLastMileWeightComplaints*(1-comp)) * 100

		candidates = append(candidates, candidate{
			user: d, deliveries: deliveries,
			firstAttempt: firstAttempt, onTimeSLA: onTimeSLA,
			complaints: complaints, score: score,
		})
	}

	winner := model.EmployeeOfMonthWinner{
		Period:   from,
		Category: model.CategoryLastMileDriver,
		BranchID: branchID,
	}

	if len(candidates) == 0 {
		winner.HasWinner = false
		return s.eomRepo.UpsertWinner(winner)
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		if candidates[i].deliveries != candidates[j].deliveries {
			return candidates[i].deliveries > candidates[j].deliveries
		}
		return lessUserID(candidates[i].user.ID, candidates[j].user.ID)
	})

	w := candidates[0]
	score := w.score
	winner.HasWinner = true
	winner.UserID = w.user.ID
	winner.Score = &score
	winner.ActivityCount = w.deliveries
	return s.eomRepo.UpsertWinner(winner)
}

// ── operator ─────────────────────────────────────────────────────────────────

func (s *EmployeeOfMonthService) computeOperator(branchID string, from, to time.Time) error {
	operators := s.authRepo.ListByRole(model.RoleOperator, branchID)

	claims, _ := s.claimRepo.ListAll()
	badTreatmentByTracking := map[string]int{}
	for _, c := range claims {
		if c.ClaimType == model.ClaimTypeBadTreatment &&
			!c.CreatedAt.Before(from) && !c.CreatedAt.After(to) {
			badTreatmentByTracking[c.TrackingID]++
		}
	}

	type candidate struct {
		user      model.User
		total     int
		delivered int
		complaints int
		score     float64
	}

	var candidates []candidate
	maxTotal := 0

	for _, op := range operators {
		// Shipments persist created_by as the actor's username (handler sets
		// req.CreatedBy = user.Username; projection falls back to event.ChangedBy,
		// also a username). The winner is still stored with the user ID below.
		shipments, _ := s.shipmentRepo.List(model.ShipmentFilter{
			DateFrom: &from, DateTo: &to, CreatedBy: op.Username,
		})
		total := len(shipments)
		if total < model.EOMMinOperatorShipments {
			continue
		}
		delivered := 0
		complaints := 0
		for _, sh := range shipments {
			if sh.Status == model.StatusDelivered {
				delivered++
			}
			complaints += badTreatmentByTracking[sh.TrackingID]
		}
		if total > maxTotal {
			maxTotal = total
		}
		candidates = append(candidates, candidate{
			user: op, total: total, delivered: delivered, complaints: complaints,
		})
	}

	winner := model.EmployeeOfMonthWinner{
		Period:   from,
		Category: model.CategoryOperator,
		BranchID: branchID,
	}

	if len(candidates) == 0 {
		winner.HasWinner = false
		return s.eomRepo.UpsertWinner(winner)
	}

	for i := range candidates {
		c := &candidates[i]
		volNorm := 0.0
		if maxTotal > 0 {
			volNorm = float64(c.total) / float64(maxTotal)
		}
		successRate := float64(c.delivered) / float64(c.total)
		maltRate := math.Min(float64(c.complaints)/float64(c.total), 1.0)
		c.score = (model.EOMOperatorWeightVolume*volNorm +
			model.EOMOperatorWeightSuccess*successRate +
			model.EOMOperatorWeightComplaints*(1-maltRate)) * 100
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		if candidates[i].total != candidates[j].total {
			return candidates[i].total > candidates[j].total
		}
		return lessUserID(candidates[i].user.ID, candidates[j].user.ID)
	})

	w := candidates[0]
	score := w.score
	winner.HasWinner = true
	winner.UserID = w.user.ID
	winner.Score = &score
	winner.ActivityCount = w.total
	return s.eomRepo.UpsertWinner(winner)
}

// ── inter-branch driver ───────────────────────────────────────────────────────

func (s *EmployeeOfMonthService) computeInterBranch(enabledBranchIDs map[string]bool, from, to time.Time) error {
	trips := s.tripRepo.ListByDateRange(from, to)
	fatigueConfig := s.fatigueConfigSvc.Get()

	type candidate struct {
		userID   string
		trips    int
		onTime   int
		fatigueSum float64
		fatigueN   int
		score    float64
	}

	byDriver := map[string]*candidate{}
	for _, t := range trips {
		if t.Status != model.TripStatusCompleted {
			continue
		}
		if t.DriverID == nil || *t.DriverID == "" {
			continue
		}
		driverID := *t.DriverID

		// Only include drivers whose branch of origin has the feature enabled.
		driver, err := s.authRepo.GetUserByID(driverID)
		if err != nil || !enabledBranchIDs[driver.BranchID] {
			continue
		}
		if driver.DriverType != model.DriverTypeInterBranch {
			continue
		}

		if _, ok := byDriver[driverID]; !ok {
			byDriver[driverID] = &candidate{userID: driverID}
		}
		c := byDriver[driverID]
		c.trips++

		// Punctuality: last stop's CompletedAt ≤ trip's EstimatedArrivalAt.
		if t.EstimatedArrivalAt != nil && len(t.Stops) > 0 {
			lastStop := t.Stops[len(t.Stops)-1]
			if lastStop.CompletedAt != nil && !lastStop.CompletedAt.After(*t.EstimatedArrivalAt) {
				c.onTime++
			}
		}
	}

	// Add fatigue scores from check-in history.
	for driverID, c := range byDriver {
		checkins := s.checkinRepo.AllForDriver(driverID)
		for _, ci := range checkins {
			// El check-in date es YYYY-MM-DD en hora local (ART); parsear en UTC
			// desfasaría la ventana 3h y movería los check-ins de borde de mes.
			d, err := time.ParseInLocation("2006-01-02", ci.Date, clock.LocalTZ)
			if err != nil || d.Before(from) || d.After(to) {
				continue
			}
			score, _ := computeFatigueRiskScore(ci, fatigueConfig)
			c.fatigueSum += float64(score)
			c.fatigueN++
		}
	}

	winner := model.EmployeeOfMonthWinner{
		Period:   from,
		Category: model.CategoryInterBranchDriver,
		BranchID: "",
	}

	var eligible []candidate
	for _, c := range byDriver {
		if c.trips < model.EOMMinInterBranchTrips {
			continue
		}
		punctuality := float64(c.onTime) / float64(c.trips)
		fatigueScore := 0.0 // lower risk = higher score; inverted (100-avg)/100
		if c.fatigueN > 0 {
			avgRisk := c.fatigueSum / float64(c.fatigueN)
			fatigueScore = (100.0 - avgRisk) / 100.0
		}
		// sin_reasignacion = 1.0 (see technical debt in plan)
		c.score = (model.EOMInterBranchWeightPunctuality*punctuality +
			model.EOMInterBranchWeightFatigue*fatigueScore +
			model.EOMInterBranchWeightNoReassignment*1.0) * 100
		eligible = append(eligible, *c)
	}

	if len(eligible) == 0 {
		winner.HasWinner = false
		return s.eomRepo.UpsertWinner(winner)
	}

	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].score != eligible[j].score {
			return eligible[i].score > eligible[j].score
		}
		if eligible[i].trips != eligible[j].trips {
			return eligible[i].trips > eligible[j].trips
		}
		return lessUserID(eligible[i].userID, eligible[j].userID)
	})

	w := eligible[0]
	score := w.score
	winner.HasWinner = true
	winner.UserID = w.userID
	winner.Score = &score
	winner.ActivityCount = w.trips
	return s.eomRepo.UpsertWinner(winner)
}

// ── helpers ───────────────────────────────────────────────────────────────────

// monthBounds returns [first second of month, last second of month] in ART.
func monthBounds(t time.Time) (time.Time, time.Time) {
	loc := clock.LocalTZ
	local := t.In(loc)
	start := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, loc)
	end := start.AddDate(0, 1, 0).Add(-time.Second)
	return start, end
}

// computeFatigueRiskScore is a local copy of the handler-level fatigueRiskScore
// so the service package doesn't import the handler package.
func computeFatigueRiskScore(checkin model.DriverCheckin, cfg model.FatigueConfig) (score int, level model.DriverRiskLevel) {
	type testData struct {
		value        float64
		configWeight float64
	}

	var parts []testData

	if cfg.KSSEnabled {
		parts = append(parts, testData{normalizeKSSLevel(checkin.KSSLevel), cfg.KSSWeight})
	}
	if cfg.VoiceEnabled && checkin.DriftScore != nil {
		parts = append(parts, testData{float64(*checkin.DriftScore), cfg.VoiceWeight})
	}
	if cfg.TactileEnabled && len(checkin.TouchEvents) > 0 {
		total := 0
		for _, e := range checkin.TouchEvents {
			total += e.Misfires
		}
		parts = append(parts, testData{math.Min(float64(total)*10.0, 100.0), cfg.TactileWeight})
	}
	if cfg.PVTEnabled && checkin.PVTMetrics != nil {
		var pvtRisk float64
		if checkin.PVTMetrics.PVTScore != nil {
			pvtRisk = float64(100 - *checkin.PVTMetrics.PVTScore)
		} else {
			pvtRisk = math.Min(checkin.PVTMetrics.LatenciaPromedioMs/5.0, 100.0)
		}
		parts = append(parts, testData{pvtRisk, cfg.PVTWeight})
	}

	if len(parts) == 0 {
		return 0, model.RiskGreen
	}

	totalWeight := 0.0
	for _, p := range parts {
		totalWeight += p.configWeight
	}
	composite := 0.0
	for _, p := range parts {
		composite += (p.configWeight / totalWeight) * p.value
	}
	score = int(math.Round(composite))
	thresholds := cfg.RiskThresholds
	switch {
	case score <= thresholds.GreenMax:
		level = model.RiskGreen
	case score >= thresholds.RedMin:
		level = model.RiskRed
	default:
		level = model.RiskAmber
	}
	return score, level
}

// normalizeKSSLevel maps KSS 1–9 to a 0–100 risk scale.
func normalizeKSSLevel(kss int) float64 {
	return math.Min(math.Max(float64(kss-1)/8.0*100.0, 0), 100)
}

// GetWinners returns the persisted winners for a period + branch.
func (s *EmployeeOfMonthService) GetWinners(period time.Time, branchID string) ([]model.EmployeeOfMonthWinner, error) {
	return s.eomRepo.ListByPeriod(period, branchID)
}

// GetUserAwards returns all awards for a specific user.
func (s *EmployeeOfMonthService) GetUserAwards(userID string) ([]model.Award, error) {
	return s.eomRepo.ListByUser(userID)
}

// PreviousMonthStart returns the first moment of the previous calendar month in ART.
func PreviousMonthStart() time.Time {
	now := clock.Now().In(clock.LocalTZ)
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, clock.LocalTZ)
	return first.AddDate(0, -1, 0)
}
