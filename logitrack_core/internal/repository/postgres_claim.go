package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type postgresClaimRepository struct {
	db *sql.DB
}

func NewPostgresClaimRepository(db *sql.DB) ClaimRepository {
	return &postgresClaimRepository{db: db}
}

func (r *postgresClaimRepository) Create(claim model.Claim) error {
	_, err := r.db.Exec(
		`INSERT INTO shipment_claims
			(id, tracking_id, claim_type, status, description, created_by, created_at, updated_at, assigned_category, resolution_type, is_automatic)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		claim.ID,
		claim.TrackingID,
		string(claim.ClaimType),
		string(claim.Status),
		claim.Description,
		claim.CreatedBy,
		claim.CreatedAt,
		claim.UpdatedAt,
		string(claim.AssignedCategory),
		string(claim.ResolutionType),
		claim.IsAutomatic,
	)
	return err
}

func (r *postgresClaimRepository) GetByID(id string) (model.Claim, error) {
	row := r.db.QueryRow(
		`SELECT id, tracking_id, claim_type, status, description, created_by, created_at, updated_at, assigned_category, resolution_type, is_automatic
		 FROM shipment_claims WHERE id = $1`,
		id,
	)
	var claim model.Claim
	var claimType string
	var status string
	var assignedCategory sql.NullString
	var resolutionType sql.NullString
	if err := row.Scan(
		&claim.ID,
		&claim.TrackingID,
		&claimType,
		&status,
		&claim.Description,
		&claim.CreatedBy,
		&claim.CreatedAt,
		&claim.UpdatedAt,
		&assignedCategory,
		&resolutionType,
		&claim.IsAutomatic,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.Claim{}, ErrClaimNotFound
		}
		return model.Claim{}, err
	}
	claim.ClaimType = model.ClaimType(claimType)
	claim.Status = model.ClaimStatus(status)
	if assignedCategory.Valid {
		claim.AssignedCategory = model.ClaimCategory(assignedCategory.String)
	}
	if resolutionType.Valid {
		claim.ResolutionType = model.ClaimResolutionType(resolutionType.String)
	}
	return claim, nil
}
