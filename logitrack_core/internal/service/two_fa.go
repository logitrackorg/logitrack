package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"github.com/skip2/go-qrcode"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

const MASTER_2FA_CODE = "012026"

const (
	TwoFAPendingSessionDuration = 5 * time.Minute
	TOTPWindow                  = 1
)

type TwoFAService interface {
	GenerateSetup(ctx context.Context, user model.User) (model.TwoFASetupResponse, error)
	ConfirmSetup(ctx context.Context, userID, code string) error
	Disable(ctx context.Context, userID, password, code string) error
	VerifyCode(ctx context.Context, sessionToken, code string) (model.TwoFAVerifyResponse, error)
}

const maxFailedAttempts = 3

type twoFAService struct {
	twoFARepo  repository.TwoFARepository
	authRepo   repository.AuthRepository
	configRepo repository.SystemConfigRepository
	issuer     string
	aesKey     []byte
}

func NewTwoFAService(
	twoFARepo repository.TwoFARepository,
	authRepo repository.AuthRepository,
	configRepo repository.SystemConfigRepository,
) TwoFAService {
	issuer := os.Getenv("APP_NAME")
	if issuer == "" {
		issuer = "LogiTrack"
	}

	aesKeyStr := os.Getenv("TWO_FA_ENCRYPTION_KEY")
	if aesKeyStr == "" {
		panic("TWO_FA_ENCRYPTION_KEY no configurada en .env")
	}

	aesKey, err := base64.StdEncoding.DecodeString(aesKeyStr)
	if err != nil || len(aesKey) != 32 {
		panic("TWO_FA_ENCRYPTION_KEY debe ser base64 de 32 bytes (AES-256)")
	}

	return &twoFAService{
		twoFARepo:  twoFARepo,
		authRepo:   authRepo,
		configRepo: configRepo,
		issuer:     issuer,
		aesKey:     aesKey,
	}
}

func (s *twoFAService) isMasterCodeEnabled() bool {
	return os.Getenv("ENABLE_MASTER_2FA_CODE") == "true"
}

// checkLoginLock verifica si el usuario está bloqueado para el login 2FA.
// El bloqueo es por usuario (persiste aunque se cree una nueva sesión pendiente).
func (s *twoFAService) checkLoginLock(ctx context.Context, userID string) error {
	_, lockedUntil, err := s.twoFARepo.GetLoginLockStatus(ctx, userID)
	if err != nil {
		return nil
	}
	if lockedUntil != nil && time.Now().Before(*lockedUntil) {
		remaining := time.Until(*lockedUntil).Round(time.Second)
		return fmt.Errorf("demasiados intentos fallidos. Esperá %s antes de reintentar", remaining)
	}
	return nil
}

// recordLoginFailure incrementa el contador de intentos fallidos de login
// y aplica bloqueo por usuario si se alcanzó el máximo.
func (s *twoFAService) recordLoginFailure(ctx context.Context, userID string) {
	attempts, _, _ := s.twoFARepo.GetLoginLockStatus(ctx, userID)
	var newLock *time.Time
	if attempts+1 >= maxFailedAttempts {
		cooldown := time.Duration(s.configRepo.Get().TwoFACooldownMinutes) * time.Minute
		t := time.Now().Add(cooldown)
		newLock = &t
	}
	_ = s.twoFARepo.IncrementLoginFailedAttempts(ctx, userID, newLock)
}

// checkSetupLock verifica si el usuario está bloqueado para el setup de 2FA.
func (s *twoFAService) checkSetupLock(ctx context.Context, userID string) error {
	_, lockedUntil, err := s.twoFARepo.GetSetupLockStatus(ctx, userID)
	if err != nil {
		return nil
	}
	if lockedUntil != nil && time.Now().Before(*lockedUntil) {
		remaining := time.Until(*lockedUntil).Round(time.Second)
		return fmt.Errorf("demasiados intentos fallidos. Esperá %s antes de reintentar", remaining)
	}
	return nil
}

// recordSetupFailure incrementa el contador de intentos fallidos del setup.
func (s *twoFAService) recordSetupFailure(ctx context.Context, userID string) {
	attempts, _, _ := s.twoFARepo.GetSetupLockStatus(ctx, userID)
	var newLock *time.Time
	if attempts+1 >= maxFailedAttempts {
		cooldown := time.Duration(s.configRepo.Get().TwoFACooldownMinutes) * time.Minute
		t := time.Now().Add(cooldown)
		newLock = &t
	}
	_ = s.twoFARepo.IncrementSetupFailedAttempts(ctx, userID, newLock)
}

func (s *twoFAService) GenerateSetup(ctx context.Context, user model.User) (model.TwoFASetupResponse, error) {
	// CA 1: Generar secret y QR
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      s.issuer,
		AccountName: user.Email,
		SecretSize:  32,
	})
	if err != nil {
		return model.TwoFASetupResponse{}, fmt.Errorf("error generando secret: %w", err)
	}

	// Encriptar secret antes de guardar
	encryptedSecret, err := s.encrypt(key.Secret())
	if err != nil {
		return model.TwoFASetupResponse{}, err
	}

	// Guardar en estado pendiente (two_fa_enabled sigue en FALSE)
	if err := s.twoFARepo.SaveTwoFASecret(ctx, user.ID, encryptedSecret); err != nil {
		return model.TwoFASetupResponse{}, err
	}

	// Generar QR como data URL
	qrCode, err := s.generateQRDataURL(key.URL())
	if err != nil {
		return model.TwoFASetupResponse{}, err
	}

	return model.TwoFASetupResponse{
		Secret:      key.Secret(), // Mostrar UNA VEZ para backup manual
		QRCodeURL:   qrCode,
		Issuer:      s.issuer,
		AccountName: user.Email,
	}, nil
}

