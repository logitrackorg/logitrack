package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
	"golang.org/x/crypto/bcrypt"
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

	type seedUser struct {
		id, username, password, role, branchID string
		firstName, lastName, email             string
		street, city, province, postalCode     string
	}
	seed := []seedUser{
		{
			"1", "op_caba", "op_caba123", "operator", "caba",
			"Carlos", "García", "carlos.garcia@logitrack.com",
			"Av. Corrientes 1234", "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "C1043",
		},
		{
			"2", "sup_caba", "sup_caba123", "supervisor", "caba",
			"María", "López", "maria.lopez@logitrack.com",
			"Av. Santa Fe 567", "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "C1059",
		},
		{
			"3", "op_cordoba", "op_cordoba123", "operator", "cordoba",
			"Juan", "Martínez", "juan.martinez@logitrack.com",
			"Av. Colón 890", "Córdoba", "Córdoba", "X5000",
		},
		{
			"4", "sup_cordoba", "sup_cordoba123", "supervisor", "cordoba",
			"Ana", "Fernández", "ana.fernandez@logitrack.com",
			"Bv. San Juan 1111", "Córdoba", "Córdoba", "X5001",
		},
		{
			"5", "chofer_caba", "chofer_caba123", "driver", "caba",
			"Luis", "Rodríguez", "luis.rodriguez@logitrack.com",
			"Av. Rivadavia 3456", "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "C1084",
		},
		{
			"10", "chofer_cordoba", "chofer_cordoba123", "driver", "cordoba",
			"Pablo", "Díaz", "pablo.diaz@logitrack.com",
			"Av. Vélez Sársfield 2222", "Córdoba", "Córdoba", "X5010",
		},
		{
			"11", "chofer_mendoza", "chofer_mendoza123", "driver", "mendoza",
			"Roberto", "Sánchez", "roberto.sanchez@logitrack.com",
			"Av. San Martín 789", "Mendoza", "Mendoza", "M5500",
		},
		{
			"6", "op_mendoza", "op_mendoza123", "operator", "mendoza",
			"Sofía", "González", "sofia.gonzalez@logitrack.com",
			"Calle Las Heras 456", "Mendoza", "Mendoza", "M5501",
		},
		{
			"7", "sup_mendoza", "sup_mendoza123", "supervisor", "mendoza",
			"Diego", "Pérez", "diego.perez@logitrack.com",
			"Av. Mitre 321", "Mendoza", "Mendoza", "M5502",
		},
		{
			"8", "gerente", "gerente123", "manager", "",
			"Valentina", "Torres", "valentina.torres@logitrack.com",
			"Av. Del Libertador 4567", "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "C1426",
		},
		{
			"9", "admin", "admin123", "admin", "",
			"Alejandro", "Ramírez", "alejandro.ramirez@logitrack.com",
			"Av. 9 de Julio 123", "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "C1073",
		},
	}
	for _, u := range seed {
		addrJSON, _ := json.Marshal(map[string]string{
			"street": u.street, "city": u.city, "province": u.province, "postal_code": u.postalCode,
		})
		// Hash the password using bcrypt
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(u.password), bcrypt.DefaultCost)
		db.Exec(`
			INSERT INTO users (id, username, password, role, branch_id, status, first_name, last_name, email, address)
			VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'activo', $6, $7, $8, $9)
			ON CONFLICT (username) DO UPDATE
				SET password   = EXCLUDED.password,
				    role       = EXCLUDED.role,
				    branch_id  = EXCLUDED.branch_id,
				    first_name = EXCLUDED.first_name,
				    last_name  = EXCLUDED.last_name,
				    email      = EXCLUDED.email,
				    address    = EXCLUDED.address`,
			u.id, u.username, string(hashedPassword), u.role, u.branchID,
			u.firstName, u.lastName, u.email, addrJSON,
		)
	}

	return &postgresAuthRepository{db: db}
}

