package projection

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

// PostgresShipmentProjection is a write-through materialized view backed by PostgreSQL.
// It mirrors the interface of ShipmentProjection but persists state in the shipments table.
type PostgresShipmentProjection struct {
	db *sql.DB
}

func NewPostgresShipmentProjection(db *sql.DB) *PostgresShipmentProjection {
	return &PostgresShipmentProjection{db: db}
}

// Apply updates the projection for a single event. Called after every Append.
func (p *PostgresShipmentProjection) Apply(event model.DomainEvent) {
	// Errors are logged but not returned — projection failures are not fatal for writes.
	if err := p.apply(event); err != nil {
		fmt.Printf("projection apply error [%s %s]: %v\n", event.EventType, event.TrackingID, err)
	}
}

func (p *PostgresShipmentProjection) apply(event model.DomainEvent) error {
	switch event.EventType {
	case model.EventShipmentCreated:
		payload := event.Payload.(model.ShipmentCreatedPayload)
		return p.upsertShipment(payload.Shipment)

	case model.EventDraftSaved:
		payload := event.Payload.(model.DraftSavedPayload)
		return p.upsertShipment(payload.Shipment)

	case model.EventDraftUpdated:
		payload := event.Payload.(model.DraftUpdatedPayload)
		return p.upsertShipment(payload.Shipment)

	case model.EventDraftConfirmed:
		payload := event.Payload.(model.DraftConfirmedPayload)
		_, err := p.db.Exec(`
			UPDATE shipments
			SET tracking_id = $1, status = $2, updated_at = $3
			WHERE tracking_id = $4`,
			payload.NewTrackingID, string(model.StatusInProgress), event.Timestamp, payload.OldTrackingID,
		)
		return err

	case model.EventStatusChanged:
		payload := event.Payload.(model.StatusChangedPayload)
		if payload.ToStatus == model.StatusDelivered {
			_, err := p.db.Exec(`
				UPDATE shipments
				SET status = $1, updated_at = $2, delivered_at = $3
				WHERE tracking_id = $4`,
				string(payload.ToStatus), event.Timestamp, event.Timestamp, event.TrackingID,
			)
			return err
		}
		if payload.Location != "" {
			_, err := p.db.Exec(`
				UPDATE shipments
				SET status = $1, current_location = $2, updated_at = $3
				WHERE tracking_id = $4`,
				string(payload.ToStatus), payload.Location, event.Timestamp, event.TrackingID,
			)
			return err
		}
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(payload.ToStatus), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventShipmentCorrected:
		payload := event.Payload.(model.ShipmentCorrectedPayload)
		// Read current corrections, merge, write back
		var raw []byte
		err := p.db.QueryRow(
			`SELECT COALESCE(corrections, 'null') FROM shipments WHERE tracking_id = $1`,
			event.TrackingID,
		).Scan(&raw)
		if err != nil {
			return err
		}
		var current model.ShipmentCorrections
		if string(raw) != "null" {
			if err := json.Unmarshal(raw, &current); err != nil {
				return err
			}
		}
		current.Merge(payload.Corrections)
		merged, err := json.Marshal(current)
		if err != nil {
			return err
		}
		_, err = p.db.Exec(`
			UPDATE shipments SET corrections = $1, updated_at = $2 WHERE tracking_id = $3`,
			merged, event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventShipmentCancelled:
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(model.StatusCancelled), event.Timestamp, event.TrackingID,
		)
		return err
	}
	return nil
}

func (p *PostgresShipmentProjection) upsertShipment(s model.Shipment) error {
	sender, err := json.Marshal(s.Sender)
	if err != nil {
		return err
	}
	recipient, err := json.Marshal(s.Recipient)
	if err != nil {
		return err
	}
	var corrections []byte
	if s.Corrections != nil {
		corrections, err = json.Marshal(s.Corrections)
		if err != nil {
			return err
		}
	}

	_, err = p.db.Exec(`
		INSERT INTO shipments (
			tracking_id, status, current_location, weight_kg, package_type,
			is_fragile, special_instructions, receiving_branch_id,
			created_at, updated_at, estimated_delivery_at, delivered_at,
			sender, recipient, corrections
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (tracking_id) DO UPDATE SET
			status               = EXCLUDED.status,
			current_location     = EXCLUDED.current_location,
			weight_kg            = EXCLUDED.weight_kg,
			package_type         = EXCLUDED.package_type,
			is_fragile           = EXCLUDED.is_fragile,
			special_instructions = EXCLUDED.special_instructions,
			receiving_branch_id  = EXCLUDED.receiving_branch_id,
			updated_at           = EXCLUDED.updated_at,
			estimated_delivery_at = EXCLUDED.estimated_delivery_at,
			delivered_at         = EXCLUDED.delivered_at,
			sender               = EXCLUDED.sender,
			recipient            = EXCLUDED.recipient,
			corrections          = EXCLUDED.corrections`,
		s.TrackingID, string(s.Status), s.CurrentLocation, s.WeightKg, string(s.PackageType),
		s.IsFragile, s.SpecialInstructions, s.ReceivingBranchID,
		s.CreatedAt, s.UpdatedAt, nullableTime(s.EstimatedDeliveryAt), s.DeliveredAt,
		sender, recipient, nullableBytes(corrections),
	)
	return err
}

// Rebuild replays events into the projection. Idempotent: uses upserts, no DELETE.
// For the Postgres projection, Apply already keeps the table in sync on every write.
// Rebuild is only needed when replaying historical events (e.g., first seed run).
func (p *PostgresShipmentProjection) Rebuild(events []model.DomainEvent) {
	for _, event := range events {
		p.Apply(event)
	}
}

