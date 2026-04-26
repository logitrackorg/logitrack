package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
)

type IncidentService struct {
	incidentRepo repository.IncidentRepository
	shipmentRepo repository.ShipmentRepository
	eventStore   repository.EventStore
	projection   projection.Projector
}

func NewIncidentService(
	incidentRepo repository.IncidentRepository,
	shipmentRepo repository.ShipmentRepository,
	eventStore repository.EventStore,
	proj projection.Projector,
) *IncidentService {
	return &IncidentService{
		incidentRepo: incidentRepo,
		shipmentRepo: shipmentRepo,
		eventStore:   eventStore,
		projection:   proj,
	}
}

func (s *IncidentService) ReportIncident(trackingID, reportedBy string, incidentType model.IncidentType, description string) (model.ShipmentIncident, error) {
	shipment, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return model.ShipmentIncident{}, fmt.Errorf("envío no encontrado")
	}
	if shipment.Status == model.StatusDelivered || shipment.Status == model.StatusReturned || shipment.Status == model.StatusCancelled {
		return model.ShipmentIncident{}, fmt.Errorf("el envío se encuentra en un estado terminal que no admite nuevas incidencias")
	}
	if !model.ValidIncidentTypes[incidentType] {
		return model.ShipmentIncident{}, fmt.Errorf("tipo de incidencia no válido")
	}
	if strings.TrimSpace(description) == "" {
		return model.ShipmentIncident{}, fmt.Errorf("la descripción es requerida")
	}

	now := time.Now().UTC()
	incident := model.ShipmentIncident{
		ID:           uuid.NewString(),
		TrackingID:   trackingID,
		IncidentType: incidentType,
		Description:  description,
		ReportedBy:   reportedBy,
		CreatedAt:    now,
	}

	if err := s.incidentRepo.ReportIncident(incident); err != nil {
		return model.ShipmentIncident{}, err
	}

	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: trackingID,
		EventType:  model.EventIncidentReported,
		Payload:    model.IncidentReportedPayload{IncidentType: incidentType, Description: description},
		ChangedBy:  reportedBy,
		Timestamp:  now,
	}
	if err := s.eventStore.Append(event); err != nil {
		return model.ShipmentIncident{}, err
	}
	s.projection.Apply(event)

	return incident, nil
}

func (s *IncidentService) GetIncidents(trackingID string) ([]model.ShipmentIncident, error) {
	if _, err := s.shipmentRepo.GetByTrackingID(trackingID); err != nil {
		return nil, fmt.Errorf("envío no encontrado")
	}
	return s.incidentRepo.GetIncidents(trackingID)
}
