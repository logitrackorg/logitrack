package projection

import "github.com/logitrack/core/internal/model"

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
}
