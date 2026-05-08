package model

const (
	WeightTierMidLowKg  = 5.0
	WeightTierHighLowKg = 25.0

	CurrencyARS = "ARS"
)

type PricingConfig struct {
	BaseFare                        float64 `json:"base_fare"`
	CostPerKm                       float64 `json:"cost_per_km"`
	WeightSurchargeMid              float64 `json:"weight_surcharge_mid"`
	WeightSurchargeHigh             float64 `json:"weight_surcharge_high"`
	LastMileSurcharge               float64 `json:"last_mile_surcharge"`
	ShipmentExpressMultiplier       float64 `json:"shipment_express_multiplier"`
	TimeWindowRestrictiveMultiplier float64 `json:"time_window_restrictive_multiplier"`
	FragileMultiplier               float64 `json:"fragile_multiplier"`
}

func DefaultPricingConfig() PricingConfig {
	return PricingConfig{
		BaseFare:                        10000,
		CostPerKm:                       25,
		WeightSurchargeMid:              5000,
		WeightSurchargeHigh:             25000,
		LastMileSurcharge:               5000,
		ShipmentExpressMultiplier:       1.2,
		TimeWindowRestrictiveMultiplier: 1.05,
		FragileMultiplier:               1.20,
	}
}

// PriceBreakdown desglosa el precio final por componente para auditoría y UI.
type PriceBreakdown struct {
	BaseFare           float64 `json:"base_fare"`
	DistanceKm         float64 `json:"distance_km"`
	DistanceCost       float64 `json:"distance_cost"`
	WeightSurcharge    float64 `json:"weight_surcharge"`
	LastMileSurcharge  float64 `json:"last_mile_surcharge"`
	ShipmentMultiplier float64 `json:"shipment_multiplier"`
	TimeWindowSurplus  float64 `json:"time_window_surplus"`
	FragileSurplus     float64 `json:"fragile_surplus"`
	Subtotal           float64 `json:"subtotal"`
	Total              float64 `json:"total"`
}

// IsTimeWindowRestrictive returns true when the window is morning or afternoon
// (a fixed half-day slot). Flexible windows allow any-time delivery.
func IsTimeWindowRestrictive(w TimeWindow) bool {
	return w == TimeWindowMorning || w == TimeWindowAfternoon
}

// TimeWindowMultiplier returns the price multiplier that applies to a time window.
// Restrictive windows (morning/afternoon) use the configured multiplier; flexible uses 1.0.
func TimeWindowMultiplier(w TimeWindow, cfg PricingConfig) float64 {
	if IsTimeWindowRestrictive(w) {
		return cfg.TimeWindowRestrictiveMultiplier
	}
	return 1.0
}

// ShipmentTypeMultiplier returns the multiplier (≥ 1.0) that applies to a shipment type.
func ShipmentTypeMultiplier(t ShipmentType, cfg PricingConfig) float64 {
	if t == ShipmentTypeExpress {
		return cfg.ShipmentExpressMultiplier
	}
	return 1.0
}
