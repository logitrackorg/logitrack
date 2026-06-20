package repository

import (
	"database/sql"
	"log"

	"github.com/logitrack/core/internal/model"
)

type SystemConfigRepository interface {
	Get() model.SystemConfig
	Update(cfg model.SystemConfig) error
}

type postgresSystemConfigRepository struct {
	db *sql.DB
}

func NewPostgresSystemConfigRepository(db *sql.DB) SystemConfigRepository {
	return &postgresSystemConfigRepository{db: db}
}

func (r *postgresSystemConfigRepository) Get() model.SystemConfig {
	var cfg model.SystemConfig
	err := r.db.QueryRow(`
		SELECT max_delivery_attempts, draft_retention_days, draft_purge_days,
		       pickup_deadline_days, email_notifications_enabled, whatsapp_notifications_enabled,
		       max_reschedules, max_reschedule_days, two_fa_cooldown_minutes, max_coverage_area_km2,
		       urgent_claims_cap_pct, claims_high_priority_threshold, claims_medium_priority_threshold,
		       claim_escalation_enabled, claim_escalation_baja_days, claim_escalation_media_days, claim_escalation_alta_days
		FROM system_config WHERE id = 1`).
		Scan(&cfg.MaxDeliveryAttempts, &cfg.DraftRetentionDays, &cfg.DraftPurgeDays,
			&cfg.PickupDeadlineDays, &cfg.EmailNotificationsEnabled, &cfg.WhatsAppNotificationsEnabled,
			&cfg.MaxReschedules, &cfg.MaxRescheduleDays, &cfg.TwoFACooldownMinutes, &cfg.MaxCoverageAreaKm2,
			&cfg.UrgentClaimsCapPct, &cfg.ClaimsHighPriorityThreshold, &cfg.ClaimsMediumPriorityThreshold,
			&cfg.ClaimEscalationEnabled, &cfg.ClaimEscalationBajaDays, &cfg.ClaimEscalationMediaDays, &cfg.ClaimEscalationAltaDays)
	if err != nil {
		log.Printf("❌ [REPO] Error leyendo config: %v", err)
		return model.DefaultSystemConfig()
	}
	log.Printf("✅ [REPO] Config leída de DB: MaxReschedules=%d, MaxRescheduleDays=%d",
		cfg.MaxReschedules, cfg.MaxRescheduleDays)
	return cfg
}

func (r *postgresSystemConfigRepository) Update(cfg model.SystemConfig) error {
	log.Printf("[DEBUG] Updating config: %+v", cfg)
	_, err := r.db.Exec(
		`UPDATE system_config
		 SET max_delivery_attempts            = $1,
		     draft_retention_days             = $2,
		     draft_purge_days                 = $3,
		     pickup_deadline_days             = $4,
		     email_notifications_enabled      = $5,
		     whatsapp_notifications_enabled   = $6,
		     max_reschedules                  = $7,
		     max_reschedule_days              = $8,
		     two_fa_cooldown_minutes          = $9,
		     max_coverage_area_km2            = $10,
		     urgent_claims_cap_pct            = $11,
		     claims_high_priority_threshold   = $12,
		     claims_medium_priority_threshold = $13,
		     claim_escalation_enabled         = $14,
		     claim_escalation_baja_days       = $15,
		     claim_escalation_media_days      = $16,
		     claim_escalation_alta_days       = $17
		 WHERE id = 1`,
		cfg.MaxDeliveryAttempts,
		cfg.DraftRetentionDays,
		cfg.DraftPurgeDays,
		cfg.PickupDeadlineDays,
		cfg.EmailNotificationsEnabled,
		cfg.WhatsAppNotificationsEnabled,
		cfg.MaxReschedules,
		cfg.MaxRescheduleDays,
		cfg.TwoFACooldownMinutes,
		cfg.MaxCoverageAreaKm2,
		cfg.UrgentClaimsCapPct,
		cfg.ClaimsHighPriorityThreshold,
		cfg.ClaimsMediumPriorityThreshold,
		cfg.ClaimEscalationEnabled,
		cfg.ClaimEscalationBajaDays,
		cfg.ClaimEscalationMediaDays,
		cfg.ClaimEscalationAltaDays,
	)
	if err != nil {
		log.Printf("[ERROR] Update failed: %v", err)
	}
	return err
}
