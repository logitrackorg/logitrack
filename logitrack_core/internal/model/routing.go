package model

import "time"

// DispatchRule indica por qué se decidió despachar un grupo inter-sucursal.
type DispatchRule string

const (
	DispatchRuleSLA           DispatchRule = "sla_forced"
	DispatchRuleConsolidation DispatchRule = "consolidation"
)

// LastMileAssignment agrupa los envíos que el algoritmo asignó a un chofer
// para entrega de última milla en su ruta del día.
//
// Shipments y TotalWeightKg corresponden únicamente a los envíos NUEVOS que
// este plan agrega al chofer. ExistingCount/ExistingWeightKg reflejan la carga
// pendiente que ya tenía asignada en su ruta del día (out_for_delivery /
// delivery_failed). Los caps de la config se chequean contra el total
// (existente + nuevos), para no exceder el peso ni la cantidad acumulando
// entre múltiples Apply consecutivos.
//
// Cuando el solver de VRP corre exitosamente, OrderedStops contiene la
// secuencia óptima de paradas con tiempos estimados, Shipments preserva
// el mismo orden, y OptimizedBy = "vrp". Si el solver fallea (depot sin
// coords, error inesperado) se cae al greedy clásico y OptimizedBy = "greedy"
// — en ese caso OrderedStops puede venir vacío.
type LastMileAssignment struct {
	DriverID         string   `json:"driver_id"`
	DriverName       string   `json:"driver_name,omitempty"`
	Shipments        []string `json:"shipments"` // tracking IDs nuevos
	TotalWeightKg    float64  `json:"total_weight_kg"`
	ExistingCount    int      `json:"existing_count"`
	ExistingWeightKg float64  `json:"existing_weight_kg"`
	// Tracking IDs de envíos que el chofer ya tenía en su ruta del día
	// (out_for_delivery / delivery_failed). Útil para que la UI los muestre
	// en la card del chofer junto con los nuevos.
	ExistingShipments []string `json:"existing_shipments,omitempty"`

	// Campos VRP (omitidos si el plan se generó con greedy).
	OrderedStops     []RouteStop `json:"ordered_stops,omitempty"`
	TotalDistanceKm  float64     `json:"total_distance_km,omitempty"`
	TotalDurationMin int         `json:"total_duration_min,omitempty"`
	DepartureMin     int         `json:"departure_min,omitempty"` // base para arrival_min, en min desde medianoche
	OptimizedBy      string      `json:"optimized_by,omitempty"`  // "vrp" | "greedy"
}

// RouteStop es una parada dentro de una ruta optimizada por VRP.
//
// Sequence es 1-based (la primera parada del día es 1). ArrivalMin es el
// delta en minutos desde DepartureMin (definido en LastMileAssignment) hasta
// la llegada al cliente. Si Unsequenced=true (envío sin coordenadas), ArrivalMin
// es -1 — el chofer atiende esa parada al final de la ruta sin tiempo estimado.
type RouteStop struct {
	TrackingID  string  `json:"tracking_id"`
	Sequence    int     `json:"sequence"`
	ArrivalMin  int     `json:"arrival_min"`
	Unsequenced bool    `json:"unsequenced,omitempty"`
	TimeWindow  string  `json:"time_window,omitempty"`
	WeightKg    float64 `json:"weight_kg"`
}

// InterBranchAssignment es un despacho de un vehículo a una sucursal destino.
// Todos los shipments del despacho tienen el mismo final_branch_id.
//
// Shipments y TotalWeightKg corresponden únicamente a los envíos NUEVOS que
// este plan agrega. ExistingWeightKg es la carga que el vehículo ya tenía
// asignada (status en_carga). El cap CapacityKg se chequea contra el total
// (existente + nuevo), para no exceder la capacidad acumulando entre múltiples
// Apply consecutivos.
type InterBranchAssignment struct {
	VehicleID         string       `json:"vehicle_id"`
	LicensePlate      string       `json:"license_plate"`
	DestinationBranch string       `json:"destination_branch"`
	Rule              DispatchRule `json:"rule"`
	Shipments         []string     `json:"shipments"`
	TotalWeightKg     float64      `json:"total_weight_kg"`
	CapacityKg        float64      `json:"capacity_kg"`
	ExistingWeightKg  float64      `json:"existing_weight_kg"`
	// Tracking IDs de envíos ya cargados en el vehículo (status loaded) que
	// la UI puede listar junto con los nuevos.
	ExistingShipments []string `json:"existing_shipments,omitempty"`
}

