package model

type PaymentConfig struct {
	MPEnabled        bool   `json:"mp_enabled" db:"mp_enabled"`
	MockEnabled      bool   `json:"mock_enabled" db:"mock_enabled"`
	MPAlias          string `json:"mp_alias" db:"mp_alias"`
	MPCVU            string `json:"mp_cvu" db:"mp_cvu"`
	MPAccessToken    string `json:"mp_access_token" db:"mp_access_token"`
	MPWebhookSecret  string `json:"mp_webhook_secret" db:"mp_webhook_secret"`
}

func DefaultPaymentConfig() PaymentConfig {
	return PaymentConfig{
		MPEnabled:       true,
		MockEnabled:     false,
		MPAlias:         "",
		MPCVU:           "",
		MPAccessToken:   "",
		MPWebhookSecret: "",
	}
}
