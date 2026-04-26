package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type postgresIncidentRepository struct {
	db *sql.DB
}

func NewPostgresIncidentRepository(db *sql.DB) IncidentRepository {
	return &postgresIncidentRepository{db: db}
}

func (r *postgresIncidentRepository) ReportIncident(incident model.ShipmentIncident) error {
	_, err := r.db.Exec(
		`INSERT INTO shipment_incidents (id, tracking_id, incident_type, description, reported_by, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		incident.ID, incident.TrackingID, string(incident.IncidentType),
		incident.Description, incident.ReportedBy, incident.CreatedAt,
	)
	return err
}

func (r *postgresIncidentRepository) GetIncidents(trackingID string) ([]model.ShipmentIncident, error) {
	rows, err := r.db.Query(
		`SELECT id, tracking_id, incident_type, description, reported_by, created_at
		 FROM shipment_incidents WHERE tracking_id = $1 ORDER BY created_at DESC`,
		trackingID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []model.ShipmentIncident
	for rows.Next() {
		var inc model.ShipmentIncident
		var incidentType string
		if err := rows.Scan(&inc.ID, &inc.TrackingID, &incidentType, &inc.Description, &inc.ReportedBy, &inc.CreatedAt); err == nil {
			inc.IncidentType = model.IncidentType(incidentType)
			result = append(result, inc)
		}
	}
	return result, nil
}
