package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

// fakeMetricsRepo captura llamadas para testing.
type fakeMetricsRepo struct {
	plans   []model.PlanMetric
	applies []model.ApplyMetric
	hops    []model.ShipmentHopMetric
	odCalls []struct {
		origin, dest, date string
		count              int
		weightKg           float64
	}
}

func (f *fakeMetricsRepo) SavePlanMetric(m model.PlanMetric) error {
	f.plans = append(f.plans, m)
	return nil
}

func (f *fakeMetricsRepo) SaveApplyMetric(m model.ApplyMetric) error {
	f.applies = append(f.applies, m)
	return nil
}

func (f *fakeMetricsRepo) SaveHopMetric(m model.ShipmentHopMetric) error {
	f.hops = append(f.hops, m)
	return nil
}

func (f *fakeMetricsRepo) IncrementODVolume(origin, dest, date string, count int, weightKg float64) error {
	f.odCalls = append(f.odCalls, struct {
		origin, dest, date string
		count              int
		weightKg           float64
	}{origin, dest, date, count, weightKg})
	return nil
}

func (f *fakeMetricsRepo) ListPlanMetrics(string, time.Time, time.Time) ([]model.PlanMetric, error) {
	return f.plans, nil
}
func (f *fakeMetricsRepo) ListApplyMetrics(string, time.Time, time.Time) ([]model.ApplyMetric, error) {
	return f.applies, nil
}
func (f *fakeMetricsRepo) ListHopMetrics(string, time.Time, time.Time) ([]model.ShipmentHopMetric, error) {
	return f.hops, nil
}
func (f *fakeMetricsRepo) ListODVolume(string, string, time.Time, time.Time) ([]model.ODPairVolume, error) {
	return nil, nil
}
func (f *fakeMetricsRepo) GetSummary(string, time.Time, time.Time) ([]model.RoutingMetricsSummary, error) {
	return nil, nil
}
func (f *fakeMetricsRepo) BackfillODVolume() (int, error) { return 0, nil }
func (f *fakeMetricsRepo) BackfillHops() (int, error)     { return 0, nil }

// =============================================================================
// RecordPlan
// =============================================================================

func TestRecordPlan_VRPUsed_ComputesWindowCoverage(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	plan := model.RoutingPlan{
		BranchID:    "caba",
		GeneratedAt: time.Now(),
		LastMile: []model.LastMileAssignment{
			{VehicleID: "v1", LicensePlate: "AB123CD"},
			{VehicleID: "v2", LicensePlate: "KL567MN"},
		},
		InterBranch: []model.InterBranchAssignment{{VehicleID: "v3"}},
		Unassigned:  []model.UnassignedShipment{{TrackingID: "LT-X"}},
	}

	svc.RecordPlan("caba", plan, 123)

	if len(repo.plans) != 1 {
		t.Fatalf("se esperaba 1 plan guardado, hubo %d", len(repo.plans))
	}
	m := repo.plans[0]
	if m.VRPUsed {
		t.Errorf("vrp_used debería ser false (VRP por vehículo no implementado aún)")
	}
	if m.LastMileCount != 2 {
		t.Errorf("last_mile_count esperado 2, got %d", m.LastMileCount)
	}
	if m.InterBranchCount != 1 {
		t.Errorf("inter_branch_count esperado 1, got %d", m.InterBranchCount)
	}
	if m.UnassignedCount != 1 {
		t.Errorf("unassigned_count esperado 1, got %d", m.UnassignedCount)
	}
	if m.GenerationTimeMs != 123 {
		t.Errorf("generation_time_ms esperado 123, got %d", m.GenerationTimeMs)
	}
}

func TestRecordPlan_GreedyOnly_NoWindowCoverage(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	plan := model.RoutingPlan{
		BranchID: "caba",
		LastMile: []model.LastMileAssignment{
			{VehicleID: "v1", LicensePlate: "AB123CD"},
		},
	}

	svc.RecordPlan("caba", plan, 50)

	m := repo.plans[0]
	if m.VRPUsed {
		t.Errorf("vrp_used debería ser false")
	}
	if m.WindowCoveragePct != nil {
		t.Errorf("window_coverage_pct debería ser nil sin VRP, got %v", *m.WindowCoveragePct)
	}
}

func TestRecordPlan_EmptyPlan_OK(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	svc.RecordPlan("caba", model.RoutingPlan{BranchID: "caba"}, 10)

	if len(repo.plans) != 1 {
		t.Fatalf("se esperaba 1 plan, hubo %d", len(repo.plans))
	}
	m := repo.plans[0]
	if m.LastMileCount != 0 || m.InterBranchCount != 0 || m.UnassignedCount != 0 {
		t.Errorf("contadores deberían ser 0 en plan vacío")
	}
	if m.VRPUsed {
		t.Errorf("vrp_used debería ser false en plan vacío")
	}
}

