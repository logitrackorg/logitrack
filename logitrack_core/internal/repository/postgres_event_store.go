package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresEventStore struct {
	db *sql.DB
}

func NewPostgresEventStore(db *sql.DB) EventStore {
	return &postgresEventStore{db: db}
}

func (s *postgresEventStore) Append(event model.DomainEvent) error {
	if event.EventType == model.EventDraftConfirmed {
		return s.applyDraftConfirmed(event)
	}
	if event.EventType == model.EventPaymentConfirmed {
		return s.applyPaymentConfirmed(event)
	}

	payload, err := marshalPayload(event.Payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	_, err = s.db.Exec(`
		INSERT INTO events (id, tracking_id, event_type, payload, changed_by, timestamp, version)
		VALUES ($1, $2, $3, $4, $5, $6,
			(SELECT COALESCE(MAX(version), 0) + 1 FROM events WHERE tracking_id = $2)
		)`,
		event.ID, event.TrackingID, event.EventType, payload, event.ChangedBy, event.Timestamp,
	)
	return err
}

func (s *postgresEventStore) applyDraftConfirmed(event model.DomainEvent) error {
	payload, ok := event.Payload.(model.DraftConfirmedPayload)
	if !ok {
		return fmt.Errorf("invalid payload for draft_confirmed event")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Retag all prior draft events with the new tracking ID
	if _, err := tx.Exec(
		`UPDATE events SET tracking_id = $1 WHERE tracking_id = $2`,
		payload.NewTrackingID, payload.OldTrackingID,
	); err != nil {
		return err
	}

	// Append the confirmation event itself
	raw, err := marshalPayload(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO events (id, tracking_id, event_type, payload, changed_by, timestamp, version)
		VALUES ($1, $2, $3, $4, $5, $6,
			(SELECT COALESCE(MAX(version), 0) + 1 FROM events WHERE tracking_id = $2)
		)`,
		event.ID, payload.NewTrackingID, event.EventType, raw, event.ChangedBy, event.Timestamp,
	); err != nil {
		return err
	}

	return tx.Commit()
}

// applyPaymentConfirmed retags all prior events (BORRADOR-xxx → LT-xxx) and appends
// the payment_confirmed event under the new tracking ID — same pattern as applyDraftConfirmed.
func (s *postgresEventStore) applyPaymentConfirmed(event model.DomainEvent) error {
	payload, ok := event.Payload.(model.PaymentConfirmedPayload)
	if !ok {
		return fmt.Errorf("invalid payload for payment_confirmed event")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Retag all prior events (draft + payment_requested) with the new tracking ID.
	if _, err := tx.Exec(
		`UPDATE events SET tracking_id = $1 WHERE tracking_id = $2`,
		payload.NewTrackingID, payload.OldTrackingID,
	); err != nil {
		return err
	}

	// Append the confirmation event itself under the new tracking ID.
	raw, err := marshalPayload(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO events (id, tracking_id, event_type, payload, changed_by, timestamp, version)
		VALUES ($1, $2, $3, $4, $5, $6,
			(SELECT COALESCE(MAX(version), 0) + 1 FROM events WHERE tracking_id = $2)
		)`,
		event.ID, payload.NewTrackingID, event.EventType, raw, event.ChangedBy, event.Timestamp,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *postgresEventStore) LoadStream(trackingID string) ([]model.DomainEvent, error) {
	rows, err := s.db.Query(`
		SELECT 
			id, tracking_id, event_type, payload, changed_by, timestamp, version,
			current_location_type, current_location_code, current_location_name, current_location_status,
			rescheduled_date, via
		FROM events
		WHERE tracking_id = $1
		ORDER BY version ASC`,
		trackingID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []model.DomainEvent
	for rows.Next() {
		var (
			e           model.DomainEvent
			payloadJSON []byte
			ts          time.Time
			// ✅ NUEVOS CAMPOS
			currentLocType   sql.NullString
			currentLocCode   sql.NullString
			currentLocName   sql.NullString
			currentLocStatus sql.NullString
			rescheduledDate  sql.NullTime
			via              sql.NullString
		)
		
		if err := rows.Scan(
			&e.ID, &e.TrackingID, &e.EventType, &payloadJSON, &e.ChangedBy, &ts, &e.Version,
			&currentLocType, &currentLocCode, &currentLocName, &currentLocStatus,
			&rescheduledDate, &via,
		); err != nil {
			return nil, err
		}
		
		e.Timestamp = ts
		e.Payload, err = unmarshalPayload(e.EventType, payloadJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal payload for event %s: %w", e.ID, err)
		}
		
		// ✅ NUEVO: Si es un evento de reprogramación, agregar los campos del evento
		if e.EventType == model.EventDeliveryRescheduled {
			if payload, ok := e.Payload.(model.DeliveryRescheduledPayload); ok {
				// Si hay ubicación en las columnas, usarla (sobrescribe la del payload)
				if currentLocType.Valid {
					payload.CurrentLocation = &model.EventLocation{
						Type:       currentLocType.String,
						BranchCode: currentLocCode.String,
						BranchName: currentLocName.String,
						Status:     currentLocStatus.String,
					}
				}
				if rescheduledDate.Valid {
					payload.NewDeliveryDate = rescheduledDate.Time
				}
				if via.Valid {
					payload.RequestedVia = via.String
				}
				e.Payload = payload
			}
		}
		
		events = append(events, e)
	}
	if len(events) == 0 {
		return nil, fmt.Errorf("stream not found: %s", trackingID)
	}
	return events, rows.Err()
}

func (s *postgresEventStore) LoadAll() ([]model.DomainEvent, error) {
	rows, err := s.db.Query(`
		SELECT 
			id, tracking_id, event_type, payload, changed_by, timestamp, version,
			current_location_type, current_location_code, current_location_name, current_location_status,
			rescheduled_date, via
		FROM events
		ORDER BY timestamp ASC, version ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []model.DomainEvent
	for rows.Next() {
		var (
			e           model.DomainEvent
			payloadJSON []byte
			ts          time.Time
			currentLocType   sql.NullString
			currentLocCode   sql.NullString
			currentLocName   sql.NullString
			currentLocStatus sql.NullString
			rescheduledDate  sql.NullTime
			via              sql.NullString
		)
		
		if err := rows.Scan(
			&e.ID, &e.TrackingID, &e.EventType, &payloadJSON, &e.ChangedBy, &ts, &e.Version,
			&currentLocType, &currentLocCode, &currentLocName, &currentLocStatus,
			&rescheduledDate, &via,
		); err != nil {
			return nil, err
		}
		
		e.Timestamp = ts
		e.Payload, err = unmarshalPayload(e.EventType, payloadJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal payload for event %s: %w", e.ID, err)
		}
		
		// ✅ NUEVO: Enriquecer eventos de reprogramación
		if e.EventType == model.EventDeliveryRescheduled {
			if payload, ok := e.Payload.(model.DeliveryRescheduledPayload); ok {
				if currentLocType.Valid {
					payload.CurrentLocation = &model.EventLocation{
						Type:       currentLocType.String,
						BranchCode: currentLocCode.String,
						BranchName: currentLocName.String,
						Status:     currentLocStatus.String,
					}
				}
				if rescheduledDate.Valid {
					payload.NewDeliveryDate = rescheduledDate.Time
				}
				if via.Valid {
					payload.RequestedVia = via.String
				}
				e.Payload = payload
			}
		}
		
		events = append(events, e)
	}
	return events, rows.Err()
}

// marshalPayload converts a typed event payload to JSON bytes.
func marshalPayload(payload interface{}) ([]byte, error) {
	if payload == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(payload)
}

// unmarshalPayload converts JSON bytes back to the correct typed payload based on event type.
func unmarshalPayload(eventType string, data []byte) (interface{}, error) {
	switch eventType {
	case model.EventShipmentCreated:
		var p model.ShipmentCreatedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventDraftSaved:
		var p model.DraftSavedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventDraftUpdated:
		var p model.DraftUpdatedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventDraftConfirmed:
		var p model.DraftConfirmedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventStatusChanged:
		var p model.StatusChangedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventShipmentCorrected:
		var p model.ShipmentCorrectedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventShipmentCancelled:
		var p model.ShipmentCancelledPayload
		return p, json.Unmarshal(data, &p)
	case model.EventIncidentReported:
		var p model.IncidentReportedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventShipmentETAExtended:
		var p model.ShipmentETAExtendedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventPaymentRequested:
		var p model.PaymentRequestedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventPaymentConfirmed:
		var p model.PaymentConfirmedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventReturnedToDraft:
		var p model.ReturnedToDraftPayload
		return p, json.Unmarshal(data, &p)
	case model.EventPickupRequested:
		var p model.PickupRequestedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventDeliveryRescheduled:
		var p model.DeliveryRescheduledPayload
		return p, json.Unmarshal(data, &p)
	case model.EventCancelledByRecipient:
		var p model.CancelledByRecipientPayload
		return p, json.Unmarshal(data, &p)
	default:
		return nil, fmt.Errorf("unknown event type: %s", eventType)
	}
}