// UnassignedShipment es un envío que el algoritmo no pudo rutear, con motivo.
type UnassignedShipment struct {
	TrackingID  string  `json:"tracking_id"`
	Destination string  `json:"destination"` // final_branch_id, o "(última milla)" si aplica
	Reason      string  `json:"reason"`      // código snake_case (sin_choferes_disponibles, etc.)
	WeightKg    float64 `json:"weight_kg"`
	Priority    string  `json:"priority"`
}

// BlockedDriver es un chofer al que no se le puede asignar más envíos por el momento.
// Hoy aplica solo a choferes que ya iniciaron su ruta del día.
type BlockedDriver struct {
	DriverID   string `json:"driver_id"`
	DriverName string `json:"driver_name,omitempty"`
	Reason     string `json:"reason"`
}

// DriverLoad reporta la carga pendiente actual de un chofer no bloqueado.
// Se exporta para que el cliente valide el cap correcto al reasignar manualmente
// a un chofer que el algoritmo no usó (no aparece en LastMile).
type DriverLoad struct {
	DriverID         string  `json:"driver_id"`
	DriverName       string  `json:"driver_name,omitempty"`
	ExistingCount    int     `json:"existing_count"`
	ExistingWeightKg float64 `json:"existing_weight_kg"`
	// Tracking IDs ya en ruta del día (espejo de ExistingCount). Le sirve
	// al cliente para mostrar los envíos previos cuando se promueve este
	// chofer a card de asignación al asignarle algo nuevo.
	ExistingShipments []string `json:"existing_shipments,omitempty"`
}

// VehicleLoad reporta la carga ya asignada a un vehículo del pool. Se exporta
// para que el cliente valide la capacidad disponible al reasignar manualmente
// a un vehículo que el algoritmo no usó.
type VehicleLoad struct {
	VehicleID        string  `json:"vehicle_id"`
	LicensePlate     string  `json:"license_plate"`
	CapacityKg       float64 `json:"capacity_kg"`
	ExistingWeightKg float64 `json:"existing_weight_kg"`
	// Tracking IDs ya cargados en el vehículo (status loaded). El cliente
	// los lista en la card si el operador asigna manualmente algo nuevo.
	ExistingShipments []string `json:"existing_shipments,omitempty"`
}

// RoutingPlan es el plan sugerido devuelto por GeneratePlan.
// Se transporta cliente-side y se manda completo a ApplyPlan.
type RoutingPlan struct {
	BranchID       string                  `json:"branch_id"`
	GeneratedAt    time.Time               `json:"generated_at"`
	LastMile       []LastMileAssignment    `json:"last_mile"`
	InterBranch    []InterBranchAssignment `json:"inter_branch"`
	Unassigned     []UnassignedShipment    `json:"unassigned"`
	BlockedDrivers []BlockedDriver         `json:"blocked_drivers"`
	DriverLoads    []DriverLoad            `json:"driver_loads"`
	VehicleLoads   []VehicleLoad           `json:"vehicle_loads"`
	ConfigSnapshot RoutingConfig           `json:"config_snapshot"`
}

// ApplyPlanRequest es el body del POST /routing/apply.
type ApplyPlanRequest struct {
	BranchID string      `json:"branch_id" binding:"required"`
	Plan     RoutingPlan `json:"plan"`
}

// ApplyResultItem describe el resultado por envío al aplicar el plan.
type ApplyResultItem struct {
	TrackingID string `json:"tracking_id"`
	Target     string `json:"target"` // "vehicle:<patente>" | "driver:<id>"
	Status     string `json:"status"` // "applied" | "skipped" | "failed"
	Error      string `json:"error,omitempty"`
}

// ApplyPlanResponse es el resumen del apply.
type ApplyPlanResponse struct {
	AppliedCount int               `json:"applied_count"`
	FailedCount  int               `json:"failed_count"`
	Items        []ApplyResultItem `json:"items"`
}
