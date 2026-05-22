package repository

import (
	"errors"

	"github.com/logitrack/core/internal/model"
)

var ErrClaimEventStreamNotFound = errors.New("historial de reclamo no encontrado")

type ClaimEventRepository interface {
	Append(event model.DomainEvent) error
	LoadStream(claimID string) ([]model.DomainEvent, error)
}
