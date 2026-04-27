package repository

import "github.com/logitrack/core/internal/model"

type IncidentRepository interface {
	ReportIncident(incident model.ShipmentIncident) error
	GetIncidents(trackingID string) ([]model.ShipmentIncident, error)
}
