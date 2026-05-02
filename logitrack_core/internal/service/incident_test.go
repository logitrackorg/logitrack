package service

import (
	"strings"
	"testing"

	"github.com/logitrack/core/internal/model"
)

func TestReportIncident_ShipmentNotFound(t *testing.T) {
	ts := newSetup()
	_, err := ts.incidentSvc.ReportIncident("LT-NOTEXIST", "operator", model.IncidentTypeDamage, "paquete roto")
	if err == nil || !strings.Contains(err.Error(), "envío no encontrado") {
		t.Errorf("expected shipment-not-found error, got: %v", err)
	}
}

func TestReportIncident_TerminalStates(t *testing.T) {
	tests := []struct {
		name  string
		setup func(ts testSetup) string
	}{
		{
			name: "delivered",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtHub(t, ts, ship.TrackingID)
				toOutForDelivery(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDelivered, ChangedBy: "driver",
					RecipientDNI: defaultRecipient().DNI,
				})
				return ship.TrackingID
			},
		},
		{
			name: "returned",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				advanceToReadyForReturn(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusReturned, ChangedBy: "supervisor",
					SenderDNI: defaultSender().DNI,
				})
				return ship.TrackingID
			},
		},
		{
			name: "cancelled",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				ts.svc.CancelShipment(ship.TrackingID, "supervisor", "motivo de prueba")
				return ship.TrackingID
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ts := newSetup()
			id := tc.setup(ts)
			_, err := ts.incidentSvc.ReportIncident(id, "operator", model.IncidentTypeDamage, "paquete roto")
			if err == nil || !strings.Contains(err.Error(), "estado terminal") {
				t.Errorf("expected terminal-state error for %s, got: %v", tc.name, err)
			}
		})
	}
}

func TestReportIncident_InvalidType(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentType("tipo_inexistente"), "desc")
	if err == nil || !strings.Contains(err.Error(), "tipo de incidencia no válido") {
		t.Errorf("expected invalid-type error, got: %v", err)
	}
}

func TestReportIncident_EmptyDescriptionRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeDamage, "   ")
	if err == nil || !strings.Contains(err.Error(), "descripción es requerida") {
		t.Errorf("expected empty-description error, got: %v", err)
	}
}

func TestReportIncident_Success(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	inc, err := ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeDamage, "paquete llegó roto")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if inc.ID == "" {
		t.Error("incident ID should not be empty")
	}
	if inc.TrackingID != ship.TrackingID {
		t.Errorf("TrackingID = %q, want %q", inc.TrackingID, ship.TrackingID)
	}
	if inc.IncidentType != model.IncidentTypeDamage {
		t.Errorf("IncidentType = %q, want %q", inc.IncidentType, model.IncidentTypeDamage)
	}
	if inc.ReportedBy != "operator" {
		t.Errorf("ReportedBy = %q, want operator", inc.ReportedBy)
	}
	if inc.CreatedAt.IsZero() {
		t.Error("CreatedAt should be set")
	}
}

func TestReportIncident_SetsHasIncidentOnProjection(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	before, _ := ts.shipmentRepo.GetByTrackingID(ship.TrackingID)
	if before.HasIncident {
		t.Error("HasIncident should be false before reporting")
	}

	ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeDelay, "demoró 3 días")

	after, _ := ts.shipmentRepo.GetByTrackingID(ship.TrackingID)
	if !after.HasIncident {
		t.Error("HasIncident should be true after reporting")
	}
	if after.IncidentType != model.IncidentTypeDelay {
		t.Errorf("IncidentType = %q, want %q", after.IncidentType, model.IncidentTypeDelay)
	}
}

func TestReportIncident_AllowedOnActiveStates(t *testing.T) {
	activeStatuses := []struct {
		name  string
		setup func(ts testSetup, id string)
	}{
		{"at_origin_hub", func(_ testSetup, _ string) {}},
		{"at_hub", func(ts testSetup, id string) {
			toInTransit(t, ts, id)
			toAtHub(t, ts, id)
		}},
		{"out_for_delivery", func(ts testSetup, id string) {
			toInTransit(t, ts, id)
			toAtHub(t, ts, id)
			toOutForDelivery(t, ts, id)
		}},
	}

	for _, tc := range activeStatuses {
		t.Run(tc.name, func(t *testing.T) {
			ts := newSetup()
			ship := mustCreate(t, ts)
			tc.setup(ts, ship.TrackingID)
			_, err := ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeOther, "incidencia en estado activo")
			if err != nil {
				t.Errorf("expected no error for status %s, got: %v", tc.name, err)
			}
		})
	}
}

func TestGetIncidents_ShipmentNotFound(t *testing.T) {
	ts := newSetup()
	_, err := ts.incidentSvc.GetIncidents("LT-NOTEXIST")
	if err == nil || !strings.Contains(err.Error(), "envío no encontrado") {
		t.Errorf("expected shipment-not-found error, got: %v", err)
	}
}

func TestGetIncidents_ReturnsNewestFirst(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeDamage, "primera incidencia")
	ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeDelay, "segunda incidencia")
	ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeOpen, "tercera incidencia")

	incidents, err := ts.incidentSvc.GetIncidents(ship.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(incidents) != 3 {
		t.Fatalf("expected 3 incidents, got %d", len(incidents))
	}
	if !incidents[0].CreatedAt.After(incidents[1].CreatedAt) && !incidents[0].CreatedAt.Equal(incidents[1].CreatedAt) {
		t.Error("incidents should be sorted newest-first")
	}
}

func TestReportIncident_GeneratesDomainEvent(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	ts.incidentSvc.ReportIncident(ship.TrackingID, "operator", model.IncidentTypeLoss, "paquete perdido")

	events, err := ts.shipmentRepo.GetEvents(ship.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error loading events: %v", err)
	}
	var found bool
	for _, e := range events {
		if e.EventType == model.EventIncidentReported {
			found = true
			if e.ChangedBy != "operator" {
				t.Errorf("event ChangedBy = %q, want operator", e.ChangedBy)
			}
			if e.Notes != "paquete perdido" {
				t.Errorf("event Notes = %q, want description", e.Notes)
			}
		}
	}
	if !found {
		t.Errorf("expected an %q domain event; got events: %v", model.EventIncidentReported, events)
	}
}
