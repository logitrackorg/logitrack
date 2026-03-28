package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

// postgresAuthRepository persists tokens in PostgreSQL.
// Users remain hardcoded — only token storage moves to the DB.
type postgresAuthRepository struct {
	db    *sql.DB
	users []credential
}

func NewPostgresAuthRepository(db *sql.DB) AuthRepository {
	return &postgresAuthRepository{
		db: db,
		users: []credential{
			{user: model.User{ID: "1", Username: "operator", Role: model.RoleOperator}, password: "operator123"},
			{user: model.User{ID: "2", Username: "supervisor", Role: model.RoleSupervisor}, password: "supervisor123"},
			{user: model.User{ID: "3", Username: "gerente", Role: model.RoleManager}, password: "gerente123"},
			{user: model.User{ID: "4", Username: "admin", Role: model.RoleAdmin}, password: "admin123"},
			{user: model.User{ID: "5", Username: "chofer", Role: model.RoleDriver}, password: "chofer123"},
		},
	}
}

func (r *postgresAuthRepository) FindUser(username, password string) (model.User, error) {
	for _, c := range r.users {
		if c.user.Username == username && c.password == password {
			return c.user, nil
		}
	}
	return model.User{}, fmt.Errorf("invalid credentials")
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
	var u model.User
	var role string
	err := r.db.QueryRow(`
		SELECT user_id, username, role FROM tokens WHERE token = $1`, token,
	).Scan(&u.ID, &u.Username, &role)
	if err == sql.ErrNoRows {
		return model.User{}, fmt.Errorf("invalid token")
	}
	if err != nil {
		return model.User{}, fmt.Errorf("invalid token")
	}
	u.Role = model.Role(role)
	return u, nil
}

func (r *postgresAuthRepository) DeleteToken(token string) {
	r.db.Exec(`DELETE FROM tokens WHERE token = $1`, token)
}

func (r *postgresAuthRepository) ListByRole(role model.Role) []model.User {
	var result []model.User
	for _, c := range r.users {
		if c.user.Role == role {
			result = append(result, c.user)
		}
	}
	return result
}

func (r *postgresAuthRepository) GetUserByID(id string) (model.User, error) {
	for _, c := range r.users {
		if c.user.ID == id {
			return c.user, nil
		}
	}
	return model.User{}, fmt.Errorf("user not found")
}
