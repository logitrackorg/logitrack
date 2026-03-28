package repository

import (
	"database/sql"
	"encoding/json"

	"github.com/logitrack/core/internal/model"
)

type postgresCustomerRepository struct {
	db *sql.DB
}

func NewPostgresCustomerRepository(db *sql.DB) CustomerRepository {
	return &postgresCustomerRepository{db: db}
}

func (r *postgresCustomerRepository) Upsert(customer model.Customer) {
	if customer.DNI == "" {
		return
	}
	addr, err := json.Marshal(customer.Address)
	if err != nil {
		return
	}
	r.db.Exec(`
		INSERT INTO customers (dni, name, phone, email, address)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (dni) DO UPDATE SET
			name    = EXCLUDED.name,
			phone   = EXCLUDED.phone,
			email   = EXCLUDED.email,
			address = EXCLUDED.address`,
		customer.DNI, customer.Name, customer.Phone, customer.Email, addr,
	)
}

func (r *postgresCustomerRepository) GetByDNI(dni string) (model.Customer, bool) {
	var (
		c        model.Customer
		addrJSON []byte
	)
	err := r.db.QueryRow(`
		SELECT dni, name, phone, email, address FROM customers WHERE dni = $1`, dni,
	).Scan(&c.DNI, &c.Name, &c.Phone, &c.Email, &addrJSON)
	if err == sql.ErrNoRows {
		return model.Customer{}, false
	}
	if err != nil {
		return model.Customer{}, false
	}
	json.Unmarshal(addrJSON, &c.Address)
	return c, true
}
