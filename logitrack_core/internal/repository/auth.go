package repository

import "github.com/logitrack/core/internal/model"

type UserUpdate struct {
	Username *string
	Password *string
	Role     *model.Role
	BranchID *string // nil = no change, "" = clear branch
}

type credential struct {
	user     model.User
	password string
}

type AuthRepository interface {
	FindUser(username, password string) (model.User, error)
	SaveToken(token string, user model.User)
	GetUserByToken(token string) (model.User, error)
	DeleteToken(token string)
	ListByRole(role model.Role, branchID string) []model.User
	ListAll() []model.User
	GetUserByID(id string) (model.User, error)
	UpdateUser(id string, update UserUpdate) (model.User, error)
	CreateUser(username, password string, role model.Role, branchID string) (model.User, error)
}
