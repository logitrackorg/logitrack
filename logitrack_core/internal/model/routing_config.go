package model

// RoutingConfig holds the parameters that drive the daily routing algorithm.
// Singleton row (id=1) editable by admin via /routing/config.
type RoutingConfig struct {
	SLAForceHorizonHours   int     `json:"sla_force_horizon_hours"`  // forzar despacho si SLA dentro de N horas
	PriorityForceThreshold float64 `json:"priority_force_threshold"` // forzar despacho si priority_score >= X
	MinFillRate            float64 `json:"min_fill_rate"`            // % mínimo de capacidad del vehículo más grande para consolidar
	MaxShipmentsPerDriver  int     `json:"max_shipments_per_driver"` // tope de envíos por chofer en última milla
	MaxWeightKgPerDriver   float64 `json:"max_weight_kg_per_driver"` // tope de peso por chofer en última milla
}

func DefaultRoutingConfig() RoutingConfig {
	return RoutingConfig{
		SLAForceHorizonHours:   24,
		PriorityForceThreshold: 0.75,
		MinFillRate:            0.40,
		MaxShipmentsPerDriver:  15,
		MaxWeightKgPerDriver:   150,
	}
}
