package model

import "time"

// BranchStatus represents the operational status of a branch/warehouse.
type BranchStatus string

const (
	BranchStatusActive       BranchStatus = "activo"
	BranchStatusInactive     BranchStatus = "inactivo"
	BranchStatusOutOfService BranchStatus = "fuera_de_servicio"
)

// Branch represents a logistics warehouse/branch.
type Branch struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Address   Address      `json:"address"`
	Province  string       `json:"province"`
	Status    BranchStatus `json:"status"`
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
	UpdatedBy string       `json:"updated_by,omitempty"`
}

// CreateBranchRequest is the request body for creating a new branch.
// ID is optional — if omitted, a UUID will be auto-generated.
type CreateBranchRequest struct {
	ID         string `json:"id,omitempty"`
	Name       string `json:"name" binding:"required"`
	Street     string `json:"street" binding:"required"`
	City       string `json:"city" binding:"required"`
	Province   string `json:"province" binding:"required"`
	PostalCode string `json:"postal_code" binding:"required"`
}

// UpdateBranchRequest is the request body for updating branch data.
type UpdateBranchRequest struct {
	Name       string `json:"name" binding:"required"`
	Street     string `json:"street" binding:"required"`
	City       string `json:"city" binding:"required"`
	Province   string `json:"province" binding:"required"`
	PostalCode string `json:"postal_code" binding:"required"`
}

// UpdateBranchStatusRequest is the request body for updating branch status.
type UpdateBranchStatusRequest struct {
	Status BranchStatus `json:"status" binding:"required"`
}
