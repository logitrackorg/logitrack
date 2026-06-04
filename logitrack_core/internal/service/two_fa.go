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

const (
	TwoFAPendingSessionDuration = 5 * time.Minute
	TOTPWindow                  = 1 // Permite 1 período antes/después (60s tolerancia)
)

type TwoFAService interface {
	// Configuración
	GenerateSetup(ctx context.Context, user model.User) (model.TwoFASetupResponse, error)
	ConfirmSetup(ctx context.Context, userID, code string) error
	Disable(ctx context.Context, userID, password, code string) error
	
	// Login con 2FA
	VerifyCode(ctx context.Context, sessionToken, code string) (model.TwoFAVerifyResponse, error)
}

type twoFAService struct {
	twoFARepo repository.TwoFARepository
	authRepo  repository.AuthRepository
	issuer    string
	aesKey    []byte
}

func NewTwoFAService(
	twoFARepo repository.TwoFARepository,
	authRepo repository.AuthRepository,
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
		twoFARepo: twoFARepo,
		authRepo:  authRepo,
		issuer:    issuer,
		aesKey:    aesKey,
	}
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
	// CA 2: Validar código de activación
	encryptedSecret, err := s.twoFARepo.GetTwoFASecret(ctx, userID)
	if err != nil {
		return errors.New("configuración 2FA no iniciada")
	}
	
	secret, err := s.decrypt(encryptedSecret)
	if err != nil {
		return err
	}
	
	valid := totp.Validate(code, secret)
	if !valid {
		// CA 3: Código inválido
		return errors.New("código de verificación inválido")
	}
	
	// Activar definitivamente
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
	// CA 1: Obtener usuario del token temporal
	user, err := s.twoFARepo.GetUserByPendingSession(ctx, sessionToken)
	if err != nil {
		return model.TwoFAVerifyResponse{}, err
	}
	
	// CA 3: Prevención de replay attacks
	used, err := s.twoFARepo.IsCodeUsed(ctx, user.ID, code)
	if err != nil {
		return model.TwoFAVerifyResponse{}, err
	}
	if used {
		return model.TwoFAVerifyResponse{}, repository.ErrCodeAlreadyUsed
	}
	
	// CA 1: Validación matemática
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
		// CA 2: Código inválido o vencido
		return model.TwoFAVerifyResponse{}, errors.New("código de verificación incorrecto")
	}
	
	// Marcar código como usado
	if err := s.twoFARepo.MarkCodeAsUsed(ctx, user.ID, code); err != nil {
		return model.TwoFAVerifyResponse{}, err
	}
	
	// Destruir sesión temporal y crear token definitivo
	if err := s.twoFARepo.DeletePendingSession(ctx, sessionToken); err != nil {
		return model.TwoFAVerifyResponse{}, err
	}
	
	token := uuid.NewString()
	s.authRepo.SaveToken(token, user)
	
	return model.TwoFAVerifyResponse{
		Token: token,
		User:  user,
	}, nil
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