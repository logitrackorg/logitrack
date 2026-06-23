package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// fakeShipmentRepo mínimo para testear runStaleReplan.
type fakeShipmentRepo struct {
	shipments     []model.Shipment
	recordedPaths []repository.PathPlannedCmd
}

func (f *fakeShipmentRepo) Create(cmd repository.CreateShipmentCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) SaveDraft(cmd repository.SaveDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) UpdateDraft(cmd repository.UpdateDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) ConfirmDraft(cmd repository.ConfirmDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) UpdateStatus(cmd repository.StatusUpdateCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) ApplyCorrections(cmd repository.CorrectCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) CancelShipment(cmd repository.CancelCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) ExtendETA(cmd repository.ExtendETACmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) RequestPayment(cmd repository.RequestPaymentCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) ConfirmPayment(cmd repository.ConfirmPaymentCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) RevertToDraft(cmd repository.RevertToDraftCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) RecordPathPlanned(cmd repository.PathPlannedCmd) error {
	f.recordedPaths = append(f.recordedPaths, cmd)
	return nil
}
func (f *fakeShipmentRepo) SetPalletID(trackingID, palletID string) error  { return nil }
func (f *fakeShipmentRepo) ReserveForTrip(trackingID, tripID string) error { return nil }
func (f *fakeShipmentRepo) ReleaseFromTrip(trackingID string) error        { return nil }
func (f *fakeShipmentRepo) GetByTrackingID(id string) (model.Shipment, error) {
	for _, sh := range f.shipments {
		if sh.TrackingID == id {
			return sh, nil
		}
	}
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	return f.shipments, nil
}
func (f *fakeShipmentRepo) Search(q string) ([]model.Shipment, error) { return nil, nil }
func (f *fakeShipmentRepo) GetEvents(id string) ([]model.ShipmentEvent, error) {
	return nil, nil
}

func (f *fakeShipmentRepo) Stats(f2 model.ShipmentFilter) (model.Stats, error) {
	return model.Stats{}, nil
}

func (f *fakeShipmentRepo) SetSLANotified(trackingID string, notifiedAt *time.Time) error {
	for i := range f.shipments {
		if f.shipments[i].TrackingID == trackingID {
			f.shipments[i].SLANotifiedAt = notifiedAt
			break
		}
	}
	return nil
}

func (f *fakeShipmentRepo) SetSLAExpiredNotified(trackingID string, notifiedAt *time.Time) error {
	for i := range f.shipments {
		if f.shipments[i].TrackingID == trackingID {
			f.shipments[i].SLAExpiredNotifiedAt = notifiedAt
			break
		}
	}
	return nil
}

func (f *fakeShipmentRepo) AvgTimePerStatus(dateFrom, dateTo *time.Time) (model.AvgTimePerStatus, error) {
	return model.AvgTimePerStatus{}, nil
}

func (f *fakeShipmentRepo) CancellationStats(dateFrom, dateTo *time.Time, branchID string) (model.CancellationStats, error) {
	return model.CancellationStats{}, nil
}

func (f *fakeShipmentRepo) StatsDetail(statusFilter string, dateFrom, dateTo *time.Time) (map[string]int, error) {
	return nil, nil
}

func (f *fakeShipmentRepo) SetConfirmationEmailSent(trackingID string) (bool, error) {
	return true, nil
}

func (f *fakeShipmentRepo) AuthenticateRecipient(cmd repository.AuthenticateRecipientCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) RequestPickup(cmd repository.RequestPickupCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) RescheduleDelivery(cmd repository.RescheduleDeliveryCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) CancelByRecipient(cmd repository.CancelByRecipientCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) AuthenticateSender(cmd repository.AuthenticateSenderCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) CancelBySender(cmd repository.CancelBySenderCmd) (model.Shipment, error) {
	return model.Shipment{}, nil
}

func (f *fakeShipmentRepo) RecordKeywordFailed(trackingID, changedBy string) error { return nil }

// newMinimalRoutingService arma un RoutingService con solo lo necesario para stale-replan.
func newMinimalRoutingService(shipments []model.Shipment, edges []model.BranchEdge) *RoutingService {
	graphSvc := NewBranchGraphService(
		&fakeBranchGraphRepo{edges: edges},
		&fakeBranchRepo{branches: map[string]model.Branch{}},
	)
	svc := &RoutingService{
		shipmentRepo: &fakeShipmentRepo{shipments: shipments},
		graphSvc:     graphSvc,
	}
	return svc
}

// =============================================================================

