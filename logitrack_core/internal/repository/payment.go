package repository

import (
	"time"

	"github.com/logitrack/core/internal/model"
)

// PaymentRepository manages payment records linked to shipments.
type PaymentRepository interface {
	Create(p model.Payment) error
	GetByTrackingID(trackingID string) (model.Payment, error)
	GetActiveByTrackingID(trackingID string) (model.Payment, error) // status=pending only
	MarkApproved(paymentID, mpPaymentID, newTrackingID string, ts time.Time, method model.PaymentMethod) error
	MarkAbandoned(paymentID, reason string, ts time.Time) error
	UpdateTrackingID(oldTrackingID, newTrackingID string) error
	ListExpired(cutoff time.Time) ([]model.Payment, error)
	// RecordWebhookEvent inserts the mp_payment_id for idempotency.
	// Returns (true, nil) when inserted, (false, nil) when already existed.
	RecordWebhookEvent(mpPaymentID string, rawPayload []byte) (bool, error)
}
