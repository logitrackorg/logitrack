package handler

import (
	"encoding/json"
	"io"
	"math"
	"math/rand"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

// controlPhrase is the fixed sentence drivers must read aloud.
// The driver's first name is injected at runtime by GetControlPhrase.
const controlPhraseTemplate = "Hoy es un buen día para trabajar con seguridad, %s."

type DriverHandler struct {
	routeSvc    *service.RouteService
	branchRepo  repository.BranchRepository
	checkinRepo *repository.CheckinRepository
	fatigueSvc  *service.FatigueConfigService
	auditRepo   *repository.AuditLogRepository
}

func NewDriverHandler(
	routeSvc *service.RouteService,
	branchRepo repository.BranchRepository,
	fatigueSvc *service.FatigueConfigService,
	auditRepo *repository.AuditLogRepository,
) *DriverHandler {
	return &DriverHandler{
		routeSvc:    routeSvc,
		branchRepo:  branchRepo,
		checkinRepo: repository.NewCheckinRepository(),
		fatigueSvc:  fatigueSvc,
		auditRepo:   auditRepo,
	}
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GetRoute returns today's assigned route and shipments for the authenticated driver.
func (h *DriverHandler) GetRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, shipments, err := h.routeSvc.GetTodayRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no tenés una ruta asignada para hoy"})
		return
	}

	waypoints := make([]map[string]interface{}, 0, len(shipments))
	for i, shipment := range shipments {
		waypoints = append(waypoints, map[string]interface{}{
			"sequence":    i + 1,
			"tracking_id": shipment.TrackingID,
			"latitude":    shipment.Recipient.Address.Latitude,
			"longitude":   shipment.Recipient.Address.Longitude,
			"name":        shipment.Recipient.Name,
			"address":     shipment.Recipient.Address.Street + ", " + shipment.Recipient.Address.City,
			"status":      shipment.Status,
		})
	}

	var origin map[string]interface{}
	if branch, ok := h.branchRepo.GetByID(user.BranchID); ok {
		lat, lng := branch.Latitude, branch.Longitude
		if lat == nil {
			lat = branch.Address.Latitude
		}
		if lng == nil {
			lng = branch.Address.Longitude
		}
		if lat != nil && lng != nil {
			origin = map[string]interface{}{
				"latitude":  *lat,
				"longitude": *lng,
				"name":      branch.Name,
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"route":     route,
		"shipments": shipments,
		"waypoints": waypoints,
		"origin":    origin,
	})
}

// StartRoute transitions the driver's today route from pendiente → en_curso.
func (h *DriverHandler) StartRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, err := h.routeSvc.StartRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": route})
}

// ── US1: KSS check-in ─────────────────────────────────────────────────────────

// todayAR returns the current date in Argentina Standard Time (ART = UTC-3).
// Docker containers run in UTC; using a fixed-offset zone avoids depending on
// tzdata being installed in the image.
func todayAR() string {
	return time.Now().In(time.FixedZone("ART", -3*60*60)).Format("2006-01-02")
}

// skipGracePeriod is how long a "saltar" choice suppresses the fatigue gate.
const skipGracePeriod = 3 * time.Hour

// GetTodayCheckin returns the authenticated driver's check-in for today.
// Returns 404 (gate re-appears) when:
//   - no check-in has been recorded yet, OR
//   - an admin reset was triggered after the existing check-in, OR
//   - the driver had skipped and the 3-hour grace period has elapsed.
func (h *DriverHandler) GetTodayCheckin(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	rec, ok := h.checkinRepo.Get(user.ID, todayAR())
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "sin check-in para hoy"})
		return
	}
	// Admin reset: invalidate any check-in recorded before the reset timestamp.
	if cfg := h.fatigueSvc.Get(); cfg.LastCheckinReset != nil && rec.RecordedAt.Before(*cfg.LastCheckinReset) {
		c.JSON(http.StatusNotFound, gin.H{"error": "check-in requiere renovación"})
		return
	}
	// Skipped grace period: after 3 h the gate re-appears so the driver is
	// prompted again — without deleting the skip record from history.
	if rec.Skipped && time.Since(rec.RecordedAt) > skipGracePeriod {
		c.JSON(http.StatusNotFound, gin.H{"error": "período de gracia de salto expirado"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "checkin": rec})
}

