package model

import "time"

// DispatchRule indica por qué se decidió despachar un grupo inter-sucursal.
type DispatchRule string

const (
	DispatchRuleSLA           DispatchRule = "sla_forced"
	DispatchRuleConsolidation DispatchRule = "consolidation"
	DispatchRuleManual        DispatchRule = "manual"
)

// LastMileAssignment agrupa los envíos que el algoritmo asignó a un vehículo
// de última milla. El chofer se auto-asigna escaneando el QR del vehículo.
//
// Shipments y TotalWeightKg corresponden únicamente a los envíos NUEVOS que
// este plan agrega al vehículo. ExistingWeightKg refleja la carga que el
// vehículo ya tenía asignada (status loaded). Los caps se chequean contra el
// total (existente + nuevos) para no exceder la capacidad acumulando entre
// múltiples Apply consecutivos.
type LastMileAssignment struct {
	VehicleID    string  `json:"vehicle_id"`
	LicensePlate string  `json:"license_plate"`
	CapacityKg   float64 `json:"capacity_kg"`
	// Chofer asignado al vehículo (opcional: puede pre-asignarse en el plan o
	// auto-asignarse cuando el chofer escanea el QR del vehículo).
	DriverID   *string `json:"driver_id,omitempty"`
	DriverName string  `json:"driver_name,omitempty"`

	Shipments         []string `json:"shipments"`
	TotalWeightKg     float64  `json:"total_weight_kg"`
	ExistingWeightKg  float64  `json:"existing_weight_kg"`
	ExistingShipments []string `json:"existing_shipments,omitempty"`
	// Estado de aplicación del ítem (se persiste en el plan global).
	AppliedShipments []string   `json:"applied_shipments,omitempty"`
	Applied          bool       `json:"applied"`
	AppliedAt        *time.Time `json:"applied_at,omitempty"`
	AppliedBy        string     `json:"applied_by,omitempty"`
	// InTransit es runtime-only: indica que el vehículo ya está en viaje.
	InTransit bool `json:"in_transit,omitempty"`
}

// RouteStop es una parada dentro de una ruta optimizada por VRP.
//
// Sequence es 1-based (la primera parada del día es 1). ArrivalMin es el
// delta en minutos desde DepartureMin (definido en LastMileAssignment) hasta
// la llegada al cliente. Si Unsequenced=true (envío sin coordenadas), ArrivalMin
// es -1 — el chofer atiende esa parada al final de la ruta sin tiempo estimado.
//
// WithinWindow indica si el arribo estimado cae dentro de la ventana horaria
// del envío. Cuando es false (solo posible con EnforceTimeWindows=false en la
// config), WindowDeviationMin indica cuántos minutos fuera de ventana llegará
// (positivo = tarde, negativo = temprano). El operador puede quitar el envío
// antes de aplicar el plan.
type RouteStop struct {
	TrackingID         string  `json:"tracking_id"`
	Sequence           int     `json:"sequence"`
	ArrivalMin         int     `json:"arrival_min"`
	Unsequenced        bool    `json:"unsequenced,omitempty"`
	TimeWindow         string  `json:"time_window,omitempty"`
	WeightKg           float64 `json:"weight_kg"`
	WithinWindow       bool    `json:"within_window"`
	WindowDeviationMin int     `json:"window_deviation_min,omitempty"`
}

// BackhaulPlan describes return-trip shipments piggybacked on an outbound vehicle (WIP).
type BackhaulPlan struct {
	Shipments     []string `json:"shipments"`
	TotalWeightKg float64  `json:"total_weight_kg"`
	FillRatePct   float64  `json:"fill_rate_pct"`
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
	// Estado de aplicación del ítem (se persiste en el plan global).
	// AppliedShipments lista los tracking IDs ya aplicados operacionalmente.
	// Applied = true cuando todos los Shipments actuales están en AppliedShipments.
	// Esto permite agregar nuevos envíos a un vehículo ya aplicado y aplicarlos.
	AppliedShipments []string   `json:"applied_shipments,omitempty"`
	Applied          bool       `json:"applied"`
	AppliedAt        *time.Time `json:"applied_at,omitempty"`
	AppliedBy        string     `json:"applied_by,omitempty"`
	// InTransit es runtime-only (no se persiste): indica que el vehículo ya está
	// en viaje. La card se muestra como informativa, sin drag-and-drop ni apply.
	InTransit bool `json:"in_transit,omitempty"`
	// Backhaul is a WIP feature: return-trip shipments on the same vehicle.
	Backhaul *BackhaulPlan `json:"backhaul,omitempty"`
	// Multi-hop: paradas adicionales después de la primera. Máximo 2 (total 3 stops).
	AdditionalStops []AssignmentStop `json:"additional_stops,omitempty"`
	// Cross-branch pickups en la PRIMARY stop (envíos at_hub en la sucursal
	// destino primario que se recogen al pasar y siguen viaje a alguna additional stop).
	PrimaryPickupShipments []string `json:"primary_pickup_shipments,omitempty"`
	PrimaryPickupWeightKg  float64  `json:"primary_pickup_weight_kg,omitempty"`
}

