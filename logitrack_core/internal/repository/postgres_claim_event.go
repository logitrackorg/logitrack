package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresClaimEventRepository struct {
	db *sql.DB
}

func NewPostgresClaimEventRepository(db *sql.DB) ClaimEventRepository {
	return &postgresClaimEventRepository{db: db}
}

func (r *postgresClaimEventRepository) Append(event model.DomainEvent) error {
	payload, err := marshalClaimPayload(event.Payload)
	if err != nil {
		return fmt.Errorf("marshal claim payload: %w", err)
	}
	// claim_id se pasa dos veces ($2 y $7): reutilizar $2 en el subquery provoca
	// "inconsistent types deduced" con database/sql + pq.
	_, err = r.db.Exec(`
		INSERT INTO claim_events (id, claim_id, event_type, payload, changed_by, timestamp, version)
		VALUES ($1, $2, $3, $4, $5, $6,
			(SELECT COALESCE(MAX(version), 0) + 1 FROM claim_events WHERE claim_id = $7)
		)`,
		event.ID, event.TrackingID, event.EventType, payload, event.ChangedBy, event.Timestamp, event.TrackingID,
	)
	return err
}

func (r *postgresClaimEventRepository) LoadStream(claimID string) ([]model.DomainEvent, error) {
	rows, err := r.db.Query(`
		SELECT id, claim_id, event_type, payload, changed_by, timestamp, version
		FROM claim_events
		WHERE claim_id = $1
		ORDER BY version ASC`,
		claimID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []model.DomainEvent
	for rows.Next() {
		var (
			e           model.DomainEvent
			claimIDCol  string
			payloadJSON []byte
			ts          time.Time
		)
		if err := rows.Scan(&e.ID, &claimIDCol, &e.EventType, &payloadJSON, &e.ChangedBy, &ts, &e.Version); err != nil {
			return nil, err
		}
		e.TrackingID = claimIDCol
		e.Timestamp = ts
		e.Payload, err = unmarshalClaimPayload(e.EventType, payloadJSON)
		if err != nil {
			return nil, fmt.Errorf("unmarshal claim payload for event %s: %w", e.ID, err)
		}
		events = append(events, e)
	}
	if len(events) == 0 {
		return nil, ErrClaimEventStreamNotFound
	}
	return events, rows.Err()
}

func marshalClaimPayload(payload interface{}) ([]byte, error) {
	if payload == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(payload)
}

func unmarshalClaimPayload(eventType string, data []byte) (interface{}, error) {
	switch eventType {
	case model.EventClaimCreated:
		var p model.ClaimCreatedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimCategoryUpdated:
		var p model.ClaimCategoryUpdatedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimResolved:
		var p model.ClaimResolvedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimPendingCustomer:
		var p model.ClaimPendingCustomerPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimInReview:
		var p model.ClaimInReviewPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimCustomerResponded:
		var p model.ClaimCustomerRespondedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimTransferred:
		var p model.ClaimTransferredPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimTransferAccepted:
		var p model.ClaimTransferAcceptedPayload
		return p, json.Unmarshal(data, &p)
	case model.EventClaimTransferRejected:
		var p model.ClaimTransferRejectedPayload
		return p, json.Unmarshal(data, &p)
	default:
		return nil, fmt.Errorf("unknown claim event type: %s", eventType)
	}
}
