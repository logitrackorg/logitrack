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
	priority := claim.Priority
	if priority == "" {
		priority = model.ClaimPriorityBaja
	}
	_, err := r.db.Exec(
		`INSERT INTO shipment_claims
			(id, tracking_id, claim_type, status, description, created_by, claimant_dni, created_at, updated_at, assigned_category, resolution_type, is_automatic, evidence_file_name, evidence_file_path, evidence_mime_type, evidence_upload_date, assigned_branch_id, priority, priority_note)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
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
		nullString(claim.AssignedBranchID),
		string(priority),
		nullString(claim.PriorityNote),
	)
	return err
}

// CountOpenAndUrgentByBranch devuelve el total de tickets abiertos (no resueltos
// ni rechazados) y cuántos de ellos están en prioridad urgente, para una
// sucursal. Se usa para aplicar el tope de urgentes en el creador de reclamos.
// Considera el origin_branch_id del envío Y el assigned_branch_id del reclamo
// (cuando hay derivación), para que la cuenta no cambie al transferir.
func (r *postgresClaimRepository) CountOpenAndUrgentByBranch(branchID string) (totalOpen, urgentOpen int, err error) {
	if strings.TrimSpace(branchID) == "" {
		return 0, 0, nil
	}
	row := r.db.QueryRow(
		`SELECT
			COUNT(*) FILTER (WHERE c.status NOT LIKE 'resolved_%' AND c.status <> 'transfer_rejected')                                                     AS total_open,
			COUNT(*) FILTER (WHERE c.status NOT LIKE 'resolved_%' AND c.status <> 'transfer_rejected' AND c.priority = 'urgente') AS urgent_open
		 FROM shipment_claims c
		 LEFT JOIN shipments s ON s.tracking_id = c.tracking_id
		 WHERE c.assigned_branch_id = $1 OR s.origin_branch_id = $1`,
		branchID,
	)
	err = row.Scan(&totalOpen, &urgentOpen)
	return totalOpen, urgentOpen, err
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

func (r *postgresClaimRepository) UpdateTransferStatus(id, assignedBranchID string, status model.ClaimStatus, updatedAt time.Time) error {
	res, err := r.db.Exec(
		`UPDATE shipment_claims
		 SET status = $1, assigned_branch_id = $2, updated_at = $3
		 WHERE id = $4`,
		string(status),
		nullString(assignedBranchID),
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

// ListNonTerminal devuelve todos los reclamos cuyo status NO es resuelto.
// Es la lista que evalúa el job de escalado automático.
func (r *postgresClaimRepository) ListNonTerminal() ([]model.Claim, error) {
	rows, err := r.db.Query(
		`SELECT ` + claimSelectColumns + `
		 FROM shipment_claims
		 WHERE status NOT LIKE 'resolved_%'
		 ORDER BY updated_at ASC`,
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

// UpdatePriority sobreescribe la prioridad y la nota de un reclamo. Lo invoca
// el job de escalado automático cuando un nivel inactivo cruza el umbral.
func (r *postgresClaimRepository) UpdatePriority(id string, priority model.ClaimPriority, note string, updatedAt time.Time) error {
	res, err := r.db.Exec(
		`UPDATE shipment_claims
		 SET priority = $1, priority_note = $2, updated_at = $3
		 WHERE id = $4`,
		string(priority),
		nullString(note),
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

func (r *postgresClaimRepository) ListByAssignedBranch(branchID string) ([]model.Claim, error) {
	rows, err := r.db.Query(
		`SELECT `+claimSelectColumns+` FROM shipment_claims WHERE assigned_branch_id = $1 ORDER BY created_at DESC`,
		branchID,
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
