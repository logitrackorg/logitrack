package repository

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

type postgresAuthRepository struct {
	db *sql.DB
}

func NewPostgresAuthRepository(db *sql.DB) AuthRepository {
	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id         VARCHAR(10)  PRIMARY KEY,
		username   VARCHAR(100) UNIQUE NOT NULL,
		password   VARCHAR(255) NOT NULL,
		role       VARCHAR(50)  NOT NULL,
		branch_id  VARCHAR(50)
	)`)

	seed := []struct {
		id, username, password, role, branchID string
	}{
		{"1", "op_caba", "op_caba123", "operator", "caba"},
		{"2", "sup_caba", "sup_caba123", "supervisor", "caba"},
		{"3", "op_cordoba", "op_cordoba123", "operator", "cordoba"},
		{"4", "sup_cordoba", "sup_cordoba123", "supervisor", "cordoba"},
		{"5", "chofer_caba", "chofer_caba123", "driver", "caba"},
		{"10", "chofer_cordoba", "chofer_cordoba123", "driver", "cordoba"},
		{"11", "chofer_mendoza", "chofer_mendoza123", "driver", "mendoza"},
		{"6", "op_mendoza", "op_mendoza123", "operator", "mendoza"},
		{"7", "sup_mendoza", "sup_mendoza123", "supervisor", "mendoza"},
		{"8", "gerente", "gerente123", "manager", ""},
		{"9", "admin", "admin123", "admin", ""},
	}
	for _, u := range seed {
		db.Exec(`
			INSERT INTO users (id, username, password, role, branch_id)
			VALUES ($1, $2, $3, $4, NULLIF($5, ''))
			ON CONFLICT (username) DO UPDATE
				SET password  = EXCLUDED.password,
				    role      = EXCLUDED.role,
				    branch_id = EXCLUDED.branch_id`,
			u.id, u.username, u.password, u.role, u.branchID,
		)
	}

	return &postgresAuthRepository{db: db}
}

func scanUser(scan func(...any) error) (model.User, error) {
	var u model.User
	var role string
	var branchID sql.NullString
	if err := scan(&u.ID, &u.Username, &role, &branchID); err != nil {
		return model.User{}, err
	}
	u.Role = model.Role(role)
	if branchID.Valid {
		u.BranchID = branchID.String
	}
	return u, nil
}

const userSelectCols = `id, username, role, branch_id`

func (r *postgresAuthRepository) FindUser(username, password string) (model.User, error) {
	row := r.db.QueryRow(
		`SELECT `+userSelectCols+` FROM users WHERE username = $1 AND password = $2`,
		username, password,
	)
	u, err := scanUser(row.Scan)
	if err == sql.ErrNoRows {
		return model.User{}, fmt.Errorf("invalid credentials")
	}
	return u, err
}

func (r *postgresAuthRepository) SaveToken(token string, user model.User) {
	r.db.Exec(`
		INSERT INTO tokens (token, user_id, username, role, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (token) DO NOTHING`,
		token, user.ID, user.Username, string(user.Role), time.Now(),
	)
}

func (r *postgresAuthRepository) GetUserByToken(token string) (model.User, error) {
	row := r.db.QueryRow(`
		SELECT u.id, u.username, u.role, u.branch_id
		FROM tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token = $1`, token,
	)
	u, err := scanUser(row.Scan)
	if err == sql.ErrNoRows {
		return model.User{}, fmt.Errorf("invalid token")
	}
	if err != nil {
		return model.User{}, fmt.Errorf("invalid token")
	}
	return u, nil
}

func (r *postgresAuthRepository) DeleteToken(token string) {
	r.db.Exec(`DELETE FROM tokens WHERE token = $1`, token)
}

func (r *postgresAuthRepository) ListByRole(role model.Role, branchID string) []model.User {
	var rows *sql.Rows
	var err error
	if branchID != "" {
		rows, err = r.db.Query(
			`SELECT `+userSelectCols+` FROM users WHERE role = $1 AND branch_id = $2 ORDER BY username`,
			string(role), branchID,
		)
	} else {
		rows, err = r.db.Query(
			`SELECT `+userSelectCols+` FROM users WHERE role = $1 ORDER BY username`,
			string(role),
		)
	}
	if err != nil {
		return nil
	}
	defer rows.Close()
	var result []model.User
	for rows.Next() {
		u, err := scanUser(rows.Scan)
		if err == nil {
			result = append(result, u)
		}
	}
	return result
}

func (r *postgresAuthRepository) GetUserByID(id string) (model.User, error) {
	row := r.db.QueryRow(`SELECT `+userSelectCols+` FROM users WHERE id = $1`, id)
	u, err := scanUser(row.Scan)
	if err == sql.ErrNoRows {
		return model.User{}, fmt.Errorf("user not found")
	}
	return u, err
}

func (r *postgresAuthRepository) ListAll() []model.User {
	rows, err := r.db.Query(`SELECT ` + userSelectCols + ` FROM users ORDER BY role, username`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var result []model.User
	for rows.Next() {
		u, err := scanUser(rows.Scan)
		if err == nil {
			result = append(result, u)
		}
	}
	return result
}

func (r *postgresAuthRepository) CreateUser(username, password string, role model.Role, branchID string) (model.User, error) {
	var id string
	if err := r.db.QueryRow(`SELECT COALESCE(MAX(id::int), 0) + 1 FROM users`).Scan(&id); err != nil {
		return model.User{}, err
	}
	_, err := r.db.Exec(
		`INSERT INTO users (id, username, password, role, branch_id) VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
		id, username, password, string(role), branchID,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			return model.User{}, fmt.Errorf("username already exists")
		}
		return model.User{}, err
	}
	return r.GetUserByID(id)
}

func (r *postgresAuthRepository) UpdateUser(id string, update UserUpdate) (model.User, error) {
	if update.Username != nil {
		if _, err := r.db.Exec(`UPDATE users SET username = $1 WHERE id = $2`, *update.Username, id); err != nil {
			return model.User{}, err
		}
	}
	if update.Password != nil {
		if _, err := r.db.Exec(`UPDATE users SET password = $1 WHERE id = $2`, *update.Password, id); err != nil {
			return model.User{}, err
		}
	}
	if update.Role != nil {
		if _, err := r.db.Exec(`UPDATE users SET role = $1 WHERE id = $2`, string(*update.Role), id); err != nil {
			return model.User{}, err
		}
	}
	if update.BranchID != nil {
		if _, err := r.db.Exec(`UPDATE users SET branch_id = NULLIF($1, '') WHERE id = $2`, *update.BranchID, id); err != nil {
			return model.User{}, err
		}
	}
	return r.GetUserByID(id)
}
