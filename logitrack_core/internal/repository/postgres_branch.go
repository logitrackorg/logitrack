package repository

import (
	"database/sql"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

// postgresBranchRepository persists branches/warehouses in PostgreSQL.
type postgresBranchRepository struct {
	db *sql.DB
}

func NewPostgresBranchRepository(db *sql.DB) BranchRepository {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS branches (
			id VARCHAR(50) PRIMARY KEY,
			name VARCHAR(100) UNIQUE NOT NULL,
			street VARCHAR(255),
			city VARCHAR(100),
			province VARCHAR(100),
			postal_code VARCHAR(20),
				status VARCHAR(30) NOT NULL DEFAULT 'activo',
			created_at TIMESTAMP NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
			updated_by VARCHAR(100)
		)
	`)
	if err != nil {
		panic("failed to create branches table: " + err.Error())
	}

	return &postgresBranchRepository{db: db}
}

func scanBranch(scan func(...any) error) (model.Branch, error) {
	var b model.Branch
	var street, city, province, postalCode, updatedBy sql.NullString
	var createdAt, updatedAt sql.NullTime
	var status string

	err := scan(&b.ID, &b.Name, &street, &city, &province, &postalCode,
		&status, &createdAt, &updatedAt, &updatedBy)
	if err != nil {
		return model.Branch{}, err
	}

	b.Address = model.Address{}
	if street.Valid {
		b.Address.Street = street.String
	}
	if city.Valid {
		b.Address.City = city.String
	}
	if province.Valid {
		b.Address.Province = province.String
		b.Province = province.String
	}
	if postalCode.Valid {
		b.Address.PostalCode = postalCode.String
	}
	b.Status = model.BranchStatus(status)
	if createdAt.Valid {
		b.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		b.UpdatedAt = updatedAt.Time
	}
	if updatedBy.Valid {
		b.UpdatedBy = updatedBy.String
	}
	return b, nil
}

const branchSelectCols = `id, name, street, city, province, postal_code, status, created_at, updated_at, updated_by`

func (r *postgresBranchRepository) List() []model.Branch {
	rows, err := r.db.Query(`SELECT ` + branchSelectCols + ` FROM branches ORDER BY name`)
	if err != nil {
		return []model.Branch{}
	}
	defer rows.Close()

	var branches []model.Branch
	for rows.Next() {
		b, err := scanBranch(rows.Scan)
		if err != nil {
			continue
		}
		branches = append(branches, b)
	}
	return branches
}

func (r *postgresBranchRepository) ListActive() []model.Branch {
	rows, err := r.db.Query(`SELECT ` + branchSelectCols + ` FROM branches WHERE status = 'activo' ORDER BY name`)
	if err != nil {
		return []model.Branch{}
	}
	defer rows.Close()

	var branches []model.Branch
	for rows.Next() {
		b, err := scanBranch(rows.Scan)
		if err != nil {
			continue
		}
		branches = append(branches, b)
	}
	return branches
}

func (r *postgresBranchRepository) Create(branch model.Branch) error {
	// Check for duplicate name
	var count int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM branches WHERE LOWER(name) = LOWER($1)`, branch.Name).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrDuplicateBranchName
	}

	now := time.Now()
	_, err = r.db.Exec(`
		INSERT INTO branches (id, name, street, city, province, postal_code, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, branch.ID, branch.Name, branch.Address.Street, branch.Address.City,
		branch.Address.Province, branch.Address.PostalCode,
		branch.Status, now, now)
	return err
}

func (r *postgresBranchRepository) Update(id string, branch model.Branch) error {
	// Check current status
	var currentStatus string
	err := r.db.QueryRow(`SELECT status FROM branches WHERE id = $1`, id).Scan(&currentStatus)
	if err != nil {
		if err == sql.ErrNoRows {
			return errNotFound
		}
		return err
	}
	if currentStatus != string(model.BranchStatusActive) {
		return errNotUpdatable
	}

	// Check for duplicate name (excluding self)
	var count int
	err = r.db.QueryRow(`SELECT COUNT(*) FROM branches WHERE LOWER(name) = LOWER($1) AND id != $2`, branch.Name, id).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrDuplicateBranchName
	}

	_, err = r.db.Exec(`
		UPDATE branches SET name = $1, street = $2, city = $3, province = $4,
			postal_code = $5, updated_at = $6
		WHERE id = $7
	`, branch.Name, branch.Address.Street, branch.Address.City, branch.Address.Province,
		branch.Address.PostalCode, time.Now(), id)
	return err
}

func (r *postgresBranchRepository) UpdateStatus(id string, status model.BranchStatus, username string) error {
	res, err := r.db.Exec(`UPDATE branches SET status = $1, updated_at = $2, updated_by = $3 WHERE id = $4`,
		status, time.Now(), username, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errNotFound
	}
	return nil
}

func (r *postgresBranchRepository) Add(branch model.Branch) {
	if branch.Status == "" {
		branch.Status = model.BranchStatusActive
	}
	if branch.CreatedAt.IsZero() {
		branch.CreatedAt = time.Now()
	}
	if branch.UpdatedAt.IsZero() {
		branch.UpdatedAt = time.Now()
	}
	_ = r.Create(branch)
}

func (r *postgresBranchRepository) GetByID(id string) (model.Branch, bool) {
	row := r.db.QueryRow(`SELECT `+branchSelectCols+` FROM branches WHERE id = $1`, id)
	b, err := scanBranch(row.Scan)
	if err != nil {
		return model.Branch{}, false
	}
	return b, true
}

func (r *postgresBranchRepository) GetByCity(city string) (model.Branch, bool) {
	row := r.db.QueryRow(`SELECT `+branchSelectCols+` FROM branches WHERE LOWER(city) = LOWER($1)`, city)
	b, err := scanBranch(row.Scan)
	if err != nil {
		return model.Branch{}, false
	}
	return b, true
}

func (r *postgresBranchRepository) GetByNameOrID(query string) []model.Branch {
	q := "%" + strings.ToLower(query) + "%"
	rows, err := r.db.Query(`SELECT `+branchSelectCols+` FROM branches WHERE LOWER(name) LIKE $1 OR LOWER(id) LIKE $1 OR LOWER(city) LIKE $1 ORDER BY name`, q)
	if err != nil {
		return []model.Branch{}
	}
	defer rows.Close()

	var branches []model.Branch
	for rows.Next() {
		b, err := scanBranch(rows.Scan)
		if err != nil {
			continue
		}
		branches = append(branches, b)
	}
	return branches
}

var (
	errNotFound     = sql.ErrNoRows
	errNotUpdatable = &notUpdatableError{}
)

type notUpdatableError struct{}

func (e *notUpdatableError) Error() string {
	return "cannot update inactive or out-of-service branch"
}

func IsNotUpdatable(err error) bool {
	_, ok := err.(*notUpdatableError)
	return ok
}
