package repository

import (
	"context"

	"github.com/logitrack/core/internal/model"
)

type UserCreate struct {
	Username  string
	Password  string
	FirstName string
	LastName  string
	Email     string
	Role      model.Role
	BranchID  string
	Address   model.Address
}

type UserUpdate struct {
	Username  *string
	Password  *string
	FirstName *string
	LastName  *string
	Email     *string
	Role      *model.Role
	BranchID  *string // nil = no change, "" = clear branch
	Status    *model.UserStatus
	Address   *model.Address
	UpdatedBy string
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
	CreateUser(cmd UserCreate) (model.User, error)
	ChangePassword(ctx context.Context, userID, currentPassword, newHashedPassword string) error
}