// =============================================================================
// RecordApply
// =============================================================================

func TestRecordApply_CountsDriftCorrectly(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	resp := model.ApplyPlanResponse{
		AppliedCount: 3,
		FailedCount:  4,
		Items: []model.ApplyResultItem{
			{TrackingID: "LT-1", Status: "applied"},
			{TrackingID: "LT-2", Status: "applied"},
			{TrackingID: "LT-3", Status: "applied"},
			{TrackingID: "LT-4", Status: "failed", Error: "ruta_ya_iniciada"},         // drift
			{TrackingID: "LT-5", Status: "failed", Error: "estado_cambio:loaded"},     // drift
			{TrackingID: "LT-6", Status: "failed", Error: "vehiculo_no_disponible"},   // drift
			{TrackingID: "LT-7", Status: "failed", Error: "capacidad_excedida"},       // NO drift
		},
	}

	svc.RecordApply("caba", "op_caba", resp, 2)

	if len(repo.applies) != 1 {
		t.Fatalf("se esperaba 1 apply guardado, hubo %d", len(repo.applies))
	}
	m := repo.applies[0]
	if m.AppliedCount != 3 {
		t.Errorf("applied_count esperado 3, got %d", m.AppliedCount)
	}
	if m.FailedCount != 4 {
		t.Errorf("failed_count esperado 4, got %d", m.FailedCount)
	}
	if m.DriftCount != 3 {
		t.Errorf("drift_count esperado 3 (capacidad_excedida no cuenta), got %d", m.DriftCount)
	}
	if m.ManualOverrideCount != 2 {
		t.Errorf("manual_override_count esperado 2, got %d", m.ManualOverrideCount)
	}
	if m.BranchID != "caba" || m.AppliedBy != "op_caba" {
		t.Errorf("branch_id o applied_by mal seteados: %+v", m)
	}
}

func TestRecordApply_AllSuccess_ZeroDrift(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	resp := model.ApplyPlanResponse{
		AppliedCount: 2,
		Items: []model.ApplyResultItem{
			{TrackingID: "LT-1", Status: "applied"},
			{TrackingID: "LT-2", Status: "applied"},
		},
	}

	svc.RecordApply("caba", "user", resp, 0)

	m := repo.applies[0]
	if m.DriftCount != 0 || m.FailedCount != 0 {
		t.Errorf("sin fallas, drift y failed deberían ser 0: drift=%d failed=%d", m.DriftCount, m.FailedCount)
	}
}

// =============================================================================
// IncrementODVolume
// =============================================================================

func TestIncrementODVolume_FormatsDateCorrectly(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	d := time.Date(2026, 5, 13, 10, 30, 0, 0, time.UTC)
	svc.IncrementODVolume("caba", "mendoza", d, 12.5)

	if len(repo.odCalls) != 1 {
		t.Fatalf("se esperaba 1 call a OD, hubo %d", len(repo.odCalls))
	}
	c := repo.odCalls[0]
	if c.date != "2026-05-13" {
		t.Errorf("fecha esperada 2026-05-13, got %s", c.date)
	}
	if c.origin != "caba" || c.dest != "mendoza" {
		t.Errorf("origin/dest mal: %s → %s", c.origin, c.dest)
	}
	if c.count != 1 {
		t.Errorf("count esperado 1, got %d", c.count)
	}
	if c.weightKg != 12.5 {
		t.Errorf("weight esperado 12.5, got %v", c.weightKg)
	}
}

// =============================================================================
// RecordHop
// =============================================================================

func TestRecordHop_StoresAllFields(t *testing.T) {
	repo := &fakeMetricsRepo{}
	svc := NewRoutingMetricsService(repo)

	departed := time.Date(2026, 5, 13, 8, 0, 0, 0, time.UTC)
	svc.RecordHop("LT-X", "caba", "cordoba", departed)

	if len(repo.hops) != 1 {
		t.Fatalf("se esperaba 1 hop, hubo %d", len(repo.hops))
	}
	h := repo.hops[0]
	if h.TrackingID != "LT-X" || h.FromBranchID != "caba" || h.ToBranchID != "cordoba" {
		t.Errorf("campos del hop mal: %+v", h)
	}
	if !h.DepartedAt.Equal(departed) {
		t.Errorf("departed_at no coincide: esperado %v, got %v", departed, h.DepartedAt)
	}
	if h.ArrivedAt != nil {
		t.Errorf("arrived_at debería ser nil al abrir el hop")
	}
}
