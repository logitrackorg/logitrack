package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type claimScanner interface {
	Scan(dest ...any) error
}

func (r *postgresClaimRepository) scanClaimRow(row *sql.Row) (model.Claim, error) {
	var claim model.Claim
	var claimType, status string
	var assignedCategory, resolutionType sql.NullString
	var evidenceFileName, evidenceFilePath, evidenceMimeType, claimantDNI sql.NullString
	var evidenceUploadDate sql.NullTime
	var assignedBranchID sql.NullString
	if err := row.Scan(
		&claim.ID,
		&claim.TrackingID,
		&claimType,
		&status,
		&claim.Description,
		&claim.CreatedBy,
		&claimantDNI,
		&claim.CreatedAt,
		&claim.UpdatedAt,
		&assignedCategory,
		&resolutionType,
		&claim.IsAutomatic,
		&evidenceFileName,
		&evidenceFilePath,
		&evidenceMimeType,
		&evidenceUploadDate,
		&assignedBranchID,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.Claim{}, ErrClaimNotFound
		}
		return model.Claim{}, err
	}
	scanClaim(claimType, status, assignedCategory, resolutionType, evidenceFileName, evidenceFilePath, evidenceMimeType, evidenceUploadDate, claimantDNI, assignedBranchID, &claim)
	return claim, nil
}

func (r *postgresClaimRepository) scanClaimRows(rows claimScanner) (model.Claim, error) {
	var claim model.Claim
	var claimType, status string
	var assignedCategory, resolutionType sql.NullString
	var evidenceFileName, evidenceFilePath, evidenceMimeType, claimantDNI sql.NullString
	var evidenceUploadDate sql.NullTime
	var assignedBranchID sql.NullString
	if err := rows.Scan(
		&claim.ID,
		&claim.TrackingID,
		&claimType,
		&status,
		&claim.Description,
		&claim.CreatedBy,
		&claimantDNI,
		&claim.CreatedAt,
		&claim.UpdatedAt,
		&assignedCategory,
		&resolutionType,
		&claim.IsAutomatic,
		&evidenceFileName,
		&evidenceFilePath,
		&evidenceMimeType,
		&evidenceUploadDate,
		&assignedBranchID,
	); err != nil {
		return model.Claim{}, err
	}
	scanClaim(claimType, status, assignedCategory, resolutionType, evidenceFileName, evidenceFilePath, evidenceMimeType, evidenceUploadDate, claimantDNI, assignedBranchID, &claim)
	return claim, nil
}

func scanClaim(
	claimType string,
	status string,
	assignedCategory sql.NullString,
	resolutionType sql.NullString,
	evidenceFileName sql.NullString,
	evidenceFilePath sql.NullString,
	evidenceMimeType sql.NullString,
	evidenceUploadDate sql.NullTime,
	claimantDNI sql.NullString,
	assignedBranchID sql.NullString,
	claim *model.Claim,
) {
	claim.ClaimType = model.ClaimType(claimType)
	claim.Status = model.ClaimStatus(status)
	if assignedCategory.Valid {
		claim.AssignedCategory = model.ClaimCategory(assignedCategory.String)
	}
	if resolutionType.Valid {
		claim.ResolutionType = model.ClaimResolutionType(resolutionType.String)
	}
	if evidenceFileName.Valid {
		claim.EvidenceFileName = evidenceFileName.String
	}
	if evidenceFilePath.Valid {
		claim.EvidenceFilePath = evidenceFilePath.String
	}
	if evidenceMimeType.Valid {
		claim.EvidenceMimeType = evidenceMimeType.String
	}
	if evidenceUploadDate.Valid {
		t := evidenceUploadDate.Time
		claim.EvidenceUploadDate = &t
	}
	if claimantDNI.Valid {
		claim.ClaimantDNI = claimantDNI.String
	}
	if assignedBranchID.Valid {
		claim.AssignedBranchID = assignedBranchID.String
	}
}

const claimSelectColumns = `id, tracking_id, claim_type, status, description, created_by, claimant_dni, created_at, updated_at, assigned_category, resolution_type, is_automatic, evidence_file_name, evidence_file_path, evidence_mime_type, evidence_upload_date, assigned_branch_id`
