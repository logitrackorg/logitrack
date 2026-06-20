package repository

import (
	"errors"
	"time"

	"github.com/logitrack/core/internal/model"
)

var ErrClaimNotFound = errors.New("reclamo no encontrado")

type ClaimRepository interface {
	NextID() (string, error)
	Create(claim model.Claim) error
	Delete(id string) error
	GetByID(id string) (model.Claim, error)
	GetLatestByTrackingID(trackingID string) (model.Claim, error)
	GetLatestByTrackingIDAndDNI(trackingID, dni string) (model.Claim, error)
	ListAll() ([]model.Claim, error)
	ListByAssignedBranch(branchID string) ([]model.Claim, error)
	Resolve(id string, resolutionType model.ClaimResolutionType, status model.ClaimStatus, updatedAt time.Time) error
	UpdateStatus(id string, status model.ClaimStatus, updatedAt time.Time) error
	UpdateTransferStatus(id, assignedBranchID string, status model.ClaimStatus, updatedAt time.Time) error

	// CountOpenAndUrgentByBranch devuelve cuántos tickets abiertos tiene una
	// sucursal y cuántos de esos están en prioridad urgente. Se usa para aplicar
	// el tope anti-inflación al crear un reclamo nuevo. La sucursal de un
	// reclamo se considera tanto la `origin_branch_id` del envío como el
	// `assigned_branch_id` (derivación).
	CountOpenAndUrgentByBranch(branchID string) (totalOpen, urgentOpen int, err error)
}
