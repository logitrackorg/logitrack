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

type DriverType string

const (
	DriverTypeLastMile    DriverType = "ultima_milla"
	DriverTypeInterBranch DriverType = "intersucursal"
)

type UserStatus string

const (
	UserStatusActive   UserStatus = "activo"
	UserStatusInactive UserStatus = "inactivo"
)

type User struct {
	ID         string     `json:"id"`
	Username   string     `json:"username"`
	FirstName  string     `json:"first_name,omitempty"`
	LastName   string     `json:"last_name,omitempty"`
	Email      string     `json:"email,omitempty"`
	Phone      string     `json:"phone,omitempty"`
	Role       Role       `json:"role"`
	BranchID   string     `json:"branch_id,omitempty"`
	Status     UserStatus `json:"status"`
	Address    *Address   `json:"address,omitempty"`
	UpdatedBy  string     `json:"updated_by,omitempty"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
	DriverType DriverType `json:"driver_type,omitempty"`
	TwoFAEnabled     bool       `json:"two_fa_enabled"`
	TwoFAEnrolledAt  *time.Time `json:"two_fa_enrolled_at,omitempty"`
}

type UserProfileResponse struct {
	ID         string     `json:"id"`
	Username   string     `json:"username"`
	FullName   string     `json:"full_name"`
	Email      string     `json:"email,omitempty"`
	Role       Role       `json:"role"`
	Status     UserStatus `json:"status"`
	BranchID   string     `json:"branch_id,omitempty"`
	BranchName string     `json:"branch_name,omitempty"`
	// Driver-specific — omitted for non-driver roles.
	DriverType DriverType `json:"driver_type,omitempty"`
	Address    *Address   `json:"address,omitempty"`
	// Awards lists the employee-of-month wins for this user. Nil when user has no wins.
	Awards []Award `json:"awards,omitempty"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token        string `json:"token,omitempty"`
	User         User   `json:"user,omitempty"`
	Requires2FA  bool   `json:"requires_2fa"`
	SessionToken string `json:"session_token,omitempty"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=8"`
	ConfirmPassword string `json:"confirm_password" binding:"required"`
}


type TwoFASetupRequest struct {
	// Vacío: solo activa el proceso
}

type TwoFASetupResponse struct {
	Secret    string `json:"secret"`     
	QRCodeURL string `json:"qr_code_url"` 
	Issuer    string `json:"issuer"`
	AccountName string `json:"account_name"`
}

type TwoFAConfirmRequest struct {
	Code string `json:"code" binding:"required,len=6"`
}

type TwoFAVerifyRequest struct {
	SessionToken string `json:"session_token" binding:"required"`
	Code         string `json:"code" binding:"required,len=6"`
}

type TwoFAVerifyResponse struct {
	Token string `json:"token"` 
	User  User   `json:"user"`
}

type TwoFADisableRequest struct {
	Password string `json:"password" binding:"required"`
	Code     string `json:"code" binding:"required,len=6"`
}