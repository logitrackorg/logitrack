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
	MinFillRate            float64 `json:"min_fill_rate"`            // % mínimo de capacidad del vehículo más grande para consolidar (legado, reemplazado por los dos siguientes)

	// CA-07 (LOGITRACK-409): tasas independientes por tipo de viaje.
	MinFillLastMileRate    float64 `json:"min_fill_last_mile_rate"`    // tasa mínima para despacho de última milla (default 0.40)
	MinFillInterBranchRate float64 `json:"min_fill_inter_branch_rate"` // tasa mínima para despacho intersucursal (default 0.40)

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

	// FleetProjectionHorizonHours: ventana en horas para usar vehículos en tránsito
	// en el despacho proyectado. 0 = deshabilitado. Default 24.
	FleetProjectionHorizonHours int `json:"fleet_projection_horizon_hours"`

	// InterBranchDispatchHour es la hora fija de salida (local ART) para todos
	// los despachos inter-sucursal del día. Rango 0–23. Default 8 (08:00).
	InterBranchDispatchHour int `json:"inter_branch_dispatch_hour"`

	// InterBranchAvgSpeedKmh es la velocidad de ruta usada para estimar la llegada
	// de viajes inter-sucursal cuando la arista del grafo no tiene AvgTransitHours.
	// Es distinta de AvgSpeedKmh (velocidad urbana de última milla, ~25 km/h).
	// Rango 20–120. Default 60 (consistente con el baseline del seed del grafo).
	InterBranchAvgSpeedKmh float64 `json:"inter_branch_avg_speed_kmh"`

	// InterBranchStopMinutes es el dwell (descarga + carga de pallets) en una parada
	// intermedia de un viaje inter-sucursal multi-hop. Independiente de
	// ServiceTimeMinutes (que es el tiempo de entrega de última milla, timbre + firma).
	// Rango 0–1440. Default 240 (4 horas).
	InterBranchStopMinutes int `json:"inter_branch_stop_minutes"`

	// PlanningHorizonDays es la cantidad de días que cubre el plan global (incluyendo hoy).
	// 1=solo hoy (comportamiento legacy); 3=hoy + 2 pronósticos. Rango 1–7. Default 3.
	PlanningHorizonDays int `json:"planning_horizon_days"`

	// BackhaulEnabled activa el backhauling inter-sucursal: cuando un vehículo va de A→B,
	// si en B hay carga que justifica el retorno (min_fill o SLA), se arma el round-trip A→B→A.
	// Default true.
	BackhaulEnabled bool `json:"backhaul_enabled"`

	// KeepOneVehiclePerBranch activa el balanceo de flota blando: el motor evita vaciar una
	// sucursal activa de vehículos (presentes o en viaje hacia ella) reteniendo el último
	// despacho one-way si no hay SLA que lo fuerce. Default true.
	KeepOneVehiclePerBranch bool `json:"keep_one_vehicle_per_branch"`
}

func DefaultRoutingConfig() RoutingConfig {
	return RoutingConfig{
		SLAForceHorizonHours:     24,
		PriorityForceThreshold:   0.75,
		MinFillRate:              0.40,
		MinFillLastMileRate:      0.40,
		MinFillInterBranchRate:   0.40,
		EnforceTimeWindows:       true,
		MorningWindowStartHour:   8,
		MorningWindowEndHour:     14,
		AfternoonWindowStartHour: 12,
		AfternoonWindowEndHour:   18,
		ServiceTimeMinutes:       10,
		AvgSpeedKmh:              25.0,
		LastMilePackingStrategy:  PackingStrategyMaximizeCapacity,
		InterBranchDispatchHour:  8,
		InterBranchAvgSpeedKmh:   60.0,
		InterBranchStopMinutes:   240,
		PlanningHorizonDays:      3,
		BackhaulEnabled:             true,
		KeepOneVehiclePerBranch:     true,
		FleetProjectionHorizonHours: 24,
	}
}
