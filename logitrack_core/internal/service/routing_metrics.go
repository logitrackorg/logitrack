package service

import (
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// RoutingMetricsService persiste métricas de calidad del ruteo.
// Todas las operaciones son best-effort: los errores se loggean pero nunca
// interrumpen el flujo operativo.
type RoutingMetricsService struct {
	repo repository.RoutingMetricsRepository
}

func NewRoutingMetricsService(repo repository.RoutingMetricsRepository) *RoutingMetricsService {
	return &RoutingMetricsService{repo: repo}
}

func (s *RoutingMetricsService) RecordPlan(branchID string, plan model.RoutingPlan, durationMs int64) {
	now := time.Now().UTC()

	// VRP-per-vehicle optimization not yet implemented; metrics fields removed with VRP refactor.
	var windowCovPct *float64

	m := model.PlanMetric{
		ID:                uuid.NewString(),
		BranchID:          branchID,
		GeneratedAt:       plan.GeneratedAt,
		GenerationTimeMs:  durationMs,
		LastMileCount:     len(plan.LastMile),
		InterBranchCount:  len(plan.InterBranch),
		UnassignedCount:   len(plan.Unassigned),
		VRPUsed:           false,
		WindowCoveragePct: windowCovPct,
		CreatedAt:         now,
	}
	if err := s.repo.SavePlanMetric(m); err != nil {
		log.Printf("[metrics] error guardando plan metric: %v", err)
	}
}

func (s *RoutingMetricsService) RecordApply(branchID, appliedBy string, resp model.ApplyPlanResponse, manualOverrideCount int) {
	now := time.Now().UTC()

	driftCount := 0
	driftReasons := map[string]bool{
		"ruta_ya_iniciada":       true,
		"vehiculo_no_disponible": true,
	}
	for _, item := range resp.Items {
		if item.Status == "failed" {
			if driftReasons[item.Error] {
				driftCount++
				continue
			}
			// estado_cambio:X también es drift
			if len(item.Error) > 13 && item.Error[:13] == "estado_cambio" {
				driftCount++
			}
		}
	}

	m := model.ApplyMetric{
		ID:                  uuid.NewString(),
		BranchID:            branchID,
		AppliedAt:           now,
		AppliedBy:           appliedBy,
		AppliedCount:        resp.AppliedCount,
		FailedCount:         resp.FailedCount,
		DriftCount:          driftCount,
		ManualOverrideCount: manualOverrideCount,
		CreatedAt:           now,
	}
	if err := s.repo.SaveApplyMetric(m); err != nil {
		log.Printf("[metrics] error guardando apply metric: %v", err)
	}
}

// RecordHop registra el inicio de un tramo inter-sucursal (partida del vehículo).
// La llegada se completa con CompleteHop cuando el vehículo hace end-trip.
func (s *RoutingMetricsService) RecordHop(trackingID, fromBranch, toBranch string, departedAt time.Time) {
	now := time.Now().UTC()
	m := model.ShipmentHopMetric{
		ID:           uuid.NewString(),
		TrackingID:   trackingID,
		FromBranchID: fromBranch,
		ToBranchID:   toBranch,
		DepartedAt:   departedAt,
		CreatedAt:    now,
	}
	if err := s.repo.SaveHopMetric(m); err != nil {
		log.Printf("[metrics] error guardando hop metric: %v", err)
	}
}

// IncrementODVolume suma 1 envío al contador del par O-D para la fecha dada.
func (s *RoutingMetricsService) IncrementODVolume(originBranch, destBranch string, date time.Time, weightKg float64) {
	d := date.Format("2006-01-02")
	if err := s.repo.IncrementODVolume(originBranch, destBranch, d, 1, weightKg); err != nil {
		log.Printf("[metrics] error incrementando OD volume: %v", err)
	}
}

// --- Consultas (usadas por el handler admin) ---

func (s *RoutingMetricsService) ListPlanMetrics(branchID string, from, to time.Time) ([]model.PlanMetric, error) {
	return s.repo.ListPlanMetrics(branchID, from, to)
}

func (s *RoutingMetricsService) ListApplyMetrics(branchID string, from, to time.Time) ([]model.ApplyMetric, error) {
	return s.repo.ListApplyMetrics(branchID, from, to)
}

func (s *RoutingMetricsService) ListHopMetrics(branchID string, from, to time.Time) ([]model.ShipmentHopMetric, error) {
	return s.repo.ListHopMetrics(branchID, from, to)
}

func (s *RoutingMetricsService) ListODVolume(originBranch, destBranch string, from, to time.Time) ([]model.ODPairVolume, error) {
	return s.repo.ListODVolume(originBranch, destBranch, from, to)
}

func (s *RoutingMetricsService) GetSummary(branchID string, from, to time.Time) ([]model.RoutingMetricsSummary, error) {
	return s.repo.GetSummary(branchID, from, to)
}

// RunBackfill ejecuta los dos backfills (OD volume + hops) y devuelve los
// contadores. Pensado para el scheduler nocturno y el comando manual.
func (s *RoutingMetricsService) RunBackfill() (odCount, hopCount int, err error) {
	odCount, err = s.repo.BackfillODVolume()
	if err != nil {
		return odCount, 0, err
	}
	hopCount, err = s.repo.BackfillHops()
	return odCount, hopCount, err
}
