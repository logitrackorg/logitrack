package repository

import "github.com/logitrack/core/internal/model"

type CustomerRepository interface {
	Upsert(customer model.Customer)
	GetByDNI(dni string) (model.Customer, bool)
}
