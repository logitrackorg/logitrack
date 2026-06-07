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
		       pickup_deadline_days, force_email_notifications, max_reschedules,max_reschedule_days,two_fa_cooldown_minutes
		FROM system_config WHERE id = 1`).
		Scan(&cfg.MaxDeliveryAttempts, &cfg.DraftRetentionDays, &cfg.DraftPurgeDays, 
			&cfg.PickupDeadlineDays, &cfg.ForceEmailNotifications, &cfg.MaxReschedules, &cfg.MaxRescheduleDays, &cfg.TwoFACooldownMinutes,)
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
		 SET max_delivery_attempts       = $1,
		     draft_retention_days        = $2,
		     draft_purge_days            = $3,
		     pickup_deadline_days        = $4,
		     force_email_notifications   = $5,
		     max_reschedules             = $6,
			 max_reschedule_days         = $7,
			 two_fa_cooldown_minutes 	 = $8
		 WHERE id = 1`,
		cfg.MaxDeliveryAttempts,
		cfg.DraftRetentionDays,
		cfg.DraftPurgeDays,
		cfg.PickupDeadlineDays,
		cfg.ForceEmailNotifications,
		cfg.MaxReschedules, 
		cfg.MaxRescheduleDays,
		cfg.TwoFACooldownMinutes, 
	)
	if err != nil {
		log.Printf("[ERROR] Update failed: %v", err) 
	}
	return err
}