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

	// ListNonTerminal devuelve todos los reclamos cuyo status NO es terminal
	// (no empiezan con "resolved_"). Lo consume el job de escalado automático
	// para evaluar inactividad por reclamo.
	ListNonTerminal() ([]model.Claim, error)

	// UpdatePriority actualiza la prioridad y la nota de un reclamo,
	// dejando intacto el resto del registro. Lo usa el job de escalado
	// automático cuando sube de nivel un reclamo inactivo.
	UpdatePriority(id string, priority model.ClaimPriority, note string, updatedAt time.Time) error
}
