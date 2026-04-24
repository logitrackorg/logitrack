package repository

import "github.com/logitrack/core/internal/model"

// EventStore is the append-only log of domain events.
type EventStore interface {
	Append(event model.DomainEvent) error
	LoadStream(trackingID string) ([]model.DomainEvent, error)
	LoadAll() ([]model.DomainEvent, error)
}
