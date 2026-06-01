package service

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

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
	return &SLAAnomalyService{
		db:           db,
		logRepo:      logRepo,
		settingsRepo: settingsRepo,
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
	avgs, err := s.averages(cacheTTL)
	if err != nil {
		return fmt.Errorf("computing averages: %w", err)
	}
	if len(avgs) == 0 {
		return nil // not enough history yet
	}

	// Build allow-list set from EnabledStates for O(1) lookup.
	allowed := make(map[string]bool, len(cfg.EnabledStates))
	for _, st := range cfg.EnabledStates {
		allowed[st] = true
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

	now := time.Now()
	for _, sh := range candidates {
		// AC1 — only evaluate states the admin has enabled.
		if !allowed[sh.status] {
			continue
		}

		avg, ok := avgs[sh.status]
		if !ok || avg <= 0 {
			continue // no historical data for this status
		}

		dwellHours := now.Sub(sh.updatedAt).Hours()
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
