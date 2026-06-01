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

// debugCacheTTL is the shortened average-cache lifetime used when SLA_DEBUG is
// enabled, so manual time-travel tests don't require a server restart between
// DB date manipulations.
const debugCacheTTL = 10 * time.Second

// sanitizeState normalises a status string for tolerant comparison: trims
// hidden whitespace and lowercases it. Status codes are already lowercase, so
// this is a no-op for clean data — but it protects against stray spaces or
// case differences that could otherwise cause a silent allow-list miss.
func sanitizeState(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// fallbackAvgHours is the synthetic average used when a state has no
// historical data yet (cold start / new deployment). It prevents the
// tolerance check from evaluating to zero, which would either skip the
// shipment or trigger spuriously. At 1.5× tolerance, a shipment must
// exceed 36 h in the state before being flagged — a safe first-time threshold.
const fallbackAvgHours = 24.0

// excludedStatuses is a Go-level security guard that mirrors the SQL NOT IN
// clause. Belt-and-suspenders: if a row somehow slips past the SQL filter
// (future schema change, query reuse, etc.) it is still discarded here.
var excludedStatuses = map[string]bool{
	"delivered":      true, // Entregado  — terminal
	"returned":       true, // Devuelto   — terminal
	"cancelled":      true, // Cancelado  — terminal
	"lost":           true, // Extraviado — terminal
	"destroyed":      true, // Destruido  — terminal
	"draft":          true, // Borrador   — pre-operativo
	"pending_payment":true, // Pago pendiente — pre-operativo
	"expired":        true, // Expirado   — terminal
}

// priorityOrder defines escalation steps from lowest to highest.
var priorityOrder = []string{"baja", "media", "alta"}

// nextPriorityBelowCeiling returns the next higher priority level, but only if
// it does not exceed the configured ceiling. Returns ("", false) when the
// current priority is already at or above the ceiling or has no successor.
func nextPriorityBelowCeiling(current, ceiling string) (string, bool) {
	cIdx := indexOfStr(priorityOrder, ceiling)
	cUrr := indexOfStr(priorityOrder, current)
	if cIdx < 0 || cUrr < 0 {
		return "", false
	}
	next := cUrr + 1
	if next >= len(priorityOrder) || next > cIdx {
		return "", false // already at or above ceiling
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

// anomalyStatusNames translates raw DB status codes to Spanish display names
// so audit log entries are readable without needing to know internal codes.
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

// escalatedScore ensures the priority_score column is coherent with the new
// priority label. It raises the score to the midpoint of the new tier's range
// only if the current score falls below that midpoint (we never lower the score).
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

// SLAAnomalyService detects shipments that have been stalled in a state for
// longer than (ToleranceMultiplier × historical average) and escalates their
// priority automatically. All tunable parameters are read from SLASettings at
// each run so changes take effect without a server restart.
type SLAAnomalyService struct {
	db           *sql.DB
	logRepo      *repository.PriorityLogRepository
	settingsRepo *repository.SLASettingsRepository

	mu      sync.Mutex // guards against concurrent RunCheck invocations
	running bool

	// debugMode is read once at construction from the SLA_DEBUG env var. When
	// true, the average cache TTL is forced to debugCacheTTL (10 s) so manual
	// time-travel tests reflect fresh data without a restart.
	debugMode bool

	// Average cache — avoids recomputing the full aggregation every tick.
	// The TTL is read from SLASettings.CacheIntervalMinutes at check time.
	cacheMu    sync.RWMutex
	avgByState map[string]float64
	cacheBuilt time.Time
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
	}
}

// RunCheck is the entry point called by the clock handler. Non-blocking.
func (s *SLAAnomalyService) RunCheck() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
		}()
		if err := s.runCheck(); err != nil {
			log.Printf("[SLAAnomalyService] check error: %v", err)
		}
	}()
}

// ─── Internal implementation ──────────────────────────────────────────────────

