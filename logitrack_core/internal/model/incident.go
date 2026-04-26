package model

import "time"

type IncidentType string

const (
	IncidentTypeDamage  IncidentType = "daño"
	IncidentTypeLoss    IncidentType = "perdida"
	IncidentTypeDelay   IncidentType = "demora"
	IncidentTypeOpen    IncidentType = "paquete_abierto"
	IncidentTypeOther   IncidentType = "otro"
)

var ValidIncidentTypes = map[IncidentType]bool{
	IncidentTypeDamage: true,
	IncidentTypeLoss:   true,
	IncidentTypeDelay:  true,
	IncidentTypeOpen:   true,
	IncidentTypeOther:  true,
}

type ShipmentIncident struct {
	ID           string       `json:"id"`
	TrackingID   string       `json:"tracking_id"`
	IncidentType IncidentType `json:"incident_type"`
	Description  string       `json:"description"`
	ReportedBy   string       `json:"reported_by"`
	CreatedAt    time.Time    `json:"created_at"`
}

type ReportIncidentRequest struct {
	IncidentType IncidentType `json:"incident_type" binding:"required"`
	Description  string       `json:"description"   binding:"required"`
}
