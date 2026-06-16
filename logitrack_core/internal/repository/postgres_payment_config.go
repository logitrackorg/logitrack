package repository

import (
	"database/sql"
	"log"

	appcrypto "github.com/logitrack/core/internal/crypto"
	"github.com/logitrack/core/internal/model"
)

type postgresPaymentConfigRepository struct {
	db  *sql.DB
	key []byte // AES-256 key derived from PAYMENT_SECRET_KEY env var; nil = no encryption
}

func NewPostgresPaymentConfigRepository(db *sql.DB) PaymentConfigRepository {
	key := appcrypto.KeyFromEnv("PAYMENT_SECRET_KEY")
	if len(key) == 0 {
		log.Println("[payment-config] PAYMENT_SECRET_KEY no configurada — credenciales MP sin cifrar en DB")
	}
	return &postgresPaymentConfigRepository{db: db, key: key}
}

func (r *postgresPaymentConfigRepository) Get() model.PaymentConfig {
	var cfg model.PaymentConfig
	var encToken, encSecret string
	err := r.db.QueryRow(`
		SELECT mp_enabled, mock_enabled, transfer_enabled, transfer_holder, mp_alias, mp_cvu, mp_access_token, mp_webhook_secret
		FROM payment_config WHERE id = 1`).
		Scan(&cfg.MPEnabled, &cfg.MockEnabled, &cfg.TransferEnabled, &cfg.TransferHolder, &cfg.MPAlias, &cfg.MPCVU, &encToken, &encSecret)
	if err != nil {
		return model.DefaultPaymentConfig()
	}

	if token, err := appcrypto.Decrypt(encToken, r.key); err != nil {
		log.Printf("[payment-config] error al descifrar access_token: %v", err)
	} else {
		cfg.MPAccessToken = token
	}

	if secret, err := appcrypto.Decrypt(encSecret, r.key); err != nil {
		log.Printf("[payment-config] error al descifrar webhook_secret: %v", err)
	} else {
		cfg.MPWebhookSecret = secret
	}

	return cfg
}

func (r *postgresPaymentConfigRepository) Update(cfg model.PaymentConfig) error {
	_, err := r.db.Exec(`
		UPDATE payment_config
		SET mp_enabled = $1, mock_enabled = $2, transfer_enabled = $3, transfer_holder = $4,
		    mp_alias = $5, mp_cvu = $6, mp_access_token = $7, mp_webhook_secret = $8
		WHERE id = 1`,
		cfg.MPEnabled, cfg.MockEnabled, cfg.TransferEnabled, cfg.TransferHolder,
		cfg.MPAlias, cfg.MPCVU,
		appcrypto.Encrypt(cfg.MPAccessToken, r.key),
		appcrypto.Encrypt(cfg.MPWebhookSecret, r.key),
	)
	return err
}
