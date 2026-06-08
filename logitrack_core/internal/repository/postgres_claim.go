package repository

import (
	"database/sql"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresClaimRepository struct {
	db *sql.DB
}

func NewPostgresClaimRepository(db *sql.DB) ClaimRepository {
	return &postgresClaimRepository{db: db}
}

func (r *postgresClaimRepository) NextID() (string, error) {
	var id string
	err := r.db.QueryRow(`SELECT 'REC-' || nextval('shipment_claim_id_seq')::text`).Scan(&id)
	return id, err
}

func (r *postgresClaimRepository) Create(claim model.Claim) error {
	var evidenceUploadDate interface{}
	if claim.EvidenceUploadDate != nil {
		evidenceUploadDate = *claim.EvidenceUploadDate
	}
	_, err := r.db.Exec(
		`INSERT INTO shipment_claims
			(id, tracking_id, claim_type, status, description, created_by, claimant_dni, created_at, updated_at, assigned_category, resolution_type, is_automatic, evidence_file_name, evidence_file_path, evidence_mime_type, evidence_upload_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		claim.ID,
		claim.TrackingID,
		string(claim.ClaimType),
		string(claim.Status),
		claim.Description,
		claim.CreatedBy,
		nullString(claim.ClaimantDNI),
		claim.CreatedAt,
		claim.UpdatedAt,
		string(claim.AssignedCategory),
		string(claim.ResolutionType),
		claim.IsAutomatic,
		claim.EvidenceFileName,
		claim.EvidenceFilePath,
		claim.EvidenceMimeType,
		evidenceUploadDate,
	)
	return err
}

func (r *postgresClaimRepository) Delete(id string) error {
	res, err := r.db.Exec(`DELETE FROM shipment_claims WHERE id = $1`, id)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err == nil && rows == 0 {
		return ErrClaimNotFound
	}
	return err
}

func (r *postgresClaimRepository) GetByID(id string) (model.Claim, error) {
	row := r.db.QueryRow(
		`SELECT `+claimSelectColumns+` FROM shipment_claims WHERE id = $1`,
		id,
	)
	return r.scanClaimRow(row)
}

func (r *postgresClaimRepository) GetLatestByTrackingID(trackingID string) (model.Claim, error) {
	row := r.db.QueryRow(
		`SELECT `+claimSelectColumns+`
		 FROM shipment_claims
		 WHERE tracking_id = $1
		 ORDER BY updated_at DESC
		 LIMIT 1`,
		trackingID,
	)
	return r.scanClaimRow(row)
}

func (r *postgresClaimRepository) GetLatestByTrackingIDAndDNI(trackingID, dni string) (model.Claim, error) {
	row := r.db.QueryRow(
		`SELECT `+claimSelectColumns+`
		 FROM shipment_claims
		 WHERE tracking_id = $1 AND claimant_dni = $2
		 ORDER BY updated_at DESC
		 LIMIT 1`,
		trackingID, dni,
	)
	return r.scanClaimRow(row)
}

func (r *postgresClaimRepository) ListAll() ([]model.Claim, error) {
	rows, err := r.db.Query(
		`SELECT ` + claimSelectColumns + ` FROM shipment_claims ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []model.Claim
	for rows.Next() {
		claim, err := r.scanClaimRows(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, claim)
	}
	return result, nil
}

func nullString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func (r *postgresClaimRepository) UpdateCategory(id string, category model.ClaimCategory, status model.ClaimStatus, updatedAt time.Time) error {
	res, err := r.db.Exec(
		`UPDATE shipment_claims
		 SET assigned_category = $1, status = $2, updated_at = $3
		 WHERE id = $4`,
		string(category),
		string(status),
		updatedAt,
		id,
	)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err == nil && rows == 0 {
		return ErrClaimNotFound
	}
	return err
}

func (r *postgresClaimRepository) Resolve(id string, resolutionType model.ClaimResolutionType, status model.ClaimStatus, updatedAt time.Time) error {
	res, err := r.db.Exec(
		`UPDATE shipment_claims
		 SET resolution_type = $1, status = $2, updated_at = $3
		 WHERE id = $4`,
		string(resolutionType),
		string(status),
		updatedAt,
		id,
	)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err == nil && rows == 0 {
		return ErrClaimNotFound
	}
	return err
}

func (r *postgresClaimRepository) UpdateStatus(id string, status model.ClaimStatus, updatedAt time.Time) error {
	res, err := r.db.Exec(
		`UPDATE shipment_claims
		 SET status = $1, updated_at = $2
		 WHERE id = $3`,
		string(status),
		updatedAt,
		id,
	)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err == nil && rows == 0 {
		return ErrClaimNotFound
	}
	return err
}