func scanUser(scan func(...any) error) (model.User, error) {
	var u model.User
	var role, status string
	var branchID, email, firstName, lastName, updatedBy sql.NullString
	var updatedAt sql.NullTime
	var addressJSON []byte
	if err := scan(&u.ID, &u.Username, &firstName, &lastName, &email, &role, &branchID, &status, &addressJSON, &updatedBy, &updatedAt); err != nil {
		return model.User{}, err
	}
	u.Role = model.Role(role)
	u.Status = model.UserStatus(status)
	if branchID.Valid {
		u.BranchID = branchID.String
	}
	if email.Valid {
		u.Email = email.String
	}
	if firstName.Valid {
		u.FirstName = firstName.String
	}
	if lastName.Valid {
		u.LastName = lastName.String
	}
	if updatedBy.Valid {
		u.UpdatedBy = updatedBy.String
	}
	if updatedAt.Valid {
		t := updatedAt.Time
		u.UpdatedAt = &t
	}
	if len(addressJSON) > 0 {
		var addr model.Address
		if err := json.Unmarshal(addressJSON, &addr); err == nil {
			u.Address = &addr
		}
	}
	return u, nil
}

const (
	userSelectCols        = `id, username, first_name, last_name, email, role, branch_id, status, address, updated_by, updated_at`
	userSelectColsAliased = `u.id, u.username, u.first_name, u.last_name, u.email, u.role, u.branch_id, u.status, u.address, u.updated_by, u.updated_at`
)

var ErrAccountInactive = fmt.Errorf("account_inactive")

