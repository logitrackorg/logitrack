package model

type SystemConfig struct {
	MaxDeliveryAttempts int `json:"max_delivery_attempts"`
	// DraftRetentionDays is the number of days a draft remains visible to operators
	// before the nightly job transitions it to "expired". Default: 7.
	DraftRetentionDays int `json:"draft_retention_days"`
	// DraftPurgeDays is the number of days after expiration before personal data
	// (name, DNI, email, phone, address) is irreversibly anonymized. Default: 30.
	DraftPurgeDays int `json:"draft_purge_days"`
	// PickupDeadlineDays is the number of days a shipment in ready_for_pickup can
	// be held before being returned. 0 = no deadline (default). Range: 0–365.
	PickupDeadlineDays int `json:"pickup_deadline_days"`
	// ForceEmailNotifications skips WhatsApp entirely and sends only email for all
	// customer-facing notifications. Useful for testing email templates or when
	// Twilio is unreliable. Default: false.
	ForceEmailNotifications bool `json:"force_email_notifications"`
}

func DefaultSystemConfig() SystemConfig {
	return SystemConfig{
		MaxDeliveryAttempts:     3,
		DraftRetentionDays:      7,
		DraftPurgeDays:          30,
		PickupDeadlineDays:      0,
		ForceEmailNotifications: false,
	}
}
