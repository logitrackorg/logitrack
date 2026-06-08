package repository

import "github.com/logitrack/core/internal/model"

type PaymentConfigRepository interface {
	Get() model.PaymentConfig
	Update(cfg model.PaymentConfig) error
}
