package repository

import "github.com/logitrack/core/internal/model"

type OrganizationRepository interface {
	Get() (*model.OrganizationConfig, error)
	Upsert(config model.OrganizationConfig) (*model.OrganizationConfig, error)
}
