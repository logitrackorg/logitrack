package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresPaymentRepository struct {
	db *sql.DB
}

func NewPostgresPaymentRepository(db *sql.DB) PaymentRepository {
	return &postgresPaymentRepository{db: db}
}

func (r *postgresPaymentRepository) Create(p model.Payment) error {
	_, err := r.db.Exec(`
		INSERT INTO payments (id, tracking_id, mp_preference_id, init_point, amount, currency, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		p.ID, p.TrackingID, p.MPPreferenceID, p.InitPoint,
		p.Amount, p.Currency, string(p.Status), p.CreatedAt,
	)
	return err
}

func (r *postgresPaymentRepository) GetByTrackingID(trackingID string) (model.Payment, error) {
	row := r.db.QueryRow(`
		SELECT id, tracking_id, mp_preference_id, mp_payment_id, init_point,
		       amount, currency, status, created_at, approved_at, abandoned_at, abandoned_reason
		FROM payments
		WHERE tracking_id = $1
		ORDER BY created_at DESC
		LIMIT 1`, trackingID)
	return scanPayment(row)
}

func (r *postgresPaymentRepository) GetActiveByTrackingID(trackingID string) (model.Payment, error) {
	row := r.db.QueryRow(`
		SELECT id, tracking_id, mp_preference_id, mp_payment_id, init_point,
		       amount, currency, status, created_at, approved_at, abandoned_at, abandoned_reason
		FROM payments
		WHERE tracking_id = $1 AND status = 'pending'
		ORDER BY created_at DESC
		LIMIT 1`, trackingID)
	return scanPayment(row)
}

func (r *postgresPaymentRepository) MarkApproved(paymentID, mpPaymentID, newTrackingID string, ts time.Time) error {
	res, err := r.db.Exec(`
		UPDATE payments
		SET status = 'approved', mp_payment_id = $1, tracking_id = $2, approved_at = $3
		WHERE id = $4`,
		mpPaymentID, newTrackingID, ts, paymentID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("payment %s no encontrado", paymentID)
	}
	return nil
}

func (r *postgresPaymentRepository) MarkAbandoned(paymentID, reason string, ts time.Time) error {
	res, err := r.db.Exec(`
		UPDATE payments
		SET status = 'abandoned', abandoned_at = $1, abandoned_reason = $2
		WHERE id = $3`,
		ts, reason, paymentID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("payment %s no encontrado", paymentID)
	}
	return nil
}

func (r *postgresPaymentRepository) UpdateTrackingID(oldTrackingID, newTrackingID string) error {
	_, err := r.db.Exec(`UPDATE payments SET tracking_id = $1 WHERE tracking_id = $2`,
		newTrackingID, oldTrackingID)
	return err
}

func (r *postgresPaymentRepository) ListExpired(cutoff time.Time) ([]model.Payment, error) {
	rows, err := r.db.Query(`
		SELECT id, tracking_id, mp_preference_id, mp_payment_id, init_point,
		       amount, currency, status, created_at, approved_at, abandoned_at, abandoned_reason
		FROM payments
		WHERE status = 'pending' AND created_at < $1`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var payments []model.Payment
	for rows.Next() {
		p, err := scanPaymentRow(rows)
		if err != nil {
			return nil, err
		}
		payments = append(payments, p)
	}
	return payments, rows.Err()
}

func (r *postgresPaymentRepository) RecordWebhookEvent(mpPaymentID string, rawPayload []byte) (bool, error) {
	res, err := r.db.Exec(`
		INSERT INTO payment_events (mp_payment_id, raw_payload)
		VALUES ($1, $2)
		ON CONFLICT (mp_payment_id) DO NOTHING`,
		mpPaymentID, rawPayload,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func scanPayment(row *sql.Row) (model.Payment, error) {
	var p model.Payment
	var mpPaymentID sql.NullString
	var approvedAt, abandonedAt sql.NullTime
	err := row.Scan(
		&p.ID, &p.TrackingID, &p.MPPreferenceID, &mpPaymentID, &p.InitPoint,
		&p.Amount, &p.Currency, &p.Status, &p.CreatedAt, &approvedAt, &abandonedAt, &p.AbandonedReason,
	)
	if err != nil {
		return model.Payment{}, err
	}
	if mpPaymentID.Valid {
		p.MPPaymentID = &mpPaymentID.String
	}
	if approvedAt.Valid {
		p.ApprovedAt = &approvedAt.Time
	}
	if abandonedAt.Valid {
		p.AbandonedAt = &abandonedAt.Time
	}
	return p, nil
}

func scanPaymentRow(rows *sql.Rows) (model.Payment, error) {
	var p model.Payment
	var mpPaymentID sql.NullString
	var approvedAt, abandonedAt sql.NullTime
	err := rows.Scan(
		&p.ID, &p.TrackingID, &p.MPPreferenceID, &mpPaymentID, &p.InitPoint,
		&p.Amount, &p.Currency, &p.Status, &p.CreatedAt, &approvedAt, &abandonedAt, &p.AbandonedReason,
	)
	if err != nil {
		return model.Payment{}, err
	}
	if mpPaymentID.Valid {
		p.MPPaymentID = &mpPaymentID.String
	}
	if approvedAt.Valid {
		p.ApprovedAt = &approvedAt.Time
	}
	if abandonedAt.Valid {
		p.AbandonedAt = &abandonedAt.Time
	}
	return p, nil
}
