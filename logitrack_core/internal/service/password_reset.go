package service

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/email"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrRateLimited  = errors.New("demasiadas solicitudes — intentá de nuevo en 15 minutos")
	ErrWeakPassword = errors.New("la contraseña debe tener al menos 8 caracteres y un número")
)

const (
	otpTTL          = 5 * time.Minute
	rateLimitWindow = 15 * time.Minute
	rateLimitMax    = 3
)

type PasswordResetService struct {
	authRepo      repository.AuthRepository
	resetRepo     repository.PasswordResetRepository
	emailSvc      *email.Service
	twilioSID     string
	twilioToken   string
	twilioFrom    string
	accessLogRepo repository.AccessLogRepository
	rateLimiter   sync.Map // userID → []time.Time
}

func NewPasswordResetService(
	authRepo repository.AuthRepository,
	resetRepo repository.PasswordResetRepository,
	emailSvc *email.Service,
	twilioSID, twilioToken, twilioFrom string,
	accessLogRepo repository.AccessLogRepository,
) *PasswordResetService {
	return &PasswordResetService{
		authRepo:      authRepo,
		resetRepo:     resetRepo,
		emailSvc:      emailSvc,
		twilioSID:     twilioSID,
		twilioToken:   twilioToken,
		twilioFrom:    twilioFrom,
		accessLogRepo: accessLogRepo,
	}
}

func (s *PasswordResetService) RequestReset(username string) error {
	user, found := s.authRepo.FindUserByUsername(username)
	if !found {
		return nil
	}

	if user.Email == "" && user.Phone == "" {
		log.Printf("[password_reset] usuario %s sin email ni teléfono — solicitud ignorada", username)
		return nil
	}

	// Rate limit: check in-memory first, then DB
	now := clock.Now()
	since := now.Add(-rateLimitWindow)
	count, err := s.resetRepo.CountRecentByUser(user.ID, since)
	if err != nil {
		log.Printf("[password_reset] error al contar tokens recientes para %s: %v", username, err)
	}
	if count >= rateLimitMax {
		return ErrRateLimited
	}

	// Generate 6-digit OTP
	otp, err := generateOTP()
	if err != nil {
		return fmt.Errorf("error generando OTP: %w", err)
	}

	// Hash and persist with TTL
	hashed, err := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("error hasheando OTP: %w", err)
	}
	expiresAt := now.Add(otpTTL)
	if err := s.resetRepo.Create(user.ID, string(hashed), expiresAt); err != nil {
		return fmt.Errorf("error guardando token: %w", err)
	}

	// Send via preferred channel
	sent := false
	if user.Phone != "" && s.whatsappConfigured() {
		if err := s.sendWhatsAppOTP(user.Phone, user.Username, otp); err != nil {
			log.Printf("[password_reset] WhatsApp falló para %s (%s): %v — intentando email como fallback", username, user.Phone, err)
		} else {
			sent = true
			log.Printf("[password_reset] OTP enviado por WhatsApp a %s para %s", user.Phone, username)
		}
	}
	if !sent && user.Email != "" && s.emailSvc != nil {
		s.emailSvc.SendPasswordResetOTP(user.Email, user.Username, otp)
		sent = true
		log.Printf("[password_reset] OTP enviado por email a %s para %s", user.Email, username)
	}
	if !sent {
		log.Printf("[password_reset] no se pudo enviar OTP para %s — sin canal disponible", username)
	}

	_ = s.accessLogRepo.Log(model.AccessLog{
		ID:        uuid.NewString(),
		Username:  user.Username,
		UserID:    user.ID,
		EventType: model.AccessEventPasswordResetRequested,
		Timestamp: now,
	})
	return nil
}

func (s *PasswordResetService) ConfirmReset(username, otp, newPassword string) error {
	user, found := s.authRepo.FindUserByUsername(username)
	if !found {
		return fmt.Errorf("usuario no encontrado")
	}

	if len(newPassword) < 8 {
		return ErrWeakPassword
	}
	hasDigit := false
	for _, r := range newPassword {
		if unicode.IsDigit(r) {
			hasDigit = true
			break
		}
	}
	if !hasDigit {
		return ErrWeakPassword
	}

	token, err := s.resetRepo.FindValidByUser(user.ID)
	if err != nil {
		return fmt.Errorf("error al buscar token: %w", err)
	}
	if token == nil {
		return fmt.Errorf("código inválido, expirado o ya utilizado")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(token.TokenHash), []byte(otp)); err != nil {
		return fmt.Errorf("código inválido, expirado o ya utilizado")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("error hasheando contraseña: %w", err)
	}
	if err := s.authRepo.UpdatePassword(user.ID, string(hashed)); err != nil {
		return fmt.Errorf("error actualizando contraseña: %w", err)
	}

	if err := s.resetRepo.MarkUsed(token.ID); err != nil {
		log.Printf("[password_reset] error marcando token como usado para %s: %v", username, err)
	}

	if user.Email != "" {
		go s.emailSvc.SendPasswordChangedNotification(user.Email, user.Username)
	}

	_ = s.accessLogRepo.Log(model.AccessLog{
		ID:        uuid.NewString(),
		Username:  user.Username,
		UserID:    user.ID,
		EventType: model.AccessEventPasswordResetConfirmed,
		Timestamp: clock.Now(),
	})
	return nil
}

func (s *PasswordResetService) whatsappConfigured() bool {
	return s.twilioSID != "" && s.twilioToken != "" && s.twilioFrom != ""
}

func (s *PasswordResetService) sendWhatsAppOTP(phone, username, otp string) error {
	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", s.twilioSID)

	to := phone
	if !strings.HasPrefix(phone, "whatsapp:") {
		to = "whatsapp:" + phone
	}

	msg := fmt.Sprintf("🔐 Tu código de verificación de LogiTrack es: *%s*\n\nEste código expira en 5 minutos. No lo compartas con nadie.", otp)

	data := url.Values{}
	data.Set("To", to)
	data.Set("From", s.twilioFrom)
	data.Set("Body", msg)

	req, err := http.NewRequest(http.MethodPost, apiURL, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(s.twilioSID, s.twilioToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("twilio %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func generateOTP() (string, error) {
	var buf [3]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	n := (int(buf[0])<<16 | int(buf[1])<<8 | int(buf[2])) % 1_000_000
	return fmt.Sprintf("%06d", n), nil
}
