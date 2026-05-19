package repository

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
)

// DraftLifecycleRepository handles draft expiration, PII purge, and audit logging
// to satisfy Ley 25.326 compliance requirements.
type DraftLifecycleRepository interface {
	// ExpireDrafts transitions all drafts older than cutoff to status "expired".
	// Returns the tracking IDs of the newly-expired drafts.
	ExpireDrafts(cutoff time.Time) ([]string, error)

	// PurgeDraftPII anonymizes personal data (name, DNI, email, phone, address)
	// in expired drafts whose status was set before purgeCutoff.
	// Returns the tracking IDs of purged drafts.
	PurgeDraftPII(purgeCutoff time.Time) ([]string, error)

	// FindDraftsByDNI returns all drafts (active or expired, with PII intact)
	// that reference the given DNI in sender or recipient. Used for CA-04 ARCO.
	FindDraftsByDNI(dni string) ([]model.Shipment, error)

	// SuppressPII immediately anonymizes PII in the given draft. Used for CA-04.
	SuppressPII(trackingID string) error

	// AppendAuditLog writes a single audit entry to the draft_audit_log table.
	AppendAuditLog(entry model.DraftAuditEntry) error

	// ListAuditLog returns all audit entries for a specific tracking ID.
	ListAuditLog(trackingID string) ([]model.DraftAuditEntry, error)

	// ListAllAuditLog returns all audit entries ordered by timestamp DESC (admin view).
	ListAllAuditLog() ([]model.DraftAuditEntry, error)
}

type postgresDraftLifecycleRepository struct {
	db *sql.DB
}

func NewPostgresDraftLifecycleRepository(db *sql.DB) DraftLifecycleRepository {
	return &postgresDraftLifecycleRepository{db: db}
}

func (r *postgresDraftLifecycleRepository) ExpireDrafts(cutoff time.Time) ([]string, error) {
	rows, err := r.db.Query(`
		UPDATE shipments
		SET    status     = 'expired',
		       updated_at = NOW()
		WHERE  status     = 'draft'
		  AND  created_at < $1
		RETURNING tracking_id
	`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *postgresDraftLifecycleRepository) PurgeDraftPII(purgeCutoff time.Time) ([]string, error) {
	// Anonymize only expired drafts where pii_purged_at is still NULL
	// and whose status was set to expired before purgeCutoff.
	// We use updated_at as the expiration timestamp (set by ExpireDrafts).
	rows, err := r.db.Query(`
		UPDATE shipments
		SET
			sender = jsonb_build_object(
				'name',  '[suprimido]',
				'dni',   '[suprimido]',
				'email', '[suprimido]',
				'phone', '[suprimido]',
				'address', jsonb_build_object(
					'street',      '[suprimido]',
					'city',        COALESCE(sender->'address'->>'city', ''),
					'province',    COALESCE(sender->'address'->>'province', ''),
					'postal_code', ''
				)
			),
			recipient = jsonb_build_object(
				'name',  '[suprimido]',
				'dni',   '[suprimido]',
				'email', '[suprimido]',
				'phone', '[suprimido]',
				'address', jsonb_build_object(
					'street',      '[suprimido]',
					'city',        COALESCE(recipient->'address'->>'city', ''),
					'province',    COALESCE(recipient->'address'->>'province', ''),
					'postal_code', ''
				)
			),
			pii_purged_at = NOW(),
			updated_at    = NOW()
		WHERE  status        = 'expired'
		  AND  pii_purged_at IS NULL
		  AND  updated_at    < $1
		RETURNING tracking_id
	`, purgeCutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *postgresDraftLifecycleRepository) FindDraftsByDNI(dni string) ([]model.Shipment, error) {
	rows, err := r.db.Query(`
		SELECT tracking_id, status, sender, recipient, created_at, updated_at
		FROM   shipments
		WHERE  status IN ('draft', 'expired')
		  AND  pii_purged_at IS NULL
		  AND  (sender->>'dni' = $1 OR recipient->>'dni' = $1)
		ORDER  BY created_at DESC
	`, dni)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []model.Shipment
	for rows.Next() {
		var s model.Shipment
		var senderJSON, recipientJSON []byte
		if err := rows.Scan(&s.TrackingID, &s.Status, &senderJSON, &recipientJSON, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(senderJSON, &s.Sender)
		_ = json.Unmarshal(recipientJSON, &s.Recipient)
		results = append(results, s)
	}
	return results, rows.Err()
}

func (r *postgresDraftLifecycleRepository) SuppressPII(trackingID string) error {
	_, err := r.db.Exec(`
		UPDATE shipments
		SET
			sender = jsonb_build_object(
				'name',  '[suprimido]',
				'dni',   '[suprimido]',
				'email', '[suprimido]',
				'phone', '[suprimido]',
				'address', jsonb_build_object(
					'street',      '[suprimido]',
					'city',        COALESCE(sender->'address'->>'city', ''),
					'province',    COALESCE(sender->'address'->>'province', ''),
					'postal_code', ''
				)
			),
			recipient = jsonb_build_object(
				'name',  '[suprimido]',
				'dni',   '[suprimido]',
				'email', '[suprimido]',
				'phone', '[suprimido]',
				'address', jsonb_build_object(
					'street',      '[suprimido]',
					'city',        COALESCE(recipient->'address'->>'city', ''),
					'province',    COALESCE(recipient->'address'->>'province', ''),
					'postal_code', ''
				)
			),
			pii_purged_at = NOW(),
			updated_at    = NOW()
		WHERE tracking_id = $1
		  AND status IN ('draft', 'expired')
		  AND pii_purged_at IS NULL
	`, trackingID)
	return err
}

func (r *postgresDraftLifecycleRepository) AppendAuditLog(entry model.DraftAuditEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.NewString()
	}
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now().UTC()
	}
	details, _ := json.Marshal(entry.Details)

	_, err := r.db.Exec(`
		INSERT INTO draft_audit_log (id, tracking_id, action, performed_by, timestamp, details)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, entry.ID, entry.TrackingID, entry.Action, entry.PerformedBy, entry.Timestamp, details)
	return err
}

func (r *postgresDraftLifecycleRepository) ListAuditLog(trackingID string) ([]model.DraftAuditEntry, error) {
	return r.queryAuditLog(`
		SELECT id, tracking_id, action, performed_by, timestamp, details
		FROM   draft_audit_log
		WHERE  tracking_id = $1
		ORDER  BY timestamp DESC
	`, trackingID)
}

func (r *postgresDraftLifecycleRepository) ListAllAuditLog() ([]model.DraftAuditEntry, error) {
	return r.queryAuditLog(`
		SELECT id, tracking_id, action, performed_by, timestamp, details
		FROM   draft_audit_log
		ORDER  BY timestamp DESC
		LIMIT  500
	`)
}

func (r *postgresDraftLifecycleRepository) queryAuditLog(query string, args ...interface{}) ([]model.DraftAuditEntry, error) {
	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []model.DraftAuditEntry
	for rows.Next() {
		var e model.DraftAuditEntry
		var detailsJSON []byte
		if err := rows.Scan(&e.ID, &e.TrackingID, &e.Action, &e.PerformedBy, &e.Timestamp, &detailsJSON); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(detailsJSON, &e.Details)
		entries = append(entries, e)
	}
	return entries, rows.Err()
}