func (s *SLAAnomalyService) runCheck() error {
	// Load current settings — done at the start of every run so changes made
	// via the admin panel take effect on the very next clock tick.
	cfg := s.settingsRepo.Get()

	cacheTTL := time.Duration(cfg.CacheIntervalMinutes) * time.Minute
	if s.debugMode {
		cacheTTL = debugCacheTTL // bypass long cache during manual time-travel tests
	}
	avgs, err := s.averages(cacheTTL)
	if err != nil {
		return fmt.Errorf("computing averages: %w", err)
	}
	if len(avgs) == 0 {
		return nil // not enough history yet
	}

	// Build allow-list set from EnabledStates for O(1) lookup.
	// Keys are sanitised (trimmed + lowercased) so the comparison against the
	// shipment status is tolerant to stray whitespace / case differences.
	allowed := make(map[string]bool, len(cfg.EnabledStates))
	for _, st := range cfg.EnabledStates {
		allowed[sanitizeState(st)] = true
	}

	type activeShipment struct {
		trackingID    string
		status        string
		priority      string
		priorityScore float64
		updatedAt     time.Time
	}

	// Query all non-terminal shipments; the EnabledStates filter is applied in
	// Go to avoid dynamic SQL parameterisation complexity.
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

	// CRITICAL: measure dwell with clock.Now(), NOT time.Now(). Shipment
	// updated_at timestamps are written using clock.Now(), which honours the
	// admin "advance time" override. Using real time.Now() here made shipments
	// that transitioned UNDER an active override (e.g. arrivals at destination
	// hub during a +7d jump) have a future updated_at → negative dwell → never
	// flagged. clock.Now() keeps both timestamps on the same timeline.
	now := clock.Now()
	for _, sh := range candidates {
		// Sanitise once and use the normalised value for every comparison.
		st := sanitizeState(sh.status)

		// Security guard — belt-and-suspenders exclusion of terminal and
		// pre-operative states even if they somehow passed the SQL filter.
		if excludedStatuses[st] {
			continue
		}

		// Allow-list check — only evaluate states the admin has enabled.
		if !allowed[st] {
			continue
		}

		avg, ok := avgs[st]
		// Cold-start fallback: when no historical data exists for this state
		// (new deployment or first-ever shipment through it), use a safe 24-hour
		// synthetic average. At the default 1.5× tolerance the engine will flag
		// the shipment after 36 h — conservative but avoids silent gaps.
		if !ok || avg <= 0 {
			avg = fallbackAvgHours
		}

		dwellHours := now.Sub(sh.updatedAt).Hours()

		// DEBUG TEMPORAL — quitar tras diagnosticar el motor SLA.
		// Muestra qué estado reconoce Go y los valores que entran al umbral.
		log.Printf("[SLA][debug] Evaluando envío %s en estado: %s - Promedio Histórico: %.2fh - Tiempo Transcurrido: %.2fh (umbral: %.2fh)",
			sh.trackingID, st, avg, dwellHours, cfg.ToleranceMultiplier*avg)

		if dwellHours <= cfg.ToleranceMultiplier*avg {
			continue // within expected range
		}

		// AC1 — shipment is "Demorado"; attempt escalation.
		nextPriority, canEscalate := nextPriorityBelowCeiling(sh.priority, cfg.PriorityCeiling)
		if !canEscalate {
			continue // at or above ceiling
		}

		// AC2 — persist priority escalation.
		newScore := escalatedScore(sh.priorityScore, nextPriority)
		_, err := s.db.Exec(`
			UPDATE shipments
			SET priority = $1, priority_score = $2, updated_at = $3
			WHERE tracking_id = $4`,
			nextPriority, newScore, now, sh.trackingID,
		)
		if err != nil {
			log.Printf("[SLAAnomalyService] update priority %s: %v", sh.trackingID, err)
			continue
		}

		// AC3 — append audit entry.
		entry := model.PriorityLog{
			TrackingID:   sh.trackingID,
			Timestamp:    now,
			PriorityFrom: sh.priority,
			PriorityTo:   nextPriority,
			Reason: fmt.Sprintf(
				"Prioridad incrementada automáticamente por exceso de tiempo en estado %s",
				anomalyStatusDisplayName(sh.status),
			),
		}
		if err := s.logRepo.Append(entry); err != nil {
			log.Printf("[SLAAnomalyService] log append %s: %v", sh.trackingID, err)
		}

		log.Printf("[SLAAnomalyService] escalated %s: %s → %s (dwell %.1fh, avg %.1fh, status %s, ceiling %s)",
			sh.trackingID, sh.priority, nextPriority, dwellHours, avg, sh.status, cfg.PriorityCeiling)
	}

	return nil
}

// averages returns the cached per-status dwell-time averages, refreshing when
// the cache age exceeds cacheTTL. The TTL comes from SLASettings so changes
// made by an admin are reflected on the next check cycle.
func (s *SLAAnomalyService) averages(cacheTTL time.Duration) (map[string]float64, error) {
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
