package service

import (
	"context"
	"fmt"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

type UserService struct {
	authRepo repository.AuthRepository
}

func NewUserService(authRepo repository.AuthRepository) *UserService {
	return &UserService{authRepo: authRepo}
}

func (s *UserService) ChangePassword(ctx context.Context, userID string, req model.ChangePasswordRequest) error {
	// Verify new passwords match
	if req.NewPassword != req.ConfirmPassword {
		return fmt.Errorf("new password and confirmation do not match")
	}

	// Hash new password
	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password")
	}

	// Change password (this also verifies the current password)
	return s.authRepo.ChangePassword(ctx, userID, req.CurrentPassword, string(hashed))
}