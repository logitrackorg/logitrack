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

// anomalyThreshold is the multiplier applied to the dynamic average dwell time.
// A shipment that has spent more than (threshold * avg) in its current state is
// flagged as "Demorado" and its priority is escalated (AC1).
const anomalyThreshold = 1.5

// averageCacheTTL controls how long the computed status averages are reused
// before a fresh SQL query is issued. Long-running systems accumulate enough
// historical events that recalculating every minute wastes DB cycles; 1 h is
// a reasonable trade-off between freshness and overhead.
const averageCacheTTL = time.Hour

// priorityNext maps each priority level to its escalated successor.
// "alta" has no successor — already at the ceiling.
var priorityNext = map[string]string{
	"baja":  "media",
	"media": "alta",
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
//
//	alta  → threshold 0.65, midpoint ≈ 0.82
//	media → threshold 0.35, midpoint ≈ 0.50
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
// longer than 150 % of the historical average dwell time and escalates their
// priority automatically (AC1 + AC2 + AC3).
//
// The heavy work (SQL queries, DB writes, file I/O) runs inside a goroutine so
// the clock-handler goroutine is never blocked. A mutex prevents overlapping
// runs if the clock fires faster than a single check completes.
type SLAAnomalyService struct {
	db      *sql.DB
	logRepo *repository.PriorityLogRepository

	mu      sync.Mutex  // guards against concurrent RunCheck invocations
	running bool

	// Average cache — avoids recomputing the full aggregation every tick.
	cacheMu    sync.RWMutex
	avgByState map[string]float64 // status → avg hours
	cacheBuilt time.Time
}

func NewSLAAnomalyService(db *sql.DB, logRepo *repository.PriorityLogRepository) *SLAAnomalyService {
	return &SLAAnomalyService{
		db:      db,
		logRepo: logRepo,
	}
}

// RunCheck is the entry point called by the clock handler. It launches the
// actual work in a goroutine and returns immediately (non-blocking).
func (s *SLAAnomalyService) RunCheck() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return // previous run still in progress — skip this tick
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
	// AC1 — compute (or reuse cached) dynamic averages per status.
	avgs, err := s.averages()
	if err != nil {
		return fmt.Errorf("computing averages: %w", err)
	}
	if len(avgs) == 0 {
		return nil // not enough history yet
	}

	// AC1 — query active shipments and their current dwell time.
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

	now := time.Now()
	for _, sh := range candidates {
		avg, ok := avgs[sh.status]
		if !ok || avg <= 0 {
			continue // no historical data for this status
		}

		dwellHours := now.Sub(sh.updatedAt).Hours()
		if dwellHours <= anomalyThreshold*avg {
			continue // within expected range
		}

		// AC1 — shipment is "Demorado".
		nextPriority, canEscalate := priorityNext[sh.priority]
		if !canEscalate {
			continue // already at "alta"; nothing to escalate
		}

		// AC2 — persist priority escalation directly in the shipments table.
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

		// AC3 — append audit entry to priority_logs.json.
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

		log.Printf("[SLAAnomalyService] escalated %s: %s → %s (dwell %.1fh, avg %.1fh, status %s)",
			sh.trackingID, sh.priority, nextPriority, dwellHours, avg, sh.status)
	}

	return nil
}

// averages returns the cached dynamic dwell-time averages, refreshing them if
// the cache is stale. The query mirrors the pattern used by AvgTimePerStatus in
// the projection package, but without a date filter so all history is used.
func (s *SLAAnomalyService) averages() (map[string]float64, error) {
	// Fast path — cache hit.
	s.cacheMu.RLock()
	if time.Since(s.cacheBuilt) < averageCacheTTL && len(s.avgByState) > 0 {
		out := make(map[string]float64, len(s.avgByState))
		for k, v := range s.avgByState {
			out[k] = v
		}
		s.cacheMu.RUnlock()
		return out, nil
	}
	s.cacheMu.RUnlock()

	// Slow path — recompute from the events table.
	rows, err := s.db.Query(`
		WITH ordered AS (
			SELECT
				e.tracking_id,
				e.payload->>'FromStatus'                                           AS from_status,
				e.timestamp,
				LEAD(e.timestamp) OVER (
					PARTITION BY e.tracking_id ORDER BY e.timestamp ASC
				)                                                                  AS next_ts
			FROM events e
			WHERE e.event_type = 'status_changed'
		)
		SELECT
			from_status,
			COALESCE(AVG(EXTRACT(EPOCH FROM (next_ts - timestamp)) / 3600), 0)   AS avg_hours
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
