package model

// RoutingConfig holds the parameters that drive the daily routing algorithm.
// Singleton row (id=1) editable by admin via /routing/config.
type RoutingConfig struct {
	SLAForceHorizonHours   int     `json:"sla_force_horizon_hours"`  // forzar despacho si SLA dentro de N horas
	PriorityForceThreshold float64 `json:"priority_force_threshold"` // forzar despacho si priority_score >= X
	MinFillRate            float64 `json:"min_fill_rate"`            // % mínimo de capacidad del vehículo más grande para consolidar
	MaxShipmentsPerDriver  int     `json:"max_shipments_per_driver"` // tope de envíos por chofer en última milla
	MaxWeightKgPerDriver   float64 `json:"max_weight_kg_per_driver"` // tope de peso por chofer en última milla

	// Ventanas horarias de entrega — aplicadas por el solver VRP de última milla.
	// Si EnforceTimeWindows=true, los envíos fuera de ventana quedan unassigned.
	// Si EnforceTimeWindows=false, se incluyen en la ruta con un aviso visible.
	EnforceTimeWindows       bool    `json:"enforce_time_windows"`        // default true (ventanas duras)
	MorningWindowStartHour   int     `json:"morning_window_start_hour"`   // default 8  (08:00)
	MorningWindowEndHour     int     `json:"morning_window_end_hour"`     // default 14 (14:00)
	AfternoonWindowStartHour int     `json:"afternoon_window_start_hour"` // default 12 (12:00)
	AfternoonWindowEndHour   int     `json:"afternoon_window_end_hour"`   // default 18 (18:00)
	ServiceTimeMinutes       int     `json:"service_time_minutes"`        // minutos por parada, default 10
	AvgSpeedKmh              float64 `json:"avg_speed_kmh"`               // velocidad promedio fallback Haversine, default 25
}

func DefaultRoutingConfig() RoutingConfig {
	return RoutingConfig{
		SLAForceHorizonHours:     24,
		PriorityForceThreshold:   0.75,
		MinFillRate:              0.40,
		MaxShipmentsPerDriver:    15,
		MaxWeightKgPerDriver:     150,
		EnforceTimeWindows:       true,
		MorningWindowStartHour:   8,
		MorningWindowEndHour:     14,
		AfternoonWindowStartHour: 12,
		AfternoonWindowEndHour:   18,
		ServiceTimeMinutes:       10,
		AvgSpeedKmh:              25,
	}
}