// SkipCheckin records that the driver deliberately bypassed the fatigue gate.
// The gate will be suppressed for 3 hours; the skip appears in the driver's history.
func (h *DriverHandler) SkipCheckin(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	today := todayAR()

	// Preserve any previously stored baseline voice data so it isn't wiped by a skip.
	existing, _ := h.checkinRepo.Get(user.ID, today)

	rec := model.DriverCheckin{
		DriverID:      user.ID,
		Date:          today,
		Skipped:       true,
		RecordedAt:    time.Now(),
		VoiceMetrics:  existing.VoiceMetrics,
		DriftScore:    existing.DriftScore,
		BaselineVoice: existing.BaselineVoice,
	}
	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar el salto"})
		return
	}

	// Audit — non-blocking (AC1).
	if detailsJSON, merr := json.Marshal(struct {
		DriverID string `json:"driver_id"`
		Date     string `json:"date"`
		Skipped  bool   `json:"skipped"`
	}{rec.DriverID, rec.Date, true}); merr == nil {
		_ = h.auditRepo.Append(model.AuditLog{
			ID:        model.NewAuditID(),
			CreatedAt: time.Now(),
			CreatedBy: user.Username,
			Action:    "SKIP_CHECKIN",
			Details:   json.RawMessage(detailsJSON),
		})
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "checkin": rec})
}

