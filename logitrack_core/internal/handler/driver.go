package handler

import (
	"encoding/json"
	"io"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"strings"
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

// silenceEnergyThreshold is the minimum average RMS energy a recording must
// have to be considered "voiced". Below this, the sample is treated as pure
// silence / background noise regardless of its VAD frame ratio — this is the
// explicit amplitude/energy gate requested to stop silent recordings from
// passing the voice test.
const silenceEnergyThreshold = 0.10

// silenceDetectedMsg is the user-facing message returned when a recording is
// analyzable (valid WebM) but contains no voice — distinct from INVALID_AUDIO,
// which signals a format/transport problem the server can't even analyze.
const silenceDetectedMsg = "Silencio detectado: no se registró voz en la grabación. Hablá con voz clara y fuerte para continuar con la prueba."

type DriverHandler struct {
	routeSvc         *service.RouteService
	branchRepo       repository.BranchRepository
	checkinRepo      *repository.CheckinRepository
	sleepRepo        *repository.SleepRepository
	routeStartRepo   *repository.RouteStartRepository
	historyRepo      *repository.HistoryAccessRequestRepository
	fatigueSvc       *service.FatigueConfigService
	auditRepo        *repository.AuditLogRepository
	notifSvc         *service.NotificationService
	fatigueBlockRepo repository.FatigueBlockRepository
}

func NewDriverHandler(
	routeSvc *service.RouteService,
	branchRepo repository.BranchRepository,
	fatigueSvc *service.FatigueConfigService,
	auditRepo *repository.AuditLogRepository,
	notifSvc *service.NotificationService,
	fatigueBlockRepo repository.FatigueBlockRepository,
) *DriverHandler {
	return &DriverHandler{
		routeSvc:         routeSvc,
		branchRepo:       branchRepo,
		checkinRepo:      repository.NewCheckinRepository(),
		sleepRepo:        repository.NewSleepRepository(),
		routeStartRepo:   repository.NewRouteStartRepository(),
		historyRepo:      repository.NewHistoryAccessRequestRepository(),
		fatigueSvc:       fatigueSvc,
		auditRepo:        auditRepo,
		notifSvc:         notifSvc,
		fatigueBlockRepo: fatigueBlockRepo,
	}
}

// checkAndNotifyFatigueRisk calcula el score de fatiga con los datos disponibles
// en el check-in y, si el nivel es ROJO:
//   - Notifica a los supervisores de la sucursal.
//   - Estampa CriticalAlertAt en el check-in del chofer para que el frontend
//     muestre el modal de alerta crítica (Ojo de Patrón emergente).
//
// Debe llamarse en una goroutine (fire-and-forget).
func (h *DriverHandler) checkAndNotifyFatigueRisk(user model.User, checkin model.DriverCheckin) {
	cfg := h.fatigueSvc.Get()
	score, level := fatigueRiskScore(checkin, cfg)
	if level != model.RiskRed {
		return
	}
	fullName := strings.TrimSpace(user.FirstName + " " + user.LastName)
	if fullName == "" {
		fullName = user.Username
	}
	if h.notifSvc != nil {
		h.notifSvc.NotifyFatigueAlert(user.BranchID, user.ID, user.Username, fullName, score, cfg.IsBlockRouteOnRed())
	}

	// Stamp the driver's own check-in so the polling endpoint can surface
	// the critical alert. Only set if not already alerting (i.e. driver
	// has not yet acknowledged a prior RED result on this check-in).
	today := todayAR()
	if rec, ok := h.checkinRepo.Get(user.ID, today); ok && rec.CriticalAlertAt == nil {
		now := time.Now()
		rec.CriticalAlertAt = &now
		rec.CriticalAlertScore = score
		_ = h.checkinRepo.Upsert(rec)
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

	// Build augmented shipment list that includes keyword_hash for offline validation.
	// SecurityKeywordHash is only exposed here (driver's own route), never in general shipment endpoints.
	type shipmentWithOfflineData struct {
		model.Shipment
		KeywordHash string `json:"keyword_hash,omitempty"`
	}
	shipmentsForDriver := make([]shipmentWithOfflineData, len(shipments))
	waypoints := make([]map[string]interface{}, 0, len(shipments))
	for i, shipment := range shipments {
		shipmentsForDriver[i] = shipmentWithOfflineData{
			Shipment:    shipment,
			KeywordHash: shipment.SecurityKeywordHash,
		}
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
		"shipments": shipmentsForDriver,
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

// logicalDateAR returns the YYYY-MM-DD date key for the current "logical day"
// given a daily reset hour (0–23, ART timezone). When resetHour = 0 the
// behaviour is identical to todayAR().
//
// Logic: if the current ART hour is < resetHour, the logical day started
// yesterday at resetHour, so we key on yesterday's calendar date.
func logicalDateAR(resetHour int) string {
	art := time.FixedZone("ART", -3*60*60)
	now := time.Now().In(art)
	if resetHour > 0 && now.Hour() < resetHour {
		return now.AddDate(0, 0, -1).Format("2006-01-02")
	}
	return now.Format("2006-01-02")
}

// skipGracePeriod is how long a "saltar" choice suppresses the fatigue gate.
const skipGracePeriod = 3 * time.Hour

// GetTodayCheckin returns the authenticated driver's check-in for today.
// Returns 404 (gate re-appears) when:
//   - no check-in has been recorded yet, OR
//   - an admin reset was triggered after the existing check-in, OR
//   - the driver had skipped and the 3-hour grace period has elapsed.
//
// requires_fatigue_test: true when routeStartRepo reports the driver has already
// claimed ≥ 1 vehicle since their last check-in. This counter lives in its own
// JSON file, independent of the check-in record, so it works even when no
// proper KSS check-in exists (e.g. early in the day, or skeleton records
// created by touch-event accumulation).
func (h *DriverHandler) GetTodayCheckin(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	cfg := h.fatigueSvc.Get()
	logicalDate := logicalDateAR(cfg.DailyResetHour)
	today := todayAR()

	requiresFatigueTest := h.routeStartRepo.Get(user.ID, today) > 0

	rec, ok := h.checkinRepo.Get(user.ID, today)
	if !ok {
		_, hasSleep := h.sleepRepo.Get(user.ID, logicalDate)
		c.JSON(http.StatusNotFound, gin.H{
			"error":                 "sin check-in para hoy",
			"requires_sleep_data":   !hasSleep,
			"requires_fatigue_test": requiresFatigueTest,
		})
		return
	}
	// Admin reset: invalidate any check-in recorded before the reset timestamp.
	if cfg.LastCheckinReset != nil && rec.RecordedAt.Before(*cfg.LastCheckinReset) {
		_, hasSleep := h.sleepRepo.Get(user.ID, logicalDate)
		c.JSON(http.StatusNotFound, gin.H{
			"error":                 "check-in requiere renovación",
			"requires_sleep_data":   !hasSleep,
			"requires_fatigue_test": requiresFatigueTest,
		})
		return
	}
	// Skipped grace period: after 3 h the gate re-appears.
	if rec.Skipped && time.Since(rec.RecordedAt) > skipGracePeriod {
		_, hasSleep := h.sleepRepo.Get(user.ID, logicalDate)
		c.JSON(http.StatusNotFound, gin.H{
			"error":                 "período de gracia de salto expirado",
			"requires_sleep_data":   !hasSleep,
			"requires_fatigue_test": requiresFatigueTest,
		})
		return
	}

	_, hasSleep := h.sleepRepo.Get(user.ID, logicalDate)
	c.JSON(http.StatusOK, gin.H{
		"ok":                    true,
		"checkin":               rec,
		"requires_sleep_data":   !hasSleep,
		"requires_fatigue_test": requiresFatigueTest,
	})
}

// MarkRouteStarted increments the route-start counter for today.
// Called by the frontend right after a successful vehicle claim (QR or plate),
// before navigating to the route page.
//
// The counter lives in routeStartRepo (data/route_starts.json), completely
// independent of the check-in record. This guarantees it works even when:
//   - the driver hasn't done a morning KSS check-in yet
//   - the check-in record is a skeleton created by touch-event accumulation
//   - AddShipmentToDriverRoute already reset the route record
func (h *DriverHandler) MarkRouteStarted(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	count, err := h.routeStartRepo.Increment(user.ID, todayAR())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar el inicio de ruta"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "routes_started_today": count})
}

// SkipCheckin records that the driver deliberately bypassed the fatigue gate.
// The gate will be suppressed for 3 hours; the skip appears in the driver's history.
func (h *DriverHandler) SkipCheckin(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	today := todayAR()

	// Preserve existing data; archive previous formal submission before overwriting.
	existing, _ := h.checkinRepo.Get(user.ID, today)
	if existing.KSSLevel > 0 || existing.Skipped {
		_ = h.checkinRepo.Archive(existing)
	}

	rec := model.DriverCheckin{
		DriverID:      user.ID,
		Date:          today,
		Skipped:       true,
		RecordedAt:    time.Now(),
		VoiceMetrics:  existing.VoiceMetrics,
		DriftScore:    existing.DriftScore,
		BaselineVoice: existing.BaselineVoice,
		TouchEvents:   existing.TouchEvents,
		PVTMetrics:    existing.PVTMetrics,
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

	// Reset the route-start counter so the gate doesn't re-fire on the
	// immediate next scan after a skip.
	_ = h.routeStartRepo.Reset(user.ID, today)

	c.JSON(http.StatusOK, gin.H{"ok": true, "checkin": rec})
}

// SubmitCheckin records (or overwrites) the KSS fatigue check-in for today.
//
// Sleep optimization: horas_sueno is only required the first time per logical
// day. Once a sleep record exists it is reused automatically — the driver is
// never asked twice. If no record exists and the payload omits horas_sueno,
// the endpoint responds with requires_sleep_data:true so the frontend can
// prompt the driver before retrying.
func (h *DriverHandler) SubmitCheckin(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	var body struct {
		HorasSueno *int     `json:"horas_sueno"`
		KSSLevel   int      `json:"kss_level"`
		Latitude   *float64 `json:"latitude"`
		Longitude  *float64 `json:"longitude"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido"})
		return
	}
	if body.KSSLevel < 1 || body.KSSLevel > 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kss_level debe estar entre 1 y 8"})
		return
	}
	if body.Latitude != nil && (*body.Latitude < -90 || *body.Latitude > 90) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "latitude debe estar entre -90 y 90"})
		return
	}
	if body.Longitude != nil && (*body.Longitude < -180 || *body.Longitude > 180) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "longitude debe estar entre -180 y 180"})
		return
	}

	cfg := h.fatigueSvc.Get()
	logicalDate := logicalDateAR(cfg.DailyResetHour)

	// ── Sleep optimization ────────────────────────────────────────────────────
	// Resolve horas_sueno for this check-in:
	//  1. If a sleep record already exists for today's logical day → reuse it.
	//  2. If the payload provides the value → persist it and use it.
	//  3. Otherwise → tell the frontend to collect the value first.
	var horasSueno int
	existing_sleep, hasSleep := h.sleepRepo.Get(user.ID, logicalDate)
	if hasSleep {
		horasSueno = existing_sleep.HorasSueno
	} else if body.HorasSueno != nil {
		v := *body.HorasSueno
		if v < 0 || v > 10 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "horas_sueno debe estar entre 0 y 10"})
			return
		}
		if err := h.sleepRepo.Upsert(user.ID, logicalDate, v); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar el registro de sueño"})
			return
		}
		horasSueno = v
	} else {
		c.JSON(http.StatusOK, gin.H{
			"ok":                  false,
			"requires_sleep_data": true,
		})
		return
	}

	today := todayAR()

	// Preserve existing data accumulated today (voice, touch events, PVT).
	existing, _ := h.checkinRepo.Get(user.ID, today)

	// Archive the previous formal submission before overwriting, so history
	// accumulates multiple check-ins per day when the gate fires more than once.
	if existing.KSSLevel > 0 || existing.Skipped {
		_ = h.checkinRepo.Archive(existing)
	}

	rec := model.DriverCheckin{
		DriverID:      user.ID,
		Date:          today,
		HorasSueno:    horasSueno,
		KSSLevel:      body.KSSLevel,
		RecordedAt:    time.Now(),
		Latitude:      body.Latitude,
		Longitude:     body.Longitude,
		VoiceMetrics:  existing.VoiceMetrics,
		DriftScore:    existing.DriftScore,
		BaselineVoice: existing.BaselineVoice,
		TouchEvents:   existing.TouchEvents,
		PVTMetrics:    existing.PVTMetrics,
	}
	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar el check-in"})
		return
	}

	// Alerta de fatiga — non-blocking. Evalúa el score con los datos disponibles
	// hasta este momento (KSS + voz si ya fue cargada) y notifica a supervisores
	// si el nivel cae en ROJO.
	go h.checkAndNotifyFatigueRisk(user, rec)

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

	// Reset the route-start counter: the driver just passed the gate so the
	// next scan should not show the gate again until another route is claimed.
	_ = h.routeStartRepo.Reset(user.ID, today)

	c.JSON(http.StatusOK, gin.H{"ok": true, "checkin": rec, "requires_sleep_data": false})
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
		GameErrors         int     `json:"game_errors"`
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
		GameErrors:         body.GameErrors,
		PVTScore:           computePVTScore(body.LatenciaPromedioMs, body.GameErrors),
		RecordedAt:         time.Now(),
	}

	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo guardar el resultado PVT"})
		return
	}

	// Alerta de fatiga — el PVT tiene peso 35%; recalcular con el dato nuevo.
	// La dedup de 1 h evita duplicar la alerta si ya fue enviada tras el KSS.
	go h.checkAndNotifyFatigueRisk(user, rec)

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

	// ── Nivel 0: tamaño mínimo ────────────────────────────────────────────────
	// Un WebM con silencio puro pesa solo unos cientos de bytes (cabeceras EBML
	// + frames CN comprimidos). Cualquier grabación real de voz supera 2 500 B.
	// Un archivo así de chico es, por definición, silencio puro — lo marcamos
	// con el error explícito de silencio (no INVALID_AUDIO genérico).
	const minAudioBytes = 2500
	if len(audioData) < minAudioBytes {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "SILENCE_DETECTED",
			"message": silenceDetectedMsg,
		})
		return
	}

	// ── Nivel 1: VAD por tamaño de frames WebM (EBML scanner) ─────────────────
	// Escanea los bloques SimpleBlock/Block del contenedor Matroska y compara el
	// tamaño del payload Opus de cada frame contra el umbral de voz activa.
	// Los frames CN (silencio Opus) pesan 1-3 bytes; los frames de voz ≥ 20 bytes.
	// En entornos muy ruidosos (cabina de camión, viento) el ruido puede inflar
	// los frames por encima del umbral → por eso existen también los niveles
	// siguientes, que validan la señal acústica medida (no solo el tamaño).
	voicedFraction, vadOk, vadErr := webmVAD(audioData, vadVoiceThreshold)
	if vadErr != nil {
		// Contenedor malformado / no reproducible — no es analizable.
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "INVALID_AUDIO",
			"message": vadInvalidMsg,
		})
		return
	}

	// Extract the 5 acoustic features from the raw audio bytes, derivadas de la
	// fracción de voz medida por el VAD (señal real, no puramente aleatoria).
	current := extractVoiceMetrics(audioData, voicedFraction)

	// ── Nivel 2: silencio explícito ───────────────────────────────────────────
	// El archivo es un WebM válido y analizable, pero no contiene voz humana:
	// el VAD no encontró fracción de voz suficiente, la energía promedio (RMS)
	// está por debajo del umbral de ruido de fondo, o el transcriptor no
	// detectó sílabas (speech_rate == 0). Cualquiera de estas señales — solas
	// o combinadas — indica silencio puro, no un problema de formato.
	if !vadOk || current.EnergyRMS < silenceEnergyThreshold || current.SpeechRate <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "SILENCE_DETECTED",
			"message": silenceDetectedMsg,
		})
		return
	}

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
		"ok":            true,
		"voice_metrics": current,
		"drift_score":   driftScore,
		"baseline":      rec.BaselineVoice,
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
// reproducible in tests without external dependencies. EnergyRMS and
// SpeechRate — the two features the silence gate inspects — are derived from
// `voicedFraction` (the VAD's *measured* voiced-frame ratio) rather than pure
// randomness, so genuine silence (fraction ≈ 0) reliably yields near-zero
// values and trips the explicit "Silencio detectado" check below. The
// remaining features stay randomly seeded — they aren't derivable from
// byte-level analysis with the current simulation.
func extractVoiceMetrics(audioData []byte, voicedFraction float64) model.VoiceMetrics {
	rng := rand.New(rand.NewSource(int64(len(audioData))))

	return model.VoiceMetrics{
		// pitch_mean: typical human speech range 85–255 Hz
		PitchMean: 120 + rng.Float64()*80,
		// pitch_range: variation within the sample
		PitchRange: 20 + rng.Float64()*60,
		// energy_rms: normalised 0–1 amplitude proxy, scaled by the measured
		// voiced fraction — silence (fraction ≈ 0) yields energy ≈ 0.
		EnergyRMS: voicedFraction * (0.5 + rng.Float64()*0.3),
		// speech_rate: syllables per second, scaled by the measured voiced
		// fraction — silence (fraction ≈ 0) yields a rate ≈ 0.
		SpeechRate: voicedFraction * (5 + rng.Float64()*2),
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

// GetTestEligibility evalúa si el chofer autenticado debe realizar las pruebas
// de fatiga. El comportamiento varía según el tipo de chofer y los parámetros:
//
//	?is_trip_start=true   — inicio de viaje inter-sucursal (siempre requiere test)
//	?stopped_minutes=N    — minutos detenido en ruta inter-sucursal (>= 6 requiere test)
//	?misfires=N           — última milla: misfires del paquete actual (enviado por el frontend)
//
// Choferes de última milla se evalúan por misfires del paquete actual y tiempo
// desde el último check-in formal (KSS completado o saltado). Si pasaron > 1 hora
// desde el check-in Y hay >= 5 misfires en el paquete, se requiere re-test.
// Choferes inter-sucursal se evalúan por tiempo detenido >= 6 min: se exige
// re-test si no hubo check-in ese día o el último fue hace más de 2 horas.
func (h *DriverHandler) GetTestEligibility(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	isTripStart := c.Query("is_trip_start") == "true"
	isCheckpoint := c.Query("checkpoint") == "true"
	stoppedMinutes := 0
	if raw := c.Query("stopped_minutes"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			stoppedMinutes = v
		}
	}

	switch user.DriverType {

	// ── Inter-sucursal ───────────────────────────────────────────────────────
	case model.DriverTypeInterBranch:
		if isTripStart {
			c.JSON(http.StatusOK, gin.H{"require_test": true, "reason": "trip_start"})
			return
		}
		if isCheckpoint {
			c.JSON(http.StatusOK, gin.H{"require_test": true, "reason": "checkpoint"})
			return
		}
		if stoppedMinutes >= 6 {
			// Forzar re-test si no hubo check-in hoy o el último fue hace más de 2 horas.
			rec, ok := h.checkinRepo.Get(user.ID, todayAR())
			if !ok || time.Since(rec.RecordedAt) > 2*time.Hour {
				c.JSON(http.StatusOK, gin.H{"require_test": true, "reason": "stopped_too_long"})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"require_test": false})

	// ── Última milla ─────────────────────────────────────────────────────────
	case model.DriverTypeLastMile:
		cfg := h.fatigueSvc.Get()
		rec, hasRec := h.checkinRepo.Get(user.ID, logicalDateAR(cfg.DailyResetHour))

		// Leer misfires del query param (enviado por el frontend antes de resetear)
		// o caer al último evento registrado en DB como fallback.
		latestMisfires := 0
		if raw := c.Query("misfires"); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil {
				latestMisfires = v
			}
		} else if hasRec {
			if n := len(rec.TouchEvents); n > 0 {
				latestMisfires = rec.TouchEvents[n-1].Misfires
			}
		}

		// Gate A: menos de 20 misfires → no hay problema táctil.
		if latestMisfires < 15 {
			c.JSON(http.StatusOK, gin.H{"require_test": false})
			return
		}

		// Gate B: 15+ misfires — exige re-test si no hay check-in formal ese día
		// o si el último fue hace más de 1 hora.
		hadFormalCheckin := hasRec && (rec.KSSLevel > 0 || rec.Skipped)
		if !hadFormalCheckin {
			c.JSON(http.StatusOK, gin.H{"require_test": true, "reason": "tactile_and_time"})
			return
		}
		if time.Since(rec.RecordedAt) > 1*time.Hour {
			c.JSON(http.StatusOK, gin.H{"require_test": true, "reason": "tactile_and_time"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"require_test": false})

	// ── Otros roles (fallback seguro) ────────────────────────────────────────
	default:
		c.JSON(http.StatusOK, gin.H{"require_test": false})
	}
}

// ResetMisfires pone a 0 el contador de misfires del último touch event del día.
// Se llama desde el frontend después de confirmar una entrega para que el próximo
// paquete arranque con slate limpio.
func (h *DriverHandler) ResetMisfires(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	today := todayAR()
	rec, ok := h.checkinRepo.Get(user.ID, today)
	if !ok || len(rec.TouchEvents) == 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	rec.TouchEvents[len(rec.TouchEvents)-1].Misfires = 0
	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo resetear los misfires"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// FastForwardCheckinTime resta 2h01m al RecordedAt del check-in de hoy para
// simular que pasaron más de 2 horas desde el último check-in. Solo para testing.
func (h *DriverHandler) FastForwardCheckinTime(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	today := todayAR()
	rec, ok := h.checkinRepo.Get(user.ID, today)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "sin check-in para hoy"})
		return
	}
	rec.RecordedAt = rec.RecordedAt.Add(-2*time.Hour - time.Minute)
	if err := h.checkinRepo.Upsert(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo modificar el tiempo"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "new_recorded_at": rec.RecordedAt})
}

// ── Historial personal de check-ins ──────────────────────────────────────────

// RequestHistory creates or resets a pending access request for the driver's
// personal check-in history. Returns 409 if a pending or approved request already
// exists. A previously rejected request can be re-submitted.
func (h *DriverHandler) RequestHistory(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	existing, ok := h.historyRepo.Get(user.ID, model.HistoryRequestTypeAccess)
	if ok {
		if existing.Status == model.HistoryRequestPending {
			c.JSON(http.StatusConflict, gin.H{"error": "ya tenés una solicitud pendiente de revisión"})
			return
		}
		if existing.Status == model.HistoryRequestApproved {
			c.JSON(http.StatusConflict, gin.H{"error": "ya tenés acceso aprobado a tu historial"})
			return
		}
	}

	req := model.HistoryAccessRequest{
		DriverID:    user.ID,
		Type:        model.HistoryRequestTypeAccess,
		Status:      model.HistoryRequestPending,
		RequestDate: time.Now(),
	}
	if err := h.historyRepo.Upsert(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar la solicitud"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "request": req})
}

// RequestHistoryDeletion creates a pending request to revoke / delete the
// driver's shared check-in history. Only valid once the driver's access
// request has been approved (Caso C) — otherwise there is nothing to revoke.
// Returns 409 if access isn't approved yet, or if a deletion request is
// already pending review.
func (h *DriverHandler) RequestHistoryDeletion(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	access, ok := h.historyRepo.Get(user.ID, model.HistoryRequestTypeAccess)
	if !ok || access.Status != model.HistoryRequestApproved {
		c.JSON(http.StatusConflict, gin.H{"error": "solo podés solicitar la eliminación de tu historial si tu acceso compartido está aprobado"})
		return
	}

	existing, ok := h.historyRepo.Get(user.ID, model.HistoryRequestTypeDeletion)
	if ok && existing.Status == model.HistoryRequestPending {
		c.JSON(http.StatusConflict, gin.H{"error": "ya tenés una solicitud de eliminación pendiente de revisión"})
		return
	}

	req := model.HistoryAccessRequest{
		DriverID:    user.ID,
		Type:        model.HistoryRequestTypeDeletion,
		Status:      model.HistoryRequestPending,
		RequestDate: time.Now(),
	}
	if err := h.historyRepo.Upsert(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar la solicitud"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "request": req})
}

// GetPersonalHistory returns the driver's full check-in history.
// Returns 403 unless the supervisor has approved the access request. Both the
// 403 and 200 bodies include the flat `request_status` string and
// `deletion_request` so the frontend can resolve all four privacy states
// (Caso A/B/C/D) from `request_status`/`deletion_request.status` alone,
// regardless of which HTTP status the call returned.
func (h *DriverHandler) GetPersonalHistory(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	req, ok := h.historyRepo.Get(user.ID, model.HistoryRequestTypeAccess)
	deletionReq, deletionOk := h.historyRepo.Get(user.ID, model.HistoryRequestTypeDeletion)
	var deletionPayload interface{}
	if deletionOk {
		deletionPayload = deletionReq
	}

	if !ok || req.Status != model.HistoryRequestApproved {
		status := "sin_solicitud"
		if ok {
			status = string(req.Status)
		}
		c.JSON(http.StatusForbidden, gin.H{
			"error":            "acceso no autorizado — solicitá permiso a tu supervisor",
			"request_status":   status,
			"deletion_request": deletionPayload,
		})
		return
	}

	all := h.checkinRepo.AllForDriver(user.ID)
	// Sort newest first — same order as the supervisor dashboard.
	sort.Slice(all, func(i, j int) bool { return all[i].Date > all[j].Date })
	if all == nil {
		all = []model.DriverCheckin{}
	}

	c.JSON(http.StatusOK, gin.H{
		"history":          all,
		"total":            len(all),
		"request":          req,
		"request_status":   string(req.Status),
		"deletion_request": deletionPayload,
	})
}

// computePVTScore converts raw PVT metrics into a composite quality score
// (0–100, higher = better performance):
//
//   - Base:            100 points.
//   - Latency penalty: -10 pts per 100 ms above the 350 ms ideal (clamped to 0).
//   - Error penalty:   -15 pts per game error (erroneous click or missed stimulus).
//
// The score is clamped to [0, 100] and returned as a pointer so callers can
// distinguish "not yet computed" (nil) from a genuine score of 0.
func computePVTScore(latenciaMs float64, gameErrors int) *int {
	const (
		idealMs       = 350.0
		msPerBlock    = 100.0
		latPenaltyPer = 10
		errPenalty    = 15
	)
	score := 100
	if latenciaMs > idealMs {
		blocks := math.Round((latenciaMs - idealMs) / msPerBlock)
		score -= int(blocks) * latPenaltyPer
	}
	score -= gameErrors * errPenalty
	if score < 0 {
		score = 0
	}
	return &score
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

// GetFatigueBlockStatus returns whether the authenticated driver has an active
// fatigue block. The frontend polls this endpoint every 5 s and shows a
// full-screen overlay when blocked (LOGITRACK-499).
func (h *DriverHandler) GetFatigueBlockStatus(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	if h.fatigueBlockRepo == nil {
		c.JSON(http.StatusOK, gin.H{"blocked": false})
		return
	}
	block, err := h.fatigueBlockRepo.GetActive(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al verificar estado de bloqueo"})
		return
	}
	if block != nil {
		c.JSON(http.StatusOK, gin.H{"blocked": true})
		return
	}
	recent, err := h.fatigueBlockRepo.GetRecentlyUnblocked(user.ID)
	if err != nil || recent == nil {
		c.JSON(http.StatusOK, gin.H{"blocked": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"blocked":            false,
		"recently_unblocked": true,
		"unblocked_by":       recent.UnblockedBy,
		"unblocked_at":       recent.UnblockedAt,
	})
}
