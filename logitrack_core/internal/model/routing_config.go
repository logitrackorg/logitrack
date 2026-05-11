package model

// LastMilePackingStrategy selecciona la heurística de asignación de envíos a
// choferes en última milla.
type LastMilePackingStrategy string

const (
	// PackingStrategyBalanced reparte parejo entre choferes (load-balancing por peso).
	PackingStrategyBalanced LastMilePackingStrategy = "balanced"
	// PackingStrategyMaximizeCapacity satura el primer chofer hasta su tope de
	// peso antes de abrir el siguiente.
	PackingStrategyMaximizeCapacity LastMilePackingStrategy = "maximize_capacity"
)

// RoutingConfig holds the parameters that drive the daily routing algorithm.
// Singleton row (id=1) editable by admin via /routing/config.
type RoutingConfig struct {
	SLAForceHorizonHours   int     `json:"sla_force_horizon_hours"`  // forzar despacho si SLA dentro de N horas
	PriorityForceThreshold float64 `json:"priority_force_threshold"` // forzar despacho si priority_score >= X
	MinFillRate            float64 `json:"min_fill_rate"`            // % mínimo de capacidad del vehículo más grande para consolidar

	// Si EnforceTimeWindows=true, los envíos fuera de ventana quedan unassigned.
	// Si EnforceTimeWindows=false, se incluyen en la ruta con un aviso visible.
	EnforceTimeWindows bool `json:"enforce_time_windows"` // default true (ventanas duras)

	// Definición admin-editable de las ventanas operativas.
	MorningWindowStartHour   int `json:"morning_window_start_hour"`
	MorningWindowEndHour     int `json:"morning_window_end_hour"`
	AfternoonWindowStartHour int `json:"afternoon_window_start_hour"`
	AfternoonWindowEndHour   int `json:"afternoon_window_end_hour"`

	// Parámetros del solver VRP para última milla.
	ServiceTimeMinutes int     `json:"service_time_minutes"` // tiempo por entrega (timbre + firma)
	AvgSpeedKmh        float64 `json:"avg_speed_kmh"`        // velocidad promedio entre paradas

	// Estrategia de asignación de envíos a choferes.
	LastMilePackingStrategy LastMilePackingStrategy `json:"last_mile_packing_strategy"`
}

func DefaultRoutingConfig() RoutingConfig {
	return RoutingConfig{
		SLAForceHorizonHours:     24,
		PriorityForceThreshold:   0.75,
		MinFillRate:              0.40,
		EnforceTimeWindows:       true,
		MorningWindowStartHour:   8,
		MorningWindowEndHour:     14,
		AfternoonWindowStartHour: 12,
		AfternoonWindowEndHour:   18,
		ServiceTimeMinutes:       10,
		AvgSpeedKmh:              25.0,
		LastMilePackingStrategy:  PackingStrategyMaximizeCapacity,
	}
}