func TestRunStaleReplan_ReplansStaleShipment(t *testing.T) {
	staleTime := time.Now().UTC().Add(-50 * time.Hour) // 50h atrás, threshold=48

	shipments := []model.Shipment{
		{
			TrackingID:        "LT-STALE",
			Status:            model.StatusAtHub,
			ReceivingBranchID: "cordoba",
			FinalBranchID:     "mendoza",
			NextHopBranchID:   "mendoza",
			PlannedPath:       []string{"caba", "cordoba", "mendoza"},
			HopIndex:          1,
			PathRevision:      1,
			UpdatedAt:         staleTime,
		},
	}
	edges := []model.BranchEdge{
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
	}

	svc := newMinimalRoutingService(shipments, edges)
	repo := svc.shipmentRepo.(*fakeShipmentRepo)

	replanned, stuck := svc.runStaleReplan("cordoba", 48)

	if replanned != 1 {
		t.Errorf("esperado 1 replaneado, got %d", replanned)
	}
	if stuck != 0 {
		t.Errorf("esperado 0 atascados, got %d", stuck)
	}
	if len(repo.recordedPaths) != 1 {
		t.Fatalf("esperado 1 RecordPathPlanned, got %d", len(repo.recordedPaths))
	}
	cmd := repo.recordedPaths[0]
	if cmd.Reason != "stale_replan" {
		t.Errorf("reason esperado stale_replan, got %s", cmd.Reason)
	}
	if cmd.PathRevision != 2 {
		t.Errorf("path_revision esperado 2, got %d", cmd.PathRevision)
	}
	if cmd.NextHopBranchID != "mendoza" {
		t.Errorf("next_hop esperado mendoza, got %s", cmd.NextHopBranchID)
	}
}

func TestRunStaleReplan_SkipsFreshShipment(t *testing.T) {
	freshTime := time.Now().UTC().Add(-10 * time.Hour) // 10h atrás, threshold=48

	shipments := []model.Shipment{
		{
			TrackingID:        "LT-FRESH",
			Status:            model.StatusAtHub,
			ReceivingBranchID: "cordoba",
			FinalBranchID:     "mendoza",
			NextHopBranchID:   "mendoza",
			UpdatedAt:         freshTime,
		},
	}
	svc := newMinimalRoutingService(shipments, nil)
	repo := svc.shipmentRepo.(*fakeShipmentRepo)

	replanned, stuck := svc.runStaleReplan("cordoba", 48)

	if replanned != 0 || stuck != 0 {
		t.Errorf("envío fresco no debería procesarse: replanned=%d stuck=%d", replanned, stuck)
	}
	if len(repo.recordedPaths) != 0 {
		t.Errorf("no debería haber RecordPathPlanned para envío fresco")
	}
}

func TestRunStaleReplan_SkipsShipmentWithoutPlannedPath(t *testing.T) {
	staleTime := time.Now().UTC().Add(-72 * time.Hour)

	shipments := []model.Shipment{
		{
			TrackingID:        "LT-NOPATH",
			Status:            model.StatusAtHub,
			ReceivingBranchID: "cordoba",
			FinalBranchID:     "mendoza",
			NextHopBranchID:   "", // sin path planeado
			UpdatedAt:         staleTime,
		},
	}
	svc := newMinimalRoutingService(shipments, nil)
	repo := svc.shipmentRepo.(*fakeShipmentRepo)

	replanned, stuck := svc.runStaleReplan("cordoba", 48)

	if replanned != 0 || stuck != 0 {
		t.Errorf("sin next_hop no debería procesarse: replanned=%d stuck=%d", replanned, stuck)
	}
	if len(repo.recordedPaths) != 0 {
		t.Error("sin next_hop no debería haber RecordPathPlanned")
	}
}

func TestRunStaleReplan_MarkasStuckWhenNoPath(t *testing.T) {
	staleTime := time.Now().UTC().Add(-72 * time.Hour)

	shipments := []model.Shipment{
		{
			TrackingID:        "LT-STUCK",
			Status:            model.StatusAtHub,
			ReceivingBranchID: "cordoba",
			FinalBranchID:     "mendoza",
			NextHopBranchID:   "mendoza",
			UpdatedAt:         staleTime,
		},
	}
	// Grafo sin arista cordoba→mendoza
	svc := newMinimalRoutingService(shipments, []model.BranchEdge{})

	replanned, stuck := svc.runStaleReplan("cordoba", 48)

	if stuck != 1 {
		t.Errorf("esperado 1 atascado, got %d", stuck)
	}
	if replanned != 0 {
		t.Errorf("esperado 0 replaneados, got %d", replanned)
	}
}

func TestRunStaleReplan_DisabledWhenThresholdZero(t *testing.T) {
	staleTime := time.Now().UTC().Add(-999 * time.Hour)
	shipments := []model.Shipment{
		{
			TrackingID:        "LT-ANY",
			Status:            model.StatusAtHub,
			ReceivingBranchID: "cordoba",
			NextHopBranchID:   "mendoza",
			UpdatedAt:         staleTime,
		},
	}
	svc := newMinimalRoutingService(shipments, nil)
	repo := svc.shipmentRepo.(*fakeShipmentRepo)

	replanned, stuck := svc.runStaleReplan("cordoba", 0) // threshold=0 → deshabilitado

	if replanned != 0 || stuck != 0 || len(repo.recordedPaths) != 0 {
		t.Error("threshold=0 debería deshabilitar el stale-replan completamente")
	}
}
