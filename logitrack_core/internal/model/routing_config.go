package model

// RoutingConfig holds the parameters that drive the daily routing algorithm.
// Singleton row (id=1) editable by admin via /routing/config.
type RoutingConfig struct {
	SLAForceHorizonHours   int     `json:"sla_force_horizon_hours"`  // forzar despacho si SLA dentro de N horas
	PriorityForceThreshold float64 `json:"priority_force_threshold"` // forzar despacho si priority_score >= X
	MinFillRate            float64 `json:"min_fill_rate"`            // % mínimo de capacidad del vehículo más grande para consolidar

	// Si EnforceTimeWindows=true, los envíos fuera de ventana quedan unassigned.
	// Si EnforceTimeWindows=false, se incluyen en la ruta con un aviso visible.
	EnforceTimeWindows bool `json:"enforce_time_windows"` // default false (ventanas blandas)
}

func DefaultRoutingConfig() RoutingConfig {
	return RoutingConfig{
		SLAForceHorizonHours:   24,
		PriorityForceThreshold: 0.75,
		MinFillRate:            0.40,
		EnforceTimeWindows:     false,
	}
}
