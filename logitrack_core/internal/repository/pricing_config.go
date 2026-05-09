package repository

import (
	"database/sql"

	"github.com/logitrack/core/internal/model"
)

type PricingConfigRepository interface {
	Get() model.PricingConfig
	Update(cfg model.PricingConfig) error
}

type postgresPricingConfigRepository struct {
	db *sql.DB
}

func NewPostgresPricingConfigRepository(db *sql.DB) PricingConfigRepository {
	return &postgresPricingConfigRepository{db: db}
}

func (r *postgresPricingConfigRepository) Get() model.PricingConfig {
	var cfg model.PricingConfig
	err := r.db.QueryRow(`
		SELECT base_fare, cost_per_km, weight_surcharge_mid, weight_surcharge_high,
		       last_mile_surcharge, risky_zone_surcharge, shipment_express_multiplier,
		       time_window_restrictive_multiplier, fragile_multiplier
		FROM pricing_config WHERE id = 1`).
		Scan(
			&cfg.BaseFare, &cfg.CostPerKm, &cfg.WeightSurchargeMid, &cfg.WeightSurchargeHigh,
			&cfg.LastMileSurcharge, &cfg.RiskyZoneSurcharge, &cfg.ShipmentExpressMultiplier,
			&cfg.TimeWindowRestrictiveMultiplier, &cfg.FragileMultiplier,
		)
	if err != nil {
		return model.DefaultPricingConfig()
	}
	return cfg
}

func (r *postgresPricingConfigRepository) Update(cfg model.PricingConfig) error {
	_, err := r.db.Exec(`
		UPDATE pricing_config SET
			base_fare                          = $1,
			cost_per_km                        = $2,
			weight_surcharge_mid               = $3,
			weight_surcharge_high              = $4,
			last_mile_surcharge                = $5,
			risky_zone_surcharge               = $6,
			shipment_express_multiplier        = $7,
			time_window_restrictive_multiplier = $8,
			fragile_multiplier                 = $9
		WHERE id = 1`,
		cfg.BaseFare, cfg.CostPerKm, cfg.WeightSurchargeMid, cfg.WeightSurchargeHigh,
		cfg.LastMileSurcharge, cfg.RiskyZoneSurcharge, cfg.ShipmentExpressMultiplier,
		cfg.TimeWindowRestrictiveMultiplier, cfg.FragileMultiplier,
	)
	return err
}
