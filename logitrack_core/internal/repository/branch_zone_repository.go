package repository

import "github.com/logitrack/core/internal/model"

type BranchZoneRepository interface {
	ListByBranch(branchID string, includeInactive bool) ([]model.BranchZone, error)
	GetByBranchAndType(branchID string, zoneType model.BranchZoneType) (model.BranchZone, error)
	Create(zone model.BranchZone) error
	SetActiveForBranch(branchID string, active bool) error
	EnsureZonesForBranch(branchID string) error
}
