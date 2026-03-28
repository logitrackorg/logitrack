package projection

import "github.com/logitrack/core/internal/model"

// Projector is the interface implemented by both the in-memory and PostgreSQL shipment projections.
type Projector interface {
	Apply(event model.DomainEvent)
	Rebuild(events []model.DomainEvent)
	Get(trackingID string) (model.Shipment, error)
	List(filter model.ShipmentFilter) ([]model.Shipment, error)
	Search(query string) ([]model.Shipment, error)
	Stats() (model.Stats, error)
}
