package repository

import (
	"errors"

	"github.com/logitrack/core/internal/model"
)

var ErrClaimNotFound = errors.New("reclamo no encontrado")

type ClaimRepository interface {
	Create(claim model.Claim) error
	GetByID(id string) (model.Claim, error)
}
