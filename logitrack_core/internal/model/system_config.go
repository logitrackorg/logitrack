package model

type SystemConfig struct {
	MaxDeliveryAttempts int `json:"max_delivery_attempts"`
}

func DefaultSystemConfig() SystemConfig {
	return SystemConfig{MaxDeliveryAttempts: 3}
}
