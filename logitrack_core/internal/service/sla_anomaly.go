package service

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// debugCacheTTL is used when SLA_DEBUG=true to avoid long waits between test runs.
const debugCacheTTL = 10 * time.Second

// fallbackAvgHours is the synthetic average for states with no historical data.
const fallbackAvgHours = 24.0

// sanitizeState normalises a status string for tolerant comparison.
func sanitizeState(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// excludedStatuses mirrors the SQL NOT IN clause as a belt-and-suspenders guard.
var excludedStatuses = map[string]bool{
	"delivered":       true,
	"returned":        true,
	"cancelled":       true,
	"lost":            true,
	"destroyed":       true,
	"draft":           true,
	"pending_payment": true,
	"expired":         true,
}

var priorityOrder = []string{"baja", "media", "alta"}

func nextPriorityBelowCeiling(current, ceiling string) (string, bool) {
	cIdx := indexOfStr(priorityOrder, ceiling)
	cUrr := indexOfStr(priorityOrder, current)
	if cIdx < 0 || cUrr < 0 {
		return "", false
	}
	next := cUrr + 1
	if next >= len(priorityOrder) || next > cIdx {
		return "", false
	}
	return priorityOrder[next], true
}

func indexOfStr(slice []string, val string) int {
	for i, v := range slice {
		if v == val {
			return i
		}
	}
	return -1
}

var anomalyStatusNames = map[string]string{
	"at_origin_hub":        "En sucursal de origen",
	"at_hub":               "En sucursal",
	"loaded":               "Cargado en vehículo",
	"in_transit":           "En tránsito",
	"out_for_delivery":     "Última milla",
	"delivery_failed":      "Entrega fallida",
	"redelivery_scheduled": "Reentrega agendada",
	"no_entregado":         "No entregado",
	"rechazado":            "Rechazado por destinatario",
	"ready_for_pickup":     "Listo para retiro en sucursal",
	"ready_for_return":     "Listo para devolución",
	"draft":                "Borrador",
	"pending_payment":      "Pago pendiente",
	"recipient_not_found":  "Destinatario no encontrado",
	"expired":              "Expirado",
}

func anomalyStatusDisplayName(code string) string {
	if name, ok := anomalyStatusNames[code]; ok {
		return name
	}
	return code
}

func escalatedScore(current float64, newPriority string) float64 {
	var floor float64
	switch newPriority {
	case "alta":
		floor = 0.75
	case "media":
		floor = 0.45
	default:
		return current
	}
	return math.Max(current, floor)
}

// ─────────────────────────────────────────────────────────────────────────────
// SLAAnomalyService
//
// Arquitectura de dos procesos:
//
//   PROCESO A — Collector (RunCheck, llamado por el clock handler cada tick)
//     Recalcula los promedios históricos desde la DB y los acumula en un
//     buffer diario (`dailyAvgBuffer`). NO escala prioridades.
//
//   PROCESO B — Executor (RunCheck también lo dispara, pero se auto-comprueba)
//     Una vez por día, cuando la hora local coincide con `EscalationTime`,
//     calcula el promedio final como la media del buffer, evalúa todos los
//     envíos activos y ejecuta los saltos de prioridad. Luego limpia el buffer.
// ─────────────────────────────────────────────────────────────────────────────

type SLAAnomalyService struct {
	db           *sql.DB
	logRepo      *repository.PriorityLogRepository
	settingsRepo *repository.SLASettingsRepository
	debugMode    bool

	// ── Collector state ──────────────────────────────────────────────────────
	collectMu  sync.Mutex // serialises RunCheck calls
	collecting bool

	// Single-sample cache: refreshed every CacheIntervalMinutes by the Collector.
	cacheMu    sync.RWMutex
	avgByState map[string]float64
	cacheBuilt time.Time

	// Daily buffer of average snapshots. Each Collector run appends the current
	// per-state averages. Guarded by bufferMu.
	bufferMu        sync.Mutex
	dailyAvgBuffer  []map[string]float64 // each element = one snapshot
	bufferDay       string               // "YYYY-MM-DD" of the current buffer day

	// lastCalculatedAt records when the Collector last successfully refreshed
	// the per-status averages. Exposed via GetLastCalculatedAt() for the UI.
	// Protected by cacheMu (same lock as avgByState).
	lastCalculatedAt time.Time

	// calcStatus and lastDuration are telemetry fields updated by collect().
	// Protected by cacheMu so reads and writes are race-free even when the
	// endpoint is polled at the same millisecond as a collection cycle.
	//
	// calcStatus values: "sin medicion" | "en proceso" | "completado"
	// lastDuration is a human-readable string, e.g. "12ms" or "2.3s".
	calcStatus   string
	lastDuration string

	// ── Executor state ───────────────────────────────────────────────────────
	executorMu      sync.Mutex
	lastEscalatedAt time.Time // prevents multiple escalations in the same minute
}

func NewSLAAnomalyService(
	db *sql.DB,
	logRepo *repository.PriorityLogRepository,
	settingsRepo *repository.SLASettingsRepository,
) *SLAAnomalyService {
	debug := strings.EqualFold(strings.TrimSpace(os.Getenv("SLA_DEBUG")), "true")
	if debug {
		log.Printf("[SLA][debug] SLA_DEBUG activo — TTL de caché reducido a %s", debugCacheTTL)
	}
	return &SLAAnomalyService{
		db:           db,
		logRepo:      logRepo,
		settingsRepo: settingsRepo,
		debugMode:    debug,
		calcStatus:   "sin medicion",
	}
}

// GetLastCalculatedAt returns the raw timestamp or nil (kept for internal use).
func (s *SLAAnomalyService) GetLastCalculatedAt() *time.Time {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	if s.lastCalculatedAt.IsZero() {
		return nil
	}
	t := s.lastCalculatedAt
	return &t
}

// GetLastCalculatedAtFormatted returns a pre-formatted Argentina-time string
// (e.g. "14/06/2026, 23:05:12") so the frontend can display it verbatim
// without any timezone conversion. Returns "" when no calculation has run.
// Uses the server's clock (honours time-travel advances) rather than real time.
func (s *SLAAnomalyService) GetLastCalculatedAtFormatted() string {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	if s.lastCalculatedAt.IsZero() {
		return ""
	}
	art := time.FixedZone("ART", -3*60*60)
	return s.lastCalculatedAt.In(art).Format("02/01/2006, 15:04:05")
}

// GetCurrentAverages returns a copy of the most recently computed per-status
// dwell-time averages (hours). Returns nil when no calculation has run yet.
func (s *SLAAnomalyService) GetCurrentAverages() map[string]float64 {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	if len(s.avgByState) == 0 {
		return nil
	}
	out := make(map[string]float64, len(s.avgByState))
	for k, v := range s.avgByState {
		out[k] = v
	}
	return out
}

// GetCalculationStatus returns the current collector state:
// "sin medicion", "en proceso", or "completado".
func (s *SLAAnomalyService) GetCalculationStatus() string {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	if s.calcStatus == "" {
		return "sin medicion"
	}
	return s.calcStatus
}

// GetLastCalculationDuration returns a human-readable string of how long the
// last collector cycle took (e.g. "12ms", "2.3s"). Empty string if not run yet.
func (s *SLAAnomalyService) GetLastCalculationDuration() string {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	return s.lastDuration
}

// RunCheck is the entry point called by the clock handler on every tick.
//
// Behaviour depends on CalculationMode (read from settings each tick so
// admin changes take effect without a restart):
//
//   - "periodic" (default): Collector runs asynchronously on every tick,
//     independent of the Executor. The Executor fires separately when the
//     wall-clock matches EscalationTime.
//
//   - "daily": Collector does NOT run on periodic ticks. When EscalationTime
//     arrives, the Collector runs synchronously first (so the consolidated
//     averages are fresh), then the Executor processes the escalations.
func (s *SLAAnomalyService) RunCheck() {
	cfg := s.settingsRepo.Get()
	mode := cfg.CalculationMode
	if mode == "" {
		mode = "periodic"
	}

	switch mode {
	case "daily":
		// In daily mode the Collector only runs at EscalationTime, immediately
		// before the Executor, sharing the same tick detection.
		if s.shouldEscalateNow(cfg.EscalationTime) {
			go func() {
				// Collect first (synchronous within this goroutine so averages
				// are ready before execute starts).
				if err := s.collect(); err != nil {
					log.Printf("[SLAAnomalyService] daily collector error: %v", err)
				}
				if err := s.execute(cfg); err != nil {
					log.Printf("[SLAAnomalyService] executor error: %v", err)
				}
			}()
		}

	default: // "periodic"
		// Collector runs asynchronously on every tick (non-blocking).
		s.collectMu.Lock()
		if !s.collecting {
			s.collecting = true
			s.collectMu.Unlock()
			go func() {
				defer func() {
					s.collectMu.Lock()
					s.collecting = false
					s.collectMu.Unlock()
				}()
				if err := s.collect(); err != nil {
					log.Printf("[SLAAnomalyService] collector error: %v", err)
				}
			}()
		} else {
			s.collectMu.Unlock()
		}

		// Executor fires separately when EscalationTime matches.
		if s.shouldEscalateNow(cfg.EscalationTime) {
			go func() {
				if err := s.execute(cfg); err != nil {
					log.Printf("[SLAAnomalyService] executor error: %v", err)
				}
			}()
		}
	}
}

// shouldEscalateNow returns true when the current Argentina wall-clock minute
// matches EscalationTime and the Executor has not already fired this minute.
func (s *SLAAnomalyService) shouldEscalateNow(escalationTime string) bool {
	if escalationTime == "" {
		escalationTime = "23:00"
	}

	art := time.FixedZone("ART", -3*60*60)
	now := clock.Now().In(art)
	currentHHMM := now.Format("15:04")
	if currentHHMM != escalationTime {
		return false
	}

	s.executorMu.Lock()
	defer s.executorMu.Unlock()
	// Fire at most once per calendar minute.
	if now.Truncate(time.Minute).Equal(s.lastEscalatedAt.Truncate(time.Minute)) {
		return false
	}
	s.lastEscalatedAt = now
	return true
}

// ─── Collector ────────────────────────────────────────────────────────────────

// collect refreshes the per-status average from the DB (respecting the cache
// TTL) and appends a snapshot to the daily buffer.
func (s *SLAAnomalyService) collect() error {
	// ── Telemetry: mark "en proceso" and capture start time ──────────────────
	start := time.Now()
	s.cacheMu.Lock()
	s.calcStatus = "en proceso"
	s.cacheMu.Unlock()

	cfg := s.settingsRepo.Get()
	cacheTTL := time.Duration(cfg.CacheIntervalMinutes) * time.Minute
	if s.debugMode {
		cacheTTL = debugCacheTTL
	}

	snap, err := s.refreshAverages(cacheTTL)
	if err != nil {
		// Even on error, restore status so the UI doesn't stay stuck on "en proceso".
		s.cacheMu.Lock()
		s.calcStatus = "sin medicion"
		s.cacheMu.Unlock()
		return fmt.Errorf("refreshing averages: %w", err)
	}
	if len(snap) == 0 {
		s.cacheMu.Lock()
		s.calcStatus = "sin medicion"
		s.cacheMu.Unlock()
		return nil // no history yet
	}

	// ── Telemetry: mark "completado", record timestamp and duration ───────────
	elapsed := time.Since(start)
	var durStr string
	if elapsed < time.Second {
		durStr = fmt.Sprintf("%dms", elapsed.Milliseconds())
	} else {
		durStr = fmt.Sprintf("%.2fs", elapsed.Seconds())
	}

	// Use clock.Now() (not time.Now()) so the timestamp respects any admin
	// time-travel override and is consistent with the frontend simulation.
	s.cacheMu.Lock()
	s.lastCalculatedAt = clock.Now()
	s.calcStatus = "completado"
	s.lastDuration = durStr
	s.cacheMu.Unlock()

	art := time.FixedZone("ART", -3*60*60)
	today := clock.Now().In(art).Format("2006-01-02")

	s.bufferMu.Lock()
	defer s.bufferMu.Unlock()

	// Reset buffer when the calendar day changes.
	if s.bufferDay != today {
		s.dailyAvgBuffer = nil
		s.bufferDay = today
	}
	s.dailyAvgBuffer = append(s.dailyAvgBuffer, snap)

	log.Printf("[SLAAnomalyService] collector: snapshot appended (buffer size: %d, day: %s)",
		len(s.dailyAvgBuffer), today)
	return nil
}

// refreshAverages queries the DB for per-status dwell-time averages, honouring
// the cache TTL, and returns a fresh snapshot (also stored in the cache).
func (s *SLAAnomalyService) refreshAverages(cacheTTL time.Duration) (map[string]float64, error) {
	s.cacheMu.RLock()
	if time.Since(s.cacheBuilt) < cacheTTL && len(s.avgByState) > 0 {
		out := make(map[string]float64, len(s.avgByState))
		for k, v := range s.avgByState {
			out[k] = v
		}
		s.cacheMu.RUnlock()
		return out, nil
	}
	s.cacheMu.RUnlock()

	rows, err := s.db.Query(`
		WITH ordered AS (
			SELECT
				e.payload->>'FromStatus'                                            AS from_status,
				e.timestamp,
				LEAD(e.timestamp) OVER (
					PARTITION BY e.tracking_id ORDER BY e.timestamp ASC
				)                                                                   AS next_ts
			FROM events e
			WHERE e.event_type = 'status_changed'
		)
		SELECT
			from_status,
			COALESCE(AVG(EXTRACT(EPOCH FROM (next_ts - timestamp)) / 3600), 0)    AS avg_hours
		FROM ordered
		WHERE next_ts IS NOT NULL
		  AND from_status != ''
		GROUP BY from_status`)
	if err != nil {
		return nil, fmt.Errorf("avg query: %w", err)
	}
	defer rows.Close()

	fresh := make(map[string]float64)
	for rows.Next() {
		var status string
		var avgH float64
		if err := rows.Scan(&status, &avgH); err != nil {
			return nil, err
		}
		if avgH > 0 {
			fresh[status] = avgH
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	s.cacheMu.Lock()
	s.avgByState = fresh
	s.cacheBuilt = time.Now()
	s.cacheMu.Unlock()

	return fresh, nil
}

// ─── Executor ─────────────────────────────────────────────────────────────────

// execute consolidates the daily average buffer into a single final average,
// evaluates all active shipments against it, and runs priority escalations.
func (s *SLAAnomalyService) execute(cfg model.SLASettings) error {
	// ── Step 1: consolidate the daily buffer ──────────────────────────────────
	consolidated := s.consolidateBuffer()
	if len(consolidated) == 0 {
		log.Printf("[SLAAnomalyService] executor: buffer vacío — usando promedio directo de DB")
		// Fallback: query directly if no buffer snapshots were collected yet.
		var err error
		consolidated, err = s.refreshAverages(0) // force refresh (TTL=0)
		if err != nil {
			return fmt.Errorf("consolidate fallback: %w", err)
		}
	}

	log.Printf("[SLAAnomalyService] executor disparado a %s — promedios consolidados para %d estados",
		cfg.EscalationTime, len(consolidated))

	// ── Step 2: query active shipments ────────────────────────────────────────
	type activeShipment struct {
		trackingID    string
		status        string
		priority      string
		priorityScore float64
		updatedAt     time.Time
	}

	rows, err := s.db.Query(`
		SELECT tracking_id, status, COALESCE(priority,''), COALESCE(priority_score,0), updated_at
		FROM shipments
		WHERE status NOT IN (
			'delivered','returned','cancelled','lost','destroyed',
			'draft','expired','pending_payment'
		)`)
	if err != nil {
		return fmt.Errorf("listing active shipments: %w", err)
	}
	defer rows.Close()

	var candidates []activeShipment
	for rows.Next() {
		var sh activeShipment
		if err := rows.Scan(&sh.trackingID, &sh.status, &sh.priority, &sh.priorityScore, &sh.updatedAt); err != nil {
			log.Printf("[SLAAnomalyService] scan error: %v", err)
			continue
		}
		candidates = append(candidates, sh)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterating active shipments: %w", err)
	}

	// Build allow-list.
	allowed := make(map[string]bool, len(cfg.EnabledStates))
	for _, st := range cfg.EnabledStates {
		allowed[sanitizeState(st)] = true
	}

	// ── Step 3: evaluate and escalate ────────────────────────────────────────
	now := clock.Now()
	escalated := 0

	for _, sh := range candidates {
		st := sanitizeState(sh.status)

		if excludedStatuses[st] || !allowed[st] {
			continue
		}

		avg, ok := consolidated[st]
		if !ok || avg <= 0 {
			avg = fallbackAvgHours
		}

		dwellHours := now.Sub(sh.updatedAt).Hours()
		if dwellHours <= cfg.ToleranceMultiplier*avg {
			continue
		}

		nextPriority, canEscalate := nextPriorityBelowCeiling(sh.priority, cfg.PriorityCeiling)
		if !canEscalate {
			continue
		}

		if cfg.IsAutoEscalateEnabled() {
			newScore := escalatedScore(sh.priorityScore, nextPriority)
			// DO NOT update updated_at. The executor changes the priority label
			// but does not change the shipment's *state*. updated_at is used by
			// the metrics handler as a proxy for "when did this state begin":
			// resetting it to clock.Now() would make dwellH ≈ 0 immediately
			// after escalation, causing the shipment to vanish from the delay
			// count on the very next metrics poll.
			if _, err := s.db.Exec(`
				UPDATE shipments
				SET priority = $1, priority_score = $2
				WHERE tracking_id = $3`,
				nextPriority, newScore, sh.trackingID,
			); err != nil {
				log.Printf("[SLAAnomalyService] update priority %s: %v", sh.trackingID, err)
				continue
			}
		}

		reason := fmt.Sprintf(
			"Prioridad incrementada automáticamente por exceso de tiempo en estado %s",
			anomalyStatusDisplayName(sh.status),
		)
		if !cfg.IsAutoEscalateEnabled() {
			reason += " [repriorización deshabilitada — sin cambios en DB]"
		}
		entry := model.PriorityLog{
			TrackingID:   sh.trackingID,
			Timestamp:    now,
			PriorityFrom: sh.priority,
			PriorityTo:   nextPriority,
			Reason:       reason,
		}
		if err := s.logRepo.Append(entry); err != nil {
			log.Printf("[SLAAnomalyService] log append %s: %v", sh.trackingID, err)
		}

		log.Printf("[SLAAnomalyService] escalated %s: %s → %s (dwell %.1fh, avg %.1fh, status %s)",
			sh.trackingID, sh.priority, nextPriority, dwellHours, avg, sh.status)
		escalated++
	}

	// ── Step 4: clear the daily buffer ────────────────────────────────────────
	s.bufferMu.Lock()
	s.dailyAvgBuffer = nil
	s.bufferMu.Unlock()

	log.Printf("[SLAAnomalyService] executor completado: %d escalados — buffer limpiado", escalated)
	return nil
}

// consolidateBuffer computes the mean-of-means across all daily snapshots.
// Returns an empty map when the buffer is empty (caller handles the fallback).
func (s *SLAAnomalyService) consolidateBuffer() map[string]float64 {
	s.bufferMu.Lock()
	snapshots := make([]map[string]float64, len(s.dailyAvgBuffer))
	copy(snapshots, s.dailyAvgBuffer)
	s.bufferMu.Unlock()

	if len(snapshots) == 0 {
		return nil
	}

	// Accumulate sum and count per status across all snapshots.
	sums := make(map[string]float64)
	counts := make(map[string]int)
	for _, snap := range snapshots {
		for status, avg := range snap {
			sums[status] += avg
			counts[status]++
		}
	}

	result := make(map[string]float64, len(sums))
	for status, sum := range sums {
		result[status] = sum / float64(counts[status])
	}
	return result
}