// SubmitCheckin records (or overwrites) the KSS fatigue check-in for today.
func (h *DriverHandler) SubmitCheckin(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	var body struct {
		HorasSueno int `json:"horas_sueno"`
		KSSLevel   int `json:"kss_level"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido"})
		return
	}
	if body.HorasSueno < 0 || body.HorasSueno > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "horas_sueno debe estar entre 0 y 10"})
		return
	}
	if body.KSSLevel < 1 || body.KSSLevel > 9 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kss_level debe estar entre 1 y 9"})
		return
	}

	today := todayAR()

	// Preserve existing voice data if the driver already uploaded audio today.
	existing, _ := h.checkinRepo.Get(user.ID, today)

	rec := model.DriverCheckin{
		DriverID:      user.ID,
		Date:          today,
		HorasSueno:    body.HorasSueno,
		KSSLevel:      body.KSSLevel,
		RecordedAt:    time.Now(),
		VoiceMetrics:  existing.VoiceMetrics,
		DriftScore:    existing.DriftScore,
		BaselineVoice: existing.BaselineVoice,
	}
	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar el check-in"})
		return
	}

	// Audit — non-blocking (AC1).
	if detailsJSON, merr := json.Marshal(struct {
		DriverID   string `json:"driver_id"`
		Date       string `json:"date"`
		KSSLevel   int    `json:"kss_level"`
		HorasSueno int    `json:"horas_sueno"`
	}{rec.DriverID, rec.Date, rec.KSSLevel, rec.HorasSueno}); merr == nil {
		_ = h.auditRepo.Append(model.AuditLog{
			ID:        model.NewAuditID(),
			CreatedAt: time.Now(),
			CreatedBy: user.Username,
			Action:    "SUBMIT_CHECKIN",
			Details:   json.RawMessage(detailsJSON),
		})
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "checkin": rec})
}

// ── US4: Tactile event capture ────────────────────────────────────────────────

// SubmitTouchEvent records a delivery interaction event (reaction time +
// misfire count) captured in the driver's delivery management view.
// Called asynchronously by the frontend — the UI does NOT wait for this response.
func (h *DriverHandler) SubmitTouchEvent(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	var body struct {
		TrackingID     string `json:"tracking_id"`
		Action         string `json:"action"`
		ReactionTimeMs int64  `json:"reaction_time_ms"`
		Misfires       int    `json:"misfires"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido"})
		return
	}

	today := todayAR()
	rec, _ := h.checkinRepo.Get(user.ID, today)
	rec.DriverID = user.ID
	rec.Date = today
	if rec.RecordedAt.IsZero() {
		rec.RecordedAt = time.Now()
	}
	rec.TouchEvents = append(rec.TouchEvents, model.TouchEventRecord{
		TrackingID:     body.TrackingID,
		Action:         body.Action,
		ReactionTimeMs: body.ReactionTimeMs,
		Misfires:       body.Misfires,
		RecordedAt:     time.Now(),
	})

	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar el evento"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── US6: PVT (Psychomotor Vigilance Task) ─────────────────────────────────────

// SubmitPVT receives the reaction-time mini-game results and persists them in
// the driver's daily check-in record. The endpoint is optional — drivers may
// skip the PVT entirely (AC1).
func (h *DriverHandler) SubmitPVT(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	var body struct {
		LatenciaPromedioMs float64 `json:"latencia_promedio_ms"`
		Aciertos           int     `json:"aciertos"`
		Errores            int     `json:"errores"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido"})
		return
	}

	today := todayAR()
	rec, _ := h.checkinRepo.Get(user.ID, today)
	rec.DriverID = user.ID
	rec.Date = today
	if rec.RecordedAt.IsZero() {
		rec.RecordedAt = time.Now()
	}
	rec.PVTMetrics = &model.PVTResult{
		LatenciaPromedioMs: body.LatenciaPromedioMs,
		Aciertos:           body.Aciertos,
		Errores:            body.Errores,
		RecordedAt:         time.Now(),
	}

	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar el resultado PVT"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "pvt": rec.PVTMetrics})
}

// ── US2: Voice check-in ───────────────────────────────────────────────────────

// GetControlPhrase returns the personalised phrase the driver must read aloud.
func (h *DriverHandler) GetControlPhrase(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	name := user.FirstName
	if name == "" {
		name = user.Username
	}
	phrase := "Hoy es un buen día para trabajar con seguridad, " + name + "."
	_ = controlPhraseTemplate // kept for reference
	c.JSON(http.StatusOK, gin.H{"phrase": phrase})
}

// UploadVoice receives a multipart audio file, extracts voice metrics, computes
// the drift score against the driver's baseline, and persists the result.
func (h *DriverHandler) UploadVoice(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	file, _, err := c.Request.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "se requiere el campo 'audio' en el form-data"})
		return
	}
	defer file.Close()

	audioData, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo leer el archivo de audio"})
		return
	}
	if len(audioData) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "el archivo de audio está vacío"})
		return
	}

	// Extract the 5 acoustic features from the raw audio bytes.
	current := extractVoiceMetrics(audioData)

	today := todayAR()

	// Load today's check-in (may or may not exist yet).
	rec, _ := h.checkinRepo.Get(user.ID, today)
	rec.DriverID = user.ID
	rec.Date = today
	if rec.RecordedAt.IsZero() {
		rec.RecordedAt = time.Now()
	}
	rec.VoiceMetrics = &current

	// Compute drift score if a baseline exists; otherwise this is the first sample.
	var driftScore *int
	if rec.BaselineVoice != nil {
		score := computeDriftScore(current, *rec.BaselineVoice)
		driftScore = &score
	}
	rec.DriftScore = driftScore

	// Update the running baseline with the new sample.
	rec.BaselineVoice = updateBaseline(rec.BaselineVoice, current)

	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar el análisis de voz"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":           true,
		"voice_metrics": current,
		"drift_score":  driftScore,
		"baseline":     rec.BaselineVoice,
	})
}

// ── Acoustic engine ───────────────────────────────────────────────────────────

// extractVoiceMetrics derives the 5 acoustic features from raw audio bytes.
//
// Production path: replace the body of this function with calls to a real DSP
// library (e.g. go-aubio bindings, a Python sidecar via gRPC, or a cloud
// Speech API). The function signature and return type must not change.
//
// Simulation path (current): uses the audio length as a deterministic seed so
// that the same file always produces the same metrics, making the output
// reproducible in tests without external dependencies.
func extractVoiceMetrics(audioData []byte) model.VoiceMetrics {
	rng := rand.New(rand.NewSource(int64(len(audioData))))

	return model.VoiceMetrics{
		// pitch_mean: typical human speech range 85–255 Hz
		PitchMean: 120 + rng.Float64()*80,
		// pitch_range: variation within the sample
		PitchRange: 20 + rng.Float64()*60,
		// energy_rms: normalised 0–1 amplitude proxy
		EnergyRMS: 0.3 + rng.Float64()*0.4,
		// speech_rate: syllables per second (normal: 3–6)
		SpeechRate: 3 + rng.Float64()*3,
		// pause_ratio: fraction of silence (normal: 0.1–0.4)
		PauseRatio: 0.1 + rng.Float64()*0.3,
	}
}

// computeDriftScore calculates a weighted deviation score (0–100) between the
// current voice metrics and the driver's historical baseline.
//
// For each metric the absolute percentage deviation is clamped to [0, 1] and
// then multiplied by its weight:
//
//	pitch_mean  → 30 %  (0.30)  — most sensitive fatigue indicator
//	pitch_range → 20 %  (0.20)  — monotone speech signals drowsiness
//	energy_rms  → 20 %  (0.20)  — lower energy correlates with fatigue
//	speech_rate → 15 %  (0.15)  — slowed speech is a fatigue marker
//	pause_ratio → 15 %  (0.15)  — longer pauses indicate cognitive load
//
// The weighted sum is scaled to [0, 100] and rounded to the nearest integer.
// Returns 0 when the baseline is uninitialised (all zeros) to avoid division
// by zero.
func computeDriftScore(current, baseline model.VoiceMetrics) int {
	type metric struct {
		cur, base, weight float64
	}
	metrics := []metric{
		{current.PitchMean, baseline.PitchMean, 0.30},   // pitch_mean:  30%
		{current.PitchRange, baseline.PitchRange, 0.20}, // pitch_range: 20%
		{current.EnergyRMS, baseline.EnergyRMS, 0.20},   // energy_rms:  20%
		{current.SpeechRate, baseline.SpeechRate, 0.15}, // speech_rate: 15%
		{current.PauseRatio, baseline.PauseRatio, 0.15}, // pause_ratio: 15%
	}

	var weightedSum float64
	for _, m := range metrics {
		if m.base == 0 {
			// Skip this metric to avoid division by zero; treat deviation as 0.
			continue
		}
		// Absolute percentage deviation, clamped to [0, 1] (i.e. max 100% drift).
		deviation := math.Abs(m.cur-m.base) / m.base
		if deviation > 1 {
			deviation = 1
		}
		weightedSum += deviation * m.weight
	}

	// Scale to 0–100 and round.
	score := int(math.Round(weightedSum * 100))
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

// updateBaseline computes a simple running average between the existing baseline
// and the new sample. On the first call (baseline == nil) the new sample becomes
// the baseline directly.
func updateBaseline(baseline *model.VoiceMetrics, current model.VoiceMetrics) *model.VoiceMetrics {
	if baseline == nil {
		// First voice sample — use it as the initial baseline.
		b := current
		return &b
	}
	// Exponential moving average with α = 0.2 so the baseline evolves slowly.
	const alpha = 0.2
	updated := model.VoiceMetrics{
		PitchMean:  baseline.PitchMean*(1-alpha) + current.PitchMean*alpha,
		PitchRange: baseline.PitchRange*(1-alpha) + current.PitchRange*alpha,
		EnergyRMS:  baseline.EnergyRMS*(1-alpha) + current.EnergyRMS*alpha,
		SpeechRate: baseline.SpeechRate*(1-alpha) + current.SpeechRate*alpha,
		PauseRatio: baseline.PauseRatio*(1-alpha) + current.PauseRatio*alpha,
	}
	return &updated
}
