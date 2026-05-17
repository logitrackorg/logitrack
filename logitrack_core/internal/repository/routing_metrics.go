package repository

import (
	"time"

	"github.com/logitrack/core/internal/model"
)

// RoutingMetricsRepository persiste y consulta métricas de calidad del ruteo.
// Todas las escrituras son best-effort: un fallo no debe interrumpir la operación.
type RoutingMetricsRepository interface {
	SavePlanMetric(m model.PlanMetric) error
	SaveApplyMetric(m model.ApplyMetric) error
	SaveHopMetric(m model.ShipmentHopMetric) error
	// IncrementODVolume hace upsert del volumen del par O-D para la fecha dada.
	IncrementODVolume(originBranch, destBranch, date string, count int, weightKg float64) error

	ListPlanMetrics(branchID string, from, to time.Time) ([]model.PlanMetric, error)
	ListApplyMetrics(branchID string, from, to time.Time) ([]model.ApplyMetric, error)
	ListHopMetrics(branchID string, from, to time.Time) ([]model.ShipmentHopMetric, error)
	ListODVolume(originBranch, destBranch string, from, to time.Time) ([]model.ODPairVolume, error)
	GetSummary(branchID string, from, to time.Time) ([]model.RoutingMetricsSummary, error)

	// Backfill: reconstruye métricas históricas desde shipments y events.
	// Idempotente — puede correrse a diario sin duplicar.
	BackfillODVolume() (int, error)
	BackfillHops() (int, error)
}
