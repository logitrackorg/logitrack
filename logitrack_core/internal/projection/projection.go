package projection

import (
	"time"

	"github.com/logitrack/core/internal/model"
)

// Projector is the interface implemented by both the in-memory and PostgreSQL shipment projections.
type Projector interface {
	Apply(event model.DomainEvent)
	Rebuild(events []model.DomainEvent)
	Get(trackingID string) (model.Shipment, error)
	List(filter model.ShipmentFilter) ([]model.Shipment, error)
	Search(query string) ([]model.Shipment, error)
	Stats(filter model.ShipmentFilter) (model.Stats, error)
	// ReserveForTrip marca el envío como reservado por un trip multi-hop
	// (para pickup cross-branch). Opera solo sobre la proyección, no event-sourced.
	ReserveForTrip(trackingID, tripID string) error
	// ReleaseFromTrip libera la reserva del envío.
	ReleaseFromTrip(trackingID string) error
	// SetSLANotified actualiza sla_notified_at del envío (nil = resetear, &t = marcar notificado).
	SetSLANotified(trackingID string, notifiedAt *time.Time) error
	// SetSLAExpiredNotified actualiza sla_expired_notified_at del envío.
	SetSLAExpiredNotified(trackingID string, notifiedAt *time.Time) error
	// SetConfirmationEmailSent marca el envío como notificado por email (CA-05 dedup).
	// Devuelve true si fue el primer llamado (UPDATE afectó una fila).
	SetConfirmationEmailSent(trackingID string) (bool, error)
}
