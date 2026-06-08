package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"
	"github.com/google/uuid"   
	"github.com/logitrack/core/internal/model"
)

var (
	ErrInvalidSessionToken = errors.New("token de sesión inválido o expirado")
	ErrCodeAlreadyUsed     = errors.New("código ya utilizado")
)

type TwoFARepository interface {
	// Configuración inicial
	SaveTwoFASecret(ctx context.Context, userID, encryptedSecret string) error
	GetTwoFASecret(ctx context.Context, userID string) (string, error)
	EnableTwoFA(ctx context.Context, userID string) error
	DisableTwoFA(ctx context.Context, userID string) error
	
	// Sesiones temporales (SCOPE_2FA_PENDING)
	CreatePendingSession(ctx context.Context, userID string, expiresIn time.Duration) (string, error)
	GetUserByPendingSession(ctx context.Context, token string) (model.User, error)
	DeletePendingSession(ctx context.Context, token string) error
	
	// Anti-replay
	MarkCodeAsUsed(ctx context.Context, userID, code string) error
	IsCodeUsed(ctx context.Context, userID, code string) (bool, error)
	CleanupExpiredCodes(ctx context.Context) error

	// Lockout por intentos fallidos (login — por sesión)
	IncrementFailedAttempts(ctx context.Context, token string, lockUntil *time.Time) error
	GetSessionLockStatus(ctx context.Context, token string) (attempts int, lockedUntil *time.Time, err error)

	// Lockout por intentos fallidos (setup — por usuario)
	IncrementSetupFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error
	GetSetupLockStatus(ctx context.Context, userID string) (attempts int, lockedUntil *time.Time, err error)
	ResetSetupFailedAttempts(ctx context.Context, userID string) error
}

type twoFARepository struct {
	db *sql.DB
}

func NewTwoFARepository(db *sql.DB) TwoFARepository {
	return &twoFARepository{db: db}
}

func (r *twoFARepository) SaveTwoFASecret(ctx context.Context, userID, encryptedSecret string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET two_fa_secret = $1 WHERE id = $2`,
		encryptedSecret, userID,
	)
	return err
}

func (r *twoFARepository) GetTwoFASecret(ctx context.Context, userID string) (string, error) {
	var secret sql.NullString
	err := r.db.QueryRowContext(ctx,
		`SELECT two_fa_secret FROM users WHERE id = $1`,
		userID,
	).Scan(&secret)
	
	if err != nil {
		return "", err
	}
	if !secret.Valid {
		return "", errors.New("2FA no configurado para este usuario")
	}
	return secret.String, nil
}

func (r *twoFARepository) EnableTwoFA(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users 
		SET two_fa_enabled = TRUE, 
		    two_fa_enrolled_at = NOW() 
		WHERE id = $1`,
		userID,
	)
	return err
}

func (r *twoFARepository) DisableTwoFA(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users 
		SET two_fa_enabled = FALSE, 
		    two_fa_secret = NULL, 
		    two_fa_enrolled_at = NULL 
		WHERE id = $1`,
		userID,
	)
	return err
}

func (r *twoFARepository) CreatePendingSession(ctx context.Context, userID string, expiresIn time.Duration) (string, error) {
	token := uuid.NewString()
	expiresAt := time.Now().Add(expiresIn)
	
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO two_fa_pending_sessions (token, user_id, expires_at)
		VALUES ($1, $2, $3)`,
		token, userID, expiresAt,
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

func (r *twoFARepository) GetUserByPendingSession(ctx context.Context, token string) (model.User, error) {
	var user model.User
	var twoFAEnrolledAt sql.NullTime
	var email, phone, branchID, driverType sql.NullString

	err := r.db.QueryRowContext(ctx,
		`SELECT u.id, u.username, u.first_name, u.last_name, u.email, u.phone,
		        u.role, u.branch_id, u.status, u.driver_type,
		        u.two_fa_enabled, u.two_fa_enrolled_at
		FROM users u
		INNER JOIN two_fa_pending_sessions s ON s.user_id = u.id
		WHERE s.token = $1 AND s.expires_at > NOW()`,
		token,
	).Scan(
		&user.ID, &user.Username, &user.FirstName, &user.LastName,
		&email, &phone, &user.Role, &branchID,
		&user.Status, &driverType, &user.TwoFAEnabled, &twoFAEnrolledAt,
	)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return model.User{}, ErrInvalidSessionToken
		}
		return model.User{}, err
	}
	
	if email.Valid {
		user.Email = email.String
	}
	if phone.Valid {
		user.Phone = phone.String
	}
	if branchID.Valid {
		user.BranchID = branchID.String
	}
	if driverType.Valid {
		user.DriverType = model.DriverType(driverType.String)
	}
	if twoFAEnrolledAt.Valid {
		user.TwoFAEnrolledAt = &twoFAEnrolledAt.Time
	}

	return user, nil
}

func (r *twoFARepository) DeletePendingSession(ctx context.Context, token string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM two_fa_pending_sessions WHERE token = $1`,
		token,
	)
	return err
}

func (r *twoFARepository) MarkCodeAsUsed(ctx context.Context, userID, code string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO two_fa_used_codes (user_id, code, used_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id, code) DO NOTHING`,
		userID, code,
	)
	return err
}

func (r *twoFARepository) IsCodeUsed(ctx context.Context, userID, code string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM two_fa_used_codes 
			WHERE user_id = $1 AND code = $2 
			  AND used_at > NOW() - INTERVAL '2 minutes'
		)`,
		userID, code,
	).Scan(&exists)
	return exists, err
}

func (r *twoFARepository) CleanupExpiredCodes(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM two_fa_used_codes WHERE used_at < NOW() - INTERVAL '2 minutes'`,
	)
	return err
}

func (r *twoFARepository) IncrementFailedAttempts(ctx context.Context, token string, lockUntil *time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE two_fa_pending_sessions
		 SET failed_attempts = failed_attempts + 1,
		     locked_until    = $2
		 WHERE token = $1`,
		token, lockUntil,
	)
	return err
}

func (r *twoFARepository) GetSessionLockStatus(ctx context.Context, token string) (int, *time.Time, error) {
	var attempts int
	var lockedUntil sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT failed_attempts, locked_until FROM two_fa_pending_sessions WHERE token = $1`,
		token,
	).Scan(&attempts, &lockedUntil)
	if err != nil {
		return 0, nil, err
	}
	if lockedUntil.Valid {
		t := lockedUntil.Time
		return attempts, &t, nil
	}
	return attempts, nil, nil
}

func (r *twoFARepository) IncrementSetupFailedAttempts(ctx context.Context, userID string, lockUntil *time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users
		 SET two_fa_setup_failed_attempts = two_fa_setup_failed_attempts + 1,
		     two_fa_setup_locked_until    = $2
		 WHERE id = $1`,
		userID, lockUntil,
	)
	return err
}

func (r *twoFARepository) GetSetupLockStatus(ctx context.Context, userID string) (int, *time.Time, error) {
	var attempts int
	var lockedUntil sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT two_fa_setup_failed_attempts, two_fa_setup_locked_until FROM users WHERE id = $1`,
		userID,
	).Scan(&attempts, &lockedUntil)
	if err != nil {
		return 0, nil, err
	}
	if lockedUntil.Valid {
		t := lockedUntil.Time
		return attempts, &t, nil
	}
	return attempts, nil, nil
}

func (r *twoFARepository) ResetSetupFailedAttempts(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET two_fa_setup_failed_attempts = 0, two_fa_setup_locked_until = NULL WHERE id = $1`,
		userID,
	)
	return err
}