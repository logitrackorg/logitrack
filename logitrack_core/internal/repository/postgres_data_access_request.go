package repository

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/logitrack/core/internal/model"
)

type DataAccessRequestRepository interface {
	Create(req model.DataAccessRequest) error
	ListByBranch(branchID string) ([]model.DataAccessRequest, error)
	ListByDriver(driverID string) ([]model.DataAccessRequest, error)
	GetByID(id string) (model.DataAccessRequest, bool)
	Accept(id, reviewedBy string, checkinData *model.DriverCheckin) error
	Reject(id, reviewedBy string) error
}

type postgresDataAccessRequestRepository struct {
	db *sql.DB
}

func NewDataAccessRequestRepository(db *sql.DB) DataAccessRequestRepository {
	return &postgresDataAccessRequestRepository{db: db}
}

func (r *postgresDataAccessRequestRepository) Create(req model.DataAccessRequest) error {
	_, err := r.db.Exec(`
		INSERT INTO data_access_requests (id, driver_id, driver_name, branch_id, status, requested_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		req.ID, req.DriverID, req.DriverName, req.BranchID, string(req.Status), req.RequestedAt,
	)
	return err
}

func (r *postgresDataAccessRequestRepository) ListByBranch(branchID string) ([]model.DataAccessRequest, error) {
	rows, err := r.db.Query(`
		SELECT id, driver_id, driver_name, branch_id, status, requested_at, reviewed_at, reviewed_by, checkin_data
		FROM data_access_requests
		WHERE branch_id = $1
		ORDER BY requested_at DESC`, branchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func (r *postgresDataAccessRequestRepository) ListByDriver(driverID string) ([]model.DataAccessRequest, error) {
	rows, err := r.db.Query(`
		SELECT id, driver_id, driver_name, branch_id, status, requested_at, reviewed_at, reviewed_by, checkin_data
		FROM data_access_requests
		WHERE driver_id = $1
		ORDER BY requested_at DESC`, driverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func (r *postgresDataAccessRequestRepository) GetByID(id string) (model.DataAccessRequest, bool) {
	row := r.db.QueryRow(`
		SELECT id, driver_id, driver_name, branch_id, status, requested_at, reviewed_at, reviewed_by, checkin_data
		FROM data_access_requests WHERE id = $1`, id)
	req, err := scanRow(row.Scan)
	if err != nil {
		return model.DataAccessRequest{}, false
	}
	return req, true
}

func (r *postgresDataAccessRequestRepository) Accept(id, reviewedBy string, checkinData *model.DriverCheckin) error {
	var cdJSON []byte
	if checkinData != nil {
		var err error
		cdJSON, err = json.Marshal(checkinData)
		if err != nil {
			return err
		}
	}
	_, err := r.db.Exec(`
		UPDATE data_access_requests
		SET status = 'accepted', reviewed_at = $2, reviewed_by = $3, checkin_data = $4
		WHERE id = $1`,
		id, time.Now().UTC(), reviewedBy, cdJSON,
	)
	return err
}

func (r *postgresDataAccessRequestRepository) Reject(id, reviewedBy string) error {
	_, err := r.db.Exec(`
		UPDATE data_access_requests
		SET status = 'rejected', reviewed_at = $2, reviewed_by = $3
		WHERE id = $1`,
		id, time.Now().UTC(), reviewedBy,
	)
	return err
}

func scanRows(rows *sql.Rows) ([]model.DataAccessRequest, error) {
	var out []model.DataAccessRequest
	for rows.Next() {
		req, err := scanRow(rows.Scan)
		if err != nil {
			continue
		}
		out = append(out, req)
	}
	if out == nil {
		out = []model.DataAccessRequest{}
	}
	return out, rows.Err()
}

func scanRow(scan func(...any) error) (model.DataAccessRequest, error) {
	var req model.DataAccessRequest
	var status string
	var reviewedAt sql.NullTime
	var reviewedBy sql.NullString
	var cdJSON []byte
	err := scan(
		&req.ID, &req.DriverID, &req.DriverName, &req.BranchID,
		&status, &req.RequestedAt, &reviewedAt, &reviewedBy, &cdJSON,
	)
	if err != nil {
		return model.DataAccessRequest{}, err
	}
	req.Status = model.DataAccessRequestStatus(status)
	if reviewedAt.Valid {
		t := reviewedAt.Time
		req.ReviewedAt = &t
	}
	if reviewedBy.Valid {
		req.ReviewedBy = reviewedBy.String
	}
	if len(cdJSON) > 0 {
		var cd model.DriverCheckin
		if json.Unmarshal(cdJSON, &cd) == nil {
			req.CheckinData = &cd
		}
	}
	return req, nil
}
