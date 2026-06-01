package repository

import (
	"time"

	"github.com/logitrack/core/internal/model"
)

type InterBranchTripRepository interface {
	Create(trip model.InterBranchTrip) error
	GetByID(id string) (model.InterBranchTrip, bool)
	// GetActiveByDriver returns the first pending or in_progress trip for the driver.
	GetActiveByDriver(driverID string) (model.InterBranchTrip, bool)
	// GetActiveByVehicle returns the pending or in_progress trip for the vehicle.
	GetActiveByVehicle(vehicleID string) (model.InterBranchTrip, bool)
	// ClaimByDriver atomically sets driver_id if it is currently NULL. Returns true if claimed.
	ClaimByDriver(tripID, driverID string) (bool, error)
	// ReleaseDriver sets driver_id = NULL so any qualified driver can re-claim the trip.
	ReleaseDriver(tripID string) error
	// MarkStopUnloaded persiste que la descarga del stop fue confirmada por el operador.
	MarkStopUnloaded(tripID string, stopIdx int, ts time.Time, byUserID string) error
	UpdateStatus(id string, status model.TripStatus) error
	SetDriver(id string, driverID string) error
	SetStartedAt(id string) error
	SetCompleted(id string, finishedByUserID string) error
	// AdvanceStop persiste el cierre de una parada: marca completed_at/by en stops[stopIndex]
	// e incrementa current_stop_index. Atómico.
	AdvanceStop(tripID string, stopIndex int, completedByUserID string) error
	ListByDestinationBranch(branchID string) []model.InterBranchTrip
	ListByOriginBranch(branchID string) []model.InterBranchTrip
	// ListByStopBranch devuelve trips activos donde la sucursal aparece como
	// parada intermedia (en stops JSONB). Excluye cancelados.
	ListByStopBranch(branchID string) []model.InterBranchTrip
	// ListAllActive devuelve todos los trips pendientes o en tránsito (manager/admin).
	ListAllActive() []model.InterBranchTrip
	// AddShipment appends a shipment ID to an existing trip's shipment_ids.
	AddShipment(tripID, shipmentID string) error
	// ListByDateRange devuelve trips cuya scheduled_departure_at (o created_at como fallback)
	// cae dentro del rango [from, to). Excluye cancelados. Usado por el calendario.
	ListByDateRange(from, to time.Time) []model.InterBranchTrip
}