func (p *PostgresShipmentProjection) Get(trackingID string) (model.Shipment, error) {
	row := p.db.QueryRow(`
		SELECT tracking_id, status, current_location, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections
		FROM shipments WHERE tracking_id = $1`, trackingID)
	return scanShipment(row)
}

func (p *PostgresShipmentProjection) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	query := `
		SELECT tracking_id, status, current_location, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections
		FROM shipments WHERE 1=1`
	args := []interface{}{}
	i := 1
	if filter.DateFrom != nil {
		query += fmt.Sprintf(" AND created_at >= $%d", i)
		args = append(args, *filter.DateFrom)
		i++
	}
	if filter.DateTo != nil {
		query += fmt.Sprintf(" AND created_at <= $%d", i)
		args = append(args, *filter.DateTo)
		i++
	}
	query += " ORDER BY tracking_id ASC"

	rows, err := p.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanShipments(rows)
}

func (p *PostgresShipmentProjection) Search(query string) ([]model.Shipment, error) {
	q := "%" + strings.ToLower(query) + "%"
	rows, err := p.db.Query(`
		SELECT tracking_id, status, current_location, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections
		FROM shipments
		WHERE LOWER(tracking_id) LIKE $1
		   OR LOWER(sender->>'name') LIKE $1
		   OR LOWER(recipient->>'name') LIKE $1
		   OR LOWER(sender->'address'->>'city') LIKE $1
		   OR LOWER(recipient->'address'->>'city') LIKE $1
		ORDER BY tracking_id ASC`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanShipments(rows)
}

func (p *PostgresShipmentProjection) Stats() (model.Stats, error) {
	rows, err := p.db.Query(`SELECT status, current_location FROM shipments`)
	if err != nil {
		return model.Stats{}, err
	}
	defer rows.Close()

	stats := model.Stats{
		ByStatus: map[model.Status]int{},
		ByBranch: map[string]int{},
	}
	for rows.Next() {
		var status, location string
		if err := rows.Scan(&status, &location); err != nil {
			return model.Stats{}, err
		}
		stats.Total++
		stats.ByStatus[model.Status(status)]++
		s := model.Status(status)
		if s != model.StatusDelivered && s != model.StatusReturned && location != "" {
			stats.ByBranch[location]++
		}
	}
	return stats, rows.Err()
}

// scanShipment scans a single row into a Shipment.
func scanShipment(row *sql.Row) (model.Shipment, error) {
	var (
		s               model.Shipment
		status          string
		packageType     string
		senderJSON      []byte
		recipientJSON   []byte
		correctionsJSON []byte
		estimatedAt     *time.Time
	)
	err := row.Scan(
		&s.TrackingID, &status, &s.CurrentLocation, &s.WeightKg, &packageType,
		&s.IsFragile, &s.SpecialInstructions, &s.ReceivingBranchID,
		&s.CreatedAt, &s.UpdatedAt, &estimatedAt, &s.DeliveredAt,
		&senderJSON, &recipientJSON, &correctionsJSON,
	)
	if err == sql.ErrNoRows {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	if err != nil {
		return model.Shipment{}, err
	}
	s.Status = model.Status(status)
	s.PackageType = model.PackageType(packageType)
	if estimatedAt != nil {
		s.EstimatedDeliveryAt = *estimatedAt
	}
	if err := json.Unmarshal(senderJSON, &s.Sender); err != nil {
		return model.Shipment{}, err
	}
	if err := json.Unmarshal(recipientJSON, &s.Recipient); err != nil {
		return model.Shipment{}, err
	}
	if len(correctionsJSON) > 0 {
		var c model.ShipmentCorrections
		if err := json.Unmarshal(correctionsJSON, &c); err != nil {
			return model.Shipment{}, err
		}
		s.Corrections = &c
	}
	return s, nil
}

func scanShipments(rows *sql.Rows) ([]model.Shipment, error) {
	var result []model.Shipment
	for rows.Next() {
		var (
			s               model.Shipment
			status          string
			packageType     string
			senderJSON      []byte
			recipientJSON   []byte
			correctionsJSON []byte
			estimatedAt     *time.Time
		)
		err := rows.Scan(
			&s.TrackingID, &status, &s.CurrentLocation, &s.WeightKg, &packageType,
			&s.IsFragile, &s.SpecialInstructions, &s.ReceivingBranchID,
			&s.CreatedAt, &s.UpdatedAt, &estimatedAt, &s.DeliveredAt,
			&senderJSON, &recipientJSON, &correctionsJSON,
		)
		if err != nil {
			return nil, err
		}
		s.Status = model.Status(status)
		s.PackageType = model.PackageType(packageType)
		if estimatedAt != nil {
			s.EstimatedDeliveryAt = *estimatedAt
		}
		if err := json.Unmarshal(senderJSON, &s.Sender); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(recipientJSON, &s.Recipient); err != nil {
			return nil, err
		}
		if len(correctionsJSON) > 0 {
			var c model.ShipmentCorrections
			if err := json.Unmarshal(correctionsJSON, &c); err != nil {
				return nil, err
			}
			s.Corrections = &c
		}
		result = append(result, s)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TrackingID < result[j].TrackingID
	})
	return result, rows.Err()
}

func nullableTime(t time.Time) interface{} {
	if t.IsZero() {
		return nil
	}
	return t
}

func nullableBytes(b []byte) interface{} {
	if b == nil {
		return nil
	}
	return b
}
