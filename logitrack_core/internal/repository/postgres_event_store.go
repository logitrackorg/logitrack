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

func (s *postgresEventStore) LoadStream(trackingID string) ([]model.DomainEvent, error) {
	rows, err := s.db.Query(`
		SELECT id, tracking_id, event_type, payload, changed_by, timestamp, version
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
		)
		if err := rows.Scan(&e.ID, &e.TrackingID, &e.EventType, &payloadJSON, &e.ChangedBy, &ts, &e.Version); err != nil {
			return nil, err
		}
		e.Timestamp = ts
		e.Payload, err = unmarshalPayload(e.EventType, payloadJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal payload for event %s: %w", e.ID, err)
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
		SELECT id, tracking_id, event_type, payload, changed_by, timestamp, version
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
		)
		if err := rows.Scan(&e.ID, &e.TrackingID, &e.EventType, &payloadJSON, &e.ChangedBy, &ts, &e.Version); err != nil {
			return nil, err
		}
		e.Timestamp = ts
		e.Payload, err = unmarshalPayload(e.EventType, payloadJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal payload for event %s: %w", e.ID, err)
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
	default:
		return nil, fmt.Errorf("unknown event type: %s", eventType)
	}
}