func (r *postgresAuthRepository) FindUser(username, password string) (model.User, error) {
	var id, role, status, firstName, lastName, passwordHash string
	var email, addressJSON, branchID, updatedBy sql.NullString
	var updatedAt sql.NullTime
	row := r.db.QueryRow(
		`SELECT id, username, first_name, last_name, email, role, branch_id, status, address, updated_by, updated_at, password FROM users WHERE username = $1`,
		username,
	)
	err := row.Scan(&id, &username, &firstName, &lastName, &email, &role, &branchID, &status, &addressJSON, &updatedBy, &updatedAt, &passwordHash)
	if err == sql.ErrNoRows {
		return model.User{}, fmt.Errorf("invalid credentials")
	}
	if err != nil {
		return model.User{}, fmt.Errorf("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return model.User{}, fmt.Errorf("invalid credentials")
	}

	u := model.User{
		ID:        id,
		Username:  username,
		FirstName: firstName,
		LastName:  lastName,
		Role:      model.Role(role),
		Status:    model.UserStatus(status),
	}
	if branchID.Valid {
		u.BranchID = branchID.String
	}
	if email.Valid {
		u.Email = email.String
	}
	if updatedBy.Valid {
		u.UpdatedBy = updatedBy.String
	}
	if updatedAt.Valid {
		u.UpdatedAt = &updatedAt.Time
	}
	if addressJSON.Valid && len(addressJSON.String) > 0 {
		var addr model.Address
		if err := json.Unmarshal([]byte(addressJSON.String), &addr); err == nil {
			u.Address = &addr
		}
	}

	if u.Status == model.UserStatusInactive {
		return model.User{}, ErrAccountInactive
	}
	return u, nil
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
		SELECT `+userSelectColsAliased+`
		FROM tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token = $1 AND u.status = 'activo'`, token,
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

func (r *postgresAuthRepository) CreateUser(cmd UserCreate) (model.User, error) {
	var id string
	if err := r.db.QueryRow(`SELECT COALESCE(MAX(id::int), 0) + 1 FROM users`).Scan(&id); err != nil {
		return model.User{}, err
	}
	addrJSON, _ := json.Marshal(cmd.Address)
	_, err := r.db.Exec(
		`INSERT INTO users (id, username, password, role, branch_id, status, first_name, last_name, email, address)
		 VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'activo', $6, $7, $8, $9)`,
		id, cmd.Username, cmd.Password, string(cmd.Role), cmd.BranchID,
		cmd.FirstName, cmd.LastName, cmd.Email, addrJSON,
	)
	if err != nil {
		if strings.Contains(err.Error(), "users_email_key") || (strings.Contains(err.Error(), "unique") && strings.Contains(err.Error(), "email")) {
			return model.User{}, fmt.Errorf("email already in use")
		}
		if strings.Contains(err.Error(), "unique") {
			return model.User{}, fmt.Errorf("username already exists")
		}
		return model.User{}, err
	}
	return r.GetUserByID(id)
}

func (r *postgresAuthRepository) UpdateUser(id string, update UserUpdate) (model.User, error) {
	setClauses := []string{}
	args := []any{}
	argIdx := 1

	if update.Username != nil {
		setClauses = append(setClauses, fmt.Sprintf("username = $%d", argIdx))
		args = append(args, *update.Username)
		argIdx++
	}
	if update.Password != nil {
		setClauses = append(setClauses, fmt.Sprintf("password = $%d", argIdx))
		args = append(args, *update.Password)
		argIdx++
	}
	if update.FirstName != nil {
		setClauses = append(setClauses, fmt.Sprintf("first_name = $%d", argIdx))
		args = append(args, *update.FirstName)
		argIdx++
	}
	if update.LastName != nil {
		setClauses = append(setClauses, fmt.Sprintf("last_name = $%d", argIdx))
		args = append(args, *update.LastName)
		argIdx++
	}
	if update.Email != nil {
		setClauses = append(setClauses, fmt.Sprintf("email = NULLIF($%d, '')", argIdx))
		args = append(args, *update.Email)
		argIdx++
	}
	if update.Role != nil {
		setClauses = append(setClauses, fmt.Sprintf("role = $%d", argIdx))
		args = append(args, string(*update.Role))
		argIdx++
	}
	if update.BranchID != nil {
		setClauses = append(setClauses, fmt.Sprintf("branch_id = NULLIF($%d, '')", argIdx))
		args = append(args, *update.BranchID)
		argIdx++
	}
	if update.Status != nil {
		setClauses = append(setClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, string(*update.Status))
		argIdx++
	}
	if update.Address != nil {
		addrJSON, err := json.Marshal(update.Address)
		if err == nil {
			setClauses = append(setClauses, fmt.Sprintf("address = $%d", argIdx))
			args = append(args, addrJSON)
			argIdx++
		}
	}

	if len(setClauses) == 0 {
		return r.GetUserByID(id)
	}

	setClauses = append(setClauses, fmt.Sprintf("updated_by = $%d", argIdx))
	args = append(args, update.UpdatedBy)
	argIdx++
	setClauses = append(setClauses, fmt.Sprintf("updated_at = $%d", argIdx))
	args = append(args, time.Now())
	argIdx++

	args = append(args, id)
	query := `UPDATE users SET ` + strings.Join(setClauses, ", ") + fmt.Sprintf(` WHERE id = $%d`, argIdx)
	if _, err := r.db.Exec(query, args...); err != nil {
		if strings.Contains(err.Error(), "users_email_key") || strings.Contains(err.Error(), "unique") && strings.Contains(err.Error(), "email") {
			return model.User{}, fmt.Errorf("email already in use")
		}
		return model.User{}, err
	}

	if update.Status != nil && *update.Status == model.UserStatusInactive {
		r.db.Exec(`DELETE FROM tokens WHERE user_id = $1`, id)
	}

	return r.GetUserByID(id)
}

func (r *postgresAuthRepository) ChangePassword(ctx context.Context, userID, currentPassword, newHashedPassword string) error {
	// First, verify the current password
	var storedHash string
	err := r.db.QueryRowContext(ctx, `SELECT password FROM users WHERE id = $1`, userID).Scan(&storedHash)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("user not found")
		}
		return err
	}

	// Compare the provided current password with the stored hash
	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(currentPassword)); err != nil {
		return fmt.Errorf("current password is incorrect")
	}

	// Update to the new password
	_, err = r.db.ExecContext(ctx, `UPDATE users SET password = $1 WHERE id = $2`, newHashedPassword, userID)
	return err
}
