package service

import (
	"context"
	"fmt"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

type UserService struct {
	authRepo   repository.AuthRepository
	branchRepo repository.BranchRepository
}

func NewUserService(authRepo repository.AuthRepository, branchRepo repository.BranchRepository) *UserService {
	return &UserService{authRepo: authRepo, branchRepo: branchRepo}
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

func (s *UserService) GetProfile(ctx context.Context, userID string) (model.UserProfileResponse, error) {
	user, err := s.authRepo.GetUserByID(userID)
	if err != nil {
		return model.UserProfileResponse{}, fmt.Errorf("failed to get user: %w", err)
	}

	profile := model.UserProfileResponse{
		ID:       user.ID,
		Username: user.Username,
		FullName: user.FirstName + " " + user.LastName,
		Email:    user.Email,
		Role:     user.Role,
		BranchID: user.BranchID,
	}

	if user.BranchID != "" {
		if branch, exists := s.branchRepo.GetByID(user.BranchID); exists {
			profile.BranchName = branch.Name
		}
	}

	return profile, nil
}
