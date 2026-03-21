package repository

import (
	"sync"

	"github.com/logitrack/core/internal/model"
)

type CustomerRepository interface {
	Upsert(customer model.Customer)
	GetByDNI(dni string) (model.Customer, bool)
}

type inMemoryCustomerRepository struct {
	mu        sync.RWMutex
	customers map[string]model.Customer
}

func NewInMemoryCustomerRepository() CustomerRepository {
	return &inMemoryCustomerRepository{
		customers: make(map[string]model.Customer),
	}
}

func (r *inMemoryCustomerRepository) Upsert(customer model.Customer) {
	if customer.DNI == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.customers[customer.DNI] = customer
}

func (r *inMemoryCustomerRepository) GetByDNI(dni string) (model.Customer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.customers[dni]
	return c, ok
}