// AssignmentStop representa una parada adicional dentro de un dispatch multi-hop.
// Shipments son envíos a descargar (dropoff). PickupShipments son envíos en estado
// at_hub en BranchID que el vehículo recogerá al pasar (cross-branch pickup).
type AssignmentStop struct {
	BranchID        string   `json:"branch_id"`
	Shipments       []string `json:"shipments"`        // dropoffs
	TotalWeightKg   float64  `json:"total_weight_kg"`  // peso de los dropoffs
	PickupShipments []string `json:"pickup_shipments,omitempty"`
	PickupWeightKg  float64  `json:"pickup_weight_kg,omitempty"`
}

// MaxTripStops es el tope de paradas por viaje multi-hop (incluyendo la primaria).
const MaxTripStops = 3

// UnassignedShipment es un envío que el algoritmo no pudo rutear, con motivo.
type UnassignedShipment struct {
	TrackingID  string  `json:"tracking_id"`
	Destination string  `json:"destination"` // final_branch_id, o "(última milla)" si aplica
	Reason      string  `json:"reason"`      // código snake_case (sin_choferes_disponibles, etc.)
	WeightKg    float64 `json:"weight_kg"`
	Priority    string  `json:"priority"`
}

// VehicleLoad reporta la carga ya asignada a un vehículo del pool. Se exporta
// para que el cliente valide la capacidad disponible al reasignar manualmente
// a un vehículo que el algoritmo no usó.
type VehicleLoad struct {
	VehicleID        string          `json:"vehicle_id"`
	LicensePlate     string          `json:"license_plate"`
	Mode             VehicleModeEnum `json:"mode"` // ultima_milla | inter_sucursal
	CapacityKg       float64         `json:"capacity_kg"`
	ExistingWeightKg float64         `json:"existing_weight_kg"`
	// Tracking IDs ya cargados en el vehículo (status loaded). El cliente
	// los lista en la card si el operador asigna manualmente algo nuevo.
	ExistingShipments []string `json:"existing_shipments,omitempty"`
}

// VehicleModeEnum mirrors model.VehicleMode for use in routing structs.
type VehicleModeEnum = string

// IncomingVehicle es un vehículo de otra sucursal que está llegando con destino a esta.
// EstimatedArrivalAt is a WIP field for projected-dispatch logic.
// Runtime-only (no persiste en el plan): se computa en GetTodayPlan a partir del
// estado actual del vehiclehouse para dar visibilidad de qué carga viene en camino.
type IncomingVehicle struct {
	VehicleID          string     `json:"vehicle_id"`
	LicensePlate       string     `json:"license_plate"`
	OriginBranch       string     `json:"origin_branch"`
	Shipments          []string   `json:"shipments"`
	TotalWeightKg      float64    `json:"total_weight_kg"`
	CapacityKg         float64    `json:"capacity_kg"`
	EstimatedArrivalAt *time.Time `json:"estimated_arrival_at,omitempty"` // WIP: projected-dispatch
}

// RoutingPlan es el plan sugerido devuelto por GeneratePlan.
// Se transporta cliente-side y se manda completo a ApplyPlan.
type RoutingPlan struct {
	BranchID         string                  `json:"branch_id"`
	GeneratedAt      time.Time               `json:"generated_at"`
	LastMile         []LastMileAssignment    `json:"last_mile"`
	InterBranch      []InterBranchAssignment `json:"inter_branch"`
	IncomingVehicles []IncomingVehicle       `json:"incoming_vehicles,omitempty"` // runtime-only
	Unassigned       []UnassignedShipment    `json:"unassigned"`
	VehicleLoads     []VehicleLoad           `json:"vehicle_loads"`
	ConfigSnapshot   RoutingConfig           `json:"config_snapshot"`
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
