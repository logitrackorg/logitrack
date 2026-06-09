package service

import (
	"errors"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type PaymentConfigService struct {
	repo repository.PaymentConfigRepository
}

func NewPaymentConfigService(repo repository.PaymentConfigRepository) *PaymentConfigService {
	return &PaymentConfigService{repo: repo}
}

func (s *PaymentConfigService) Get() model.PaymentConfig {
	return s.repo.Get()
}

// Update saves non-sensitive fields only (flags, alias, CVU).
// Credential fields (MPAccessToken, MPWebhookSecret) are ignored here — use UpdateCredentials.
func (s *PaymentConfigService) Update(cfg model.PaymentConfig) (model.PaymentConfig, error) {
	current := s.repo.Get()
	cfg.MPAccessToken = current.MPAccessToken
	cfg.MPWebhookSecret = current.MPWebhookSecret
	if err := s.repo.Update(cfg); err != nil {
		return model.PaymentConfig{}, err
	}
	return s.repo.Get(), nil
}

// UpdateCredentials changes MPAccessToken and/or MPWebhookSecret.
// If the stored value is non-empty, the matching current* field must be provided and correct.
func (s *PaymentConfigService) UpdateCredentials(currentToken, newToken, currentSecret, newSecret string) (model.PaymentConfig, error) {
	current := s.repo.Get()

	if newToken != "" {
		if current.MPAccessToken != "" && current.MPAccessToken != currentToken {
			return model.PaymentConfig{}, errors.New("el access token actual no coincide")
		}
		current.MPAccessToken = newToken
	}

	if newSecret != "" {
		if current.MPWebhookSecret != "" && current.MPWebhookSecret != currentSecret {
			return model.PaymentConfig{}, errors.New("el webhook secret actual no coincide")
		}
		current.MPWebhookSecret = newSecret
	}

	if err := s.repo.Update(current); err != nil {
		return model.PaymentConfig{}, err
	}
	return s.repo.Get(), nil
}

// GetMPCredentials returns the live MP credentials for use as a CredentialProvider.
// DB credentials take precedence; empty values fall through to env-var fallback in the client.
func (s *PaymentConfigService) GetMPCredentials() (accessToken, webhookSecret string) {
	cfg := s.repo.Get()
	return cfg.MPAccessToken, cfg.MPWebhookSecret
}
