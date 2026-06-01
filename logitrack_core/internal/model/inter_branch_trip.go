package model

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type TripStatus string

const (
	TripStatusPending    TripStatus = "pendiente"
	TripStatusInProgress TripStatus = "en_transito"
	TripStatusCompleted  TripStatus = "completado"
	TripStatusCancelled  TripStatus = "cancelado"
)

// TripKind distinguishes last-mile trips (loop back to origin) from inter-branch transfers.
type TripKind string

const (
	TripKindInterBranch TripKind = "inter_branch"
	TripKindLastMile    TripKind = "last_mile"
)

type InterBranchTrip struct {
	ID                  string     `json:"id"`
	Kind                TripKind   `json:"kind"`
	DriverID            *string    `json:"driver_id,omitempty"`
	VehicleID           string     `json:"vehicle_id"`
	LicensePlate        string     `json:"license_plate"`
	OriginBranchID      string     `json:"origin_branch_id"`
	DestinationBranchID *string    `json:"destination_branch_id,omitempty"` // final stop (nil for last_mile)
	ShipmentIDs         []string   `json:"shipment_ids"`                    // todos los envíos del viaje (todas las paradas)
	Status              TripStatus `json:"status"`
	TotalWeightKg       float64    `json:"total_weight_kg"`
	// Multi-hop: paradas ordenadas (1..3 para inter-sucursal, vacío para last_mile).
	Stops            []TripStop `json:"stops,omitempty"`
	CurrentStopIndex int        `json:"current_stop_index"` // 0..len(Stops)-1; ==len(Stops) cuando todas las paradas completadas
	CreatedBy        string     `json:"created_by"`
	CreatedAt        time.Time  `json:"created_at"`
	StartedAt        *time.Time `json:"started_at,omitempty"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	FinishedByUserID *string    `json:"finished_by_user_id,omitempty"`

	// Tiempos planificados (calculados al momento de Apply).
	// Para última milla: salida = SuggestedStartTime del Route; llegada = última parada + service time.
	// Para inter-sucursal: salida = InterBranchDispatchHour; llegada = distancia/velocidad acumulada.
	ScheduledDepartureAt *time.Time `json:"scheduled_departure_at,omitempty"`
	EstimatedArrivalAt   *time.Time `json:"estimated_arrival_at,omitempty"`
}

// TripStop representa una parada del viaje. Los envíos en ShipmentIDs se
// descargan en BranchID (dropoff). Los envíos en PickupShipmentIDs se levantan
// del at_hub de BranchID al pasar y siguen viaje al próximo destino.
// CompletedAt + CompletedByUserID se setean cuando el operador de esa sucursal
// escanea el QR del vehículo.
type TripStop struct {
	BranchID          string     `json:"branch_id"`
	ShipmentIDs       []string   `json:"shipment_ids"`                  // dropoffs en este branch
	TotalWeightKg     float64    `json:"total_weight_kg"`               // peso de los dropoffs
	PickupShipmentIDs []string   `json:"pickup_shipment_ids,omitempty"` // recogidas en este branch
	PickupWeightKg    float64    `json:"pickup_weight_kg,omitempty"`
	// Descarga confirmada por el operador (paso 1 de la recepción).
	UnloadedAt       *time.Time `json:"unloaded_at,omitempty"`
	UnloadedBy       string     `json:"unloaded_by,omitempty"`
	// Carga confirmada y parada cerrada (paso 2, o automático si no hay pickups).
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	CompletedByUserID *string    `json:"completed_by_user_id,omitempty"`
	// EstimatedArrivalAt es la hora estimada de llegada a esta parada (en el JSONB stops).
	EstimatedArrivalAt *time.Time `json:"estimated_arrival_at,omitempty"`
}

func GenerateTripID() string {
	id := uuid.New().String()
	return fmt.Sprintf("TRIP-%s", strings.ToUpper(id[:8]))
}

type AssignDriverRequest struct {
	DriverID string `json:"driver_id" binding:"required"`
}

type CancelTripRequest struct {
	Reason string `json:"reason" binding:"required"`
}
