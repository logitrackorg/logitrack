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
	
	// EmailNotificationsEnabled controls whether email notifications are sent to customers.
	// Default: true.
	EmailNotificationsEnabled bool `json:"email_notifications_enabled"`

	// WhatsAppNotificationsEnabled controls whether WhatsApp notifications are sent to customers.
	// Default: true.
	WhatsAppNotificationsEnabled bool `json:"whatsapp_notifications_enabled"`
	
	// MaxReschedules defines the maximum number of times a customer can 
	// reschedule delivery via chatbot before requiring manual intervention. 
	// Default: 2. Range: 0-10 (CA02 validation).
	MaxReschedules int `json:"max_reschedules"`
	MaxRescheduleDays  int `json:"max_reschedule_days"`
	TwoFACooldownMinutes int `json:"two_fa_cooldown_minutes" db:"two_fa_cooldown_minutes"`

	// MaxCoverageAreaKm2 is the branch-coverage threshold for the gap detector.
	// A Voronoi cell whose service area exceeds this value (in km²) is flagged as
	// an under-covered zone. The Voronoi diagram spans a fixed national bounding
	// box (~6.7M km²), so cell areas are on the order of hundreds of thousands to
	// millions of km². Default: 1000000. Range: 100–10000000.
	MaxCoverageAreaKm2 float64 `json:"max_coverage_area_km2" db:"max_coverage_area_km2"`

	// UrgentClaimsCapPct caps the ratio of "urgente" tickets in a branch's open
	// pool. Anti-inflación: si al crear un reclamo la prioridad calculada es
	// urgente y la sucursal ya supera este tope, se degrada a alta.
	// Rango (0, 1]. Default: 0.20.
	UrgentClaimsCapPct float64 `json:"urgent_claims_cap_pct" db:"urgent_claims_cap_pct"`

	// ClaimsHighPriorityThreshold es el umbral de priority_score del ML del envío
	// que dispara prioridad alta del reclamo. Default: 0.65. Rango (0, 1].
	ClaimsHighPriorityThreshold float64 `json:"claims_high_priority_threshold" db:"claims_high_priority_threshold"`

	// ClaimsMediumPriorityThreshold es el umbral de priority_score que dispara
	// prioridad media del reclamo. Debe ser estrictamente menor que el alto.
	// Default: 0.35. Rango (0, 1].
	ClaimsMediumPriorityThreshold float64 `json:"claims_medium_priority_threshold" db:"claims_medium_priority_threshold"`
}

func DefaultSystemConfig() SystemConfig {
	return SystemConfig{
		MaxDeliveryAttempts:     3,
		DraftRetentionDays:      7,
		DraftPurgeDays:          30,
		PickupDeadlineDays:      0,
		EmailNotificationsEnabled:    true,
		WhatsAppNotificationsEnabled: true,
		MaxReschedules:          2, 
		MaxRescheduleDays:       3,
		TwoFACooldownMinutes: 1,
		MaxCoverageAreaKm2:   1000000,
		UrgentClaimsCapPct:            0.20,
		ClaimsHighPriorityThreshold:   0.65,
		ClaimsMediumPriorityThreshold: 0.35,
	}
}