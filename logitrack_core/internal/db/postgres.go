package db

import (
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

func NewDB(host, port, user, password, dbname string) (*sql.DB, error) {
	connStr := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=require",
		host, port, user, password, dbname,
	)
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("cannot connect to postgres: %w", err)
	}
	return db, nil
}
