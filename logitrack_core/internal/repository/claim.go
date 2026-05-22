package repository

import (
	"errors"
	"time"

	"github.com/logitrack/core/internal/model"
)

var ErrClaimNotFound = errors.New("reclamo no encontrado")

type ClaimRepository interface {
	Create(claim model.Claim) error
	GetByID(id string) (model.Claim, error)
	ListAll() ([]model.Claim, error)
	UpdateCategory(id string, category model.ClaimCategory, status model.ClaimStatus, updatedAt time.Time) error
	Resolve(id string, resolutionType model.ClaimResolutionType, status model.ClaimStatus, updatedAt time.Time) error
}