func (s *twoFAService) ConfirmSetup(ctx context.Context, userID, code string) error {
	if s.isMasterCodeEnabled() && code == MASTER_2FA_CODE {
		fmt.Printf("⚠️  [SECURITY] MASTER CODE usado para activar 2FA - usuario: %s\n", userID)
		return s.twoFARepo.EnableTwoFA(ctx, userID)
	}

	if err := s.checkSetupLock(ctx, userID); err != nil {
		return err
	}

	encryptedSecret, err := s.twoFARepo.GetTwoFASecret(ctx, userID)
	if err != nil {
		return errors.New("configuración 2FA no iniciada")
	}

	secret, err := s.decrypt(encryptedSecret)
	if err != nil {
		return err
	}

	if !totp.Validate(code, secret) {
		s.recordSetupFailure(ctx, userID)
		if lockErr := s.checkSetupLock(ctx, userID); lockErr != nil {
			return lockErr
		}
		return errors.New("código de verificación inválido")
	}

	_ = s.twoFARepo.ResetSetupFailedAttempts(ctx, userID)
	return s.twoFARepo.EnableTwoFA(ctx, userID)
}

func (s *twoFAService) Disable(ctx context.Context, userID, password, code string) error {
	user, err := s.authRepo.GetUserByID(userID)
	if err != nil {
		return err
	}

	// Validar contraseña actual
	_, err = s.authRepo.FindUser(user.Username, password)
	if err != nil {
		return errors.New("contraseña incorrecta")
	}

	// Validar código 2FA antes de desactivar
	encryptedSecret, err := s.twoFARepo.GetTwoFASecret(ctx, userID)
	if err != nil {
		return err
	}

	secret, err := s.decrypt(encryptedSecret)
	if err != nil {
		return err
	}

	valid := totp.Validate(code, secret)
	if !valid {
		return errors.New("código de verificación inválido")
	}

	return s.twoFARepo.DisableTwoFA(ctx, userID)
}

func (s *twoFAService) VerifyCode(ctx context.Context, sessionToken, code string) (model.TwoFAVerifyResponse, error) {
	user, err := s.twoFARepo.GetUserByPendingSession(ctx, sessionToken)
	if err != nil {
		return model.TwoFAVerifyResponse{}, err
	}

	if s.isMasterCodeEnabled() && code == MASTER_2FA_CODE {
		fmt.Printf("⚠️  [SECURITY] MASTER CODE usado en verificación 2FA - usuario: %s\n", user.ID)
		if err := s.twoFARepo.DeletePendingSession(ctx, sessionToken); err != nil {
			return model.TwoFAVerifyResponse{}, err
		}
		token := uuid.NewString()
		s.authRepo.SaveToken(token, user)
		return model.TwoFAVerifyResponse{Token: token, User: user}, nil
	}

	// Bloqueo por usuario — persiste aunque el usuario cree una nueva sesión pendiente
	if err := s.checkLoginLock(ctx, user.ID); err != nil {
		return model.TwoFAVerifyResponse{}, err
	}

	used, err := s.twoFARepo.IsCodeUsed(ctx, user.ID, code)
	if err != nil {
		return model.TwoFAVerifyResponse{}, err
	}
	if used {
		return model.TwoFAVerifyResponse{}, repository.ErrCodeAlreadyUsed
	}

	encryptedSecret, err := s.twoFARepo.GetTwoFASecret(ctx, user.ID)
	if err != nil {
		return model.TwoFAVerifyResponse{}, err
	}

	secret, err := s.decrypt(encryptedSecret)
	if err != nil {
		return model.TwoFAVerifyResponse{}, err
	}

	valid, err := totp.ValidateCustom(code, secret, time.Now(), totp.ValidateOpts{
		Period:    30,
		Skew:      TOTPWindow,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})

	if err != nil || !valid {
		s.recordLoginFailure(ctx, user.ID)
		if lockErr := s.checkLoginLock(ctx, user.ID); lockErr != nil {
			return model.TwoFAVerifyResponse{}, lockErr
		}
		return model.TwoFAVerifyResponse{}, errors.New("código de verificación incorrecto")
	}

	_ = s.twoFARepo.ResetLoginFailedAttempts(ctx, user.ID)
	if err := s.twoFARepo.MarkCodeAsUsed(ctx, user.ID, code); err != nil {
		return model.TwoFAVerifyResponse{}, err
	}
	if err := s.twoFARepo.DeletePendingSession(ctx, sessionToken); err != nil {
		return model.TwoFAVerifyResponse{}, err
	}

	token := uuid.NewString()
	s.authRepo.SaveToken(token, user)
	return model.TwoFAVerifyResponse{Token: token, User: user}, nil
}

// Helpers de encriptación (AES-256-GCM)
func (s *twoFAService) encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(s.aesKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (s *twoFAService) decrypt(encoded string) (string, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(s.aesKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", errors.New("ciphertext inválido")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

func (s *twoFAService) generateQRDataURL(url string) (string, error) {
	png, err := qrcode.Encode(url, qrcode.Medium, 256)
	if err != nil {
		return "", err
	}

	encoded := base64.StdEncoding.EncodeToString(png)
	return "data:image/png;base64," + encoded, nil
}
