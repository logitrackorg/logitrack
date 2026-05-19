package model

import "time"

type PaymentStatus string

const (
	PaymentStatusPending   PaymentStatus = "pending"   // preference creada, esperando webhook
	PaymentStatusApproved  PaymentStatus = "approved"  // webhook confirmó pago
	PaymentStatusAbandoned PaymentStatus = "abandoned" // operador volvió a draft o expiró
)

type Payment struct {
	ID              string        `json:"id"`
	TrackingID      string        `json:"tracking_id"`               // BORRADOR-XXX al crear, LT-XXX al aprobar
	MPPreferenceID  string        `json:"mp_preference_id"`
	MPPaymentID     *string       `json:"mp_payment_id,omitempty"`   // se llena al aprobar
	InitPoint       string        `json:"init_point"`                // URL de pago MP (vacío en mock)
	Amount          float64       `json:"amount"`
	Currency        string        `json:"currency"`
	Status          PaymentStatus `json:"status"`
	CreatedAt       time.Time     `json:"created_at"`
	ApprovedAt      *time.Time    `json:"approved_at,omitempty"`
	AbandonedAt     *time.Time    `json:"abandoned_at,omitempty"`
	AbandonedReason string        `json:"abandoned_reason,omitempty"` // "back_to_draft" | "expired"
	// SimulateEnabled no se persiste — se inyecta en runtime según MP_SIMULATE_ENABLED.
	SimulateEnabled bool          `json:"simulate_enabled,omitempty"`
}
