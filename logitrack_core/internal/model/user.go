package model

import "time"

type Role string

const (
	RoleOperator   Role = "operator"
	RoleSupervisor Role = "supervisor"
	RoleManager    Role = "manager"
	RoleAdmin      Role = "admin"
	RoleDriver     Role = "driver"
)

type UserStatus string

const (
	UserStatusActive   UserStatus = "activo"
	UserStatusInactive UserStatus = "inactivo"
)

type User struct {
	ID        string     `json:"id"`
	Username  string     `json:"username"`
	FirstName string     `json:"first_name,omitempty"`
	LastName  string     `json:"last_name,omitempty"`
	Email     string     `json:"email,omitempty"`
	Role      Role       `json:"role"`
	BranchID  string     `json:"branch_id,omitempty"`
	Status    UserStatus `json:"status"`
	Address   *Address   `json:"address,omitempty"`
	UpdatedBy string     `json:"updated_by,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
	ConfirmPassword string `json:"confirm_password" binding:"required"`
}
