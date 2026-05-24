package service

import (
	"fmt"
	"strings"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type InterBranchTripService struct {
	repo        repository.InterBranchTripRepository
	vehicleRepo repository.VehicleRepository
	branchRepo  repository.BranchRepository
	authRepo    repository.AuthRepository
	shipmentSvc *ShipmentService
	routeSvc    *RouteService
}

func NewInterBranchTripService(
	repo repository.InterBranchTripRepository,
	vehicleRepo repository.VehicleRepository,
	branchRepo repository.BranchRepository,
	authRepo repository.AuthRepository,
	shipmentSvc *ShipmentService,
) *InterBranchTripService {
	return &InterBranchTripService{
		repo: repo, vehicleRepo: vehicleRepo,
		branchRepo: branchRepo, authRepo: authRepo,
		shipmentSvc: shipmentSvc,
	}
}

func (s *InterBranchTripService) SetRouteService(svc *RouteService) {
	s.routeSvc = svc
}

type CreateInterBranchTripCmd struct {
	Kind                model.TripKind
	DriverID            *string
	VehicleID           string
	LicensePlate        string
	OriginBranchID      string
	DestinationBranchID *string         // nil for last_mile trips; para inter-sucursal = última parada
	ShipmentIDs         []string        // todos los envíos (todas las paradas)
	TotalWeightKg       float64
	CreatedBy           string
	Stops               []model.TripStop // 1..3 stops para inter-sucursal; vacío para last_mile
}

func (s *InterBranchTripService) Create(cmd CreateInterBranchTripCmd) (model.InterBranchTrip, error) {
	kind := cmd.Kind
	if kind == "" {
		kind = model.TripKindInterBranch
	}
	trip := model.InterBranchTrip{
		ID:                  model.GenerateTripID(),
		Kind:                kind,
		DriverID:            cmd.DriverID,
		VehicleID:           cmd.VehicleID,
		LicensePlate:        cmd.LicensePlate,
		OriginBranchID:      cmd.OriginBranchID,
		DestinationBranchID: cmd.DestinationBranchID,
		ShipmentIDs:         cmd.ShipmentIDs,
		Status:              model.TripStatusPending,
		TotalWeightKg:       cmd.TotalWeightKg,
		Stops:               cmd.Stops,
		CurrentStopIndex:    0,
		CreatedBy:           cmd.CreatedBy,
		CreatedAt:           clock.Now(),
	}
	if err := s.repo.Create(trip); err != nil {
		return model.InterBranchTrip{}, err
	}
	return trip, nil
}

func (s *InterBranchTripService) GetByID(id string) (model.InterBranchTrip, error) {
	t, ok := s.repo.GetByID(id)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	return t, nil
}

func (s *InterBranchTripService) GetActiveByVehicle(vehicleID string) (model.InterBranchTrip, bool) {
	return s.repo.GetActiveByVehicle(vehicleID)
}

func (s *InterBranchTripService) AddShipmentToTrip(tripID, shipmentID string) error {
	return s.repo.AddShipment(tripID, shipmentID)
}

func (s *InterBranchTripService) GetActiveByDriver(driverID string) (model.InterBranchTrip, error) {
	t, ok := s.repo.GetActiveByDriver(driverID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("no tenés un viaje asignado")
	}
	return t, nil
}

func (s *InterBranchTripService) AssignDriver(tripID, driverID, requestorBranchID string) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	if trip.Status != model.TripStatusPending {
		return model.InterBranchTrip{}, fmt.Errorf("solo se puede asignar chofer a viajes pendientes")
	}
	if trip.OriginBranchID != requestorBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("solo podés asignar choferes a viajes de tu sucursal")
	}
	driver, err := s.authRepo.GetUserByID(driverID)
	if err != nil || driver.Role != model.RoleDriver {
		return model.InterBranchTrip{}, fmt.Errorf("el usuario no es un chofer válido")
	}
	// Validate driver type matches trip kind
	if trip.Kind == model.TripKindLastMile && driver.DriverType != model.DriverTypeLastMile {
		return model.InterBranchTrip{}, fmt.Errorf("el chofer no está habilitado para viajes de última milla")
	}
	if trip.Kind == model.TripKindInterBranch && driver.DriverType != model.DriverTypeInterBranch {
		return model.InterBranchTrip{}, fmt.Errorf("el chofer no está habilitado para viajes intersucursales")
	}
	if err := s.repo.SetDriver(tripID, driverID); err != nil {
		return model.InterBranchTrip{}, err
	}
	trip.DriverID = &driverID
	return trip, nil
}

// ClaimByQR is called by a driver scanning the vehicle's QR code. Atomically assigns the driver.
// Also accepts a license plate as fallback for manual entry.
func (s *InterBranchTripService) ClaimByQR(qrToken, driverID, driverBranchID string, driverType model.DriverType) (model.InterBranchTrip, error) {
	vehicle, ok := s.vehicleRepo.GetByQRToken(qrToken)
	if !ok {
		vehicle, ok = s.vehicleRepo.GetByLicensePlate(strings.ToUpper(strings.TrimSpace(qrToken)))
		if !ok {
			return model.InterBranchTrip{}, fmt.Errorf("QR o patente inválidos — vehículo no encontrado")
		}
	}
	trip, ok := s.repo.GetActiveByVehicle(vehicle.ID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("no hay viaje activo para este vehículo")
	}
	// Idempotent: same driver claiming again
	if trip.DriverID != nil && *trip.DriverID == driverID {
		return trip, nil
	}
	// Strict driver type check
	if trip.Kind == model.TripKindLastMile && driverType != model.DriverTypeLastMile {
		return model.InterBranchTrip{}, fmt.Errorf("solo choferes de última milla pueden reclamar este viaje")
	}
	if trip.Kind == model.TripKindInterBranch && driverType != model.DriverTypeInterBranch {
		return model.InterBranchTrip{}, fmt.Errorf("solo choferes intersucursales pueden reclamar este viaje")
	}
	// Last-mile: driver must belong to origin branch
	if trip.Kind == model.TripKindLastMile && trip.OriginBranchID != driverBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje no corresponde a tu sucursal")
	}
	claimed, err := s.repo.ClaimByDriver(trip.ID, driverID)
	if err != nil {
		return model.InterBranchTrip{}, err
	}
	if !claimed {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje ya fue reclamado por otro chofer")
	}
	trip.DriverID = &driverID

	// For last-mile trips, assign route and auto-start the trip so shipments
	// transition loaded → out_for_delivery immediately when the driver claims the vehicle.
	if trip.Kind == model.TripKindLastMile && len(trip.ShipmentIDs) > 0 {
		if s.routeSvc != nil {
			today := model.NewDateOnly(clock.Now().In(clock.LocalTZ))
			for _, tid := range trip.ShipmentIDs {
				_ = s.routeSvc.AddShipmentToDriverRoute(driverID, tid, today)
			}
			if _, err := s.routeSvc.StartRoute(driverID); err != nil {
				// Route may be finalized from a previous run — reopen it for the new run.
				_ = s.routeSvc.ReopenRoute(driverID)
			}
		}
		if started, err := s.Start(trip.ID, driverID); err == nil {
			trip = started
		}
	}

	// For inter-branch trips: auto-start on initial claim (pendiente); on mid-trip
	// re-claims (en_transito, driver released at intermediate stop) resume the trip
	// so loaded pickups transition to in_transit and vehicle goes back to en_transito.
	if trip.Kind == model.TripKindInterBranch {
		if trip.Status == model.TripStatusPending {
			if started, err := s.Start(trip.ID, driverID); err == nil {
				trip = started
			}
		} else if trip.Status == model.TripStatusInProgress {
			if resumed, err := s.resumeTrip(trip, driverID); err == nil {
				trip = resumed
			}
		}
	}

	return trip, nil
}

// resumeTrip is called when a driver re-claims an inter-branch trip that is already
// en_transito (driver was released at an intermediate stop). It transitions the
// vehicle back to en_transito and moves any loaded shipments to in_transit.
func (s *InterBranchTripService) resumeTrip(trip model.InterBranchTrip, driverID string) (model.InterBranchTrip, error) {
	vehicle, ok := s.vehicleRepo.GetByID(trip.VehicleID)
	if !ok {
		return trip, nil
	}
	if err := s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusInTransit, driverID); err != nil {
		return trip, err
	}
	// Transition all loaded shipments on the vehicle to in_transit
	for _, tid := range vehicle.AssignedShipments {
		sh, err := s.shipmentSvc.GetByTrackingID(tid)
		if err != nil || sh.Status != model.StatusLoaded {
			continue
		}
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status:    model.StatusInTransit,
			ChangedBy: driverID,
			Notes:     "Viaje intersucursal retomado. Vehículo: " + vehicle.LicensePlate,
		})
	}
	updated, _ := s.repo.GetByID(trip.ID)
	return updated, nil
}

// CloseByVehicleQR is called by operator/supervisor scanning the vehicle QR on return.
// Multi-hop aware: si el viaje tiene varias paradas, cada scan cierra UNA parada
// (la que corresponde a la sucursal del operador). El vehículo continúa al
// siguiente hop hasta que se cierra la última parada.
func (s *InterBranchTripService) CloseByVehicleQR(qrToken, operatorUserID, operatorBranchID string) (model.InterBranchTrip, error) {
	vehicle, ok := s.vehicleRepo.GetByQRToken(qrToken)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("QR inválido o vehículo no encontrado")
	}
	trip, ok := s.repo.GetActiveByVehicle(vehicle.ID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("no hay viaje activo para este vehículo")
	}
	if trip.Status != model.TripStatusInProgress {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje no está en tránsito (estado: %s)", string(trip.Status))
	}

	// Last-mile: vuelta al depot (origen). Cerrar el viaje completo.
	if trip.Kind == model.TripKindLastMile {
		if trip.OriginBranchID != operatorBranchID {
			return model.InterBranchTrip{}, fmt.Errorf("no pertenecés a la sucursal de este viaje")
		}
		return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
	}

	// Inter-sucursal multi-hop: validar que el operador esté en la parada actual
	if len(trip.Stops) == 0 {
		// Trip legacy sin stops persistidos — fallback al comportamiento anterior
		if trip.DestinationBranchID == nil || *trip.DestinationBranchID != operatorBranchID {
			return model.InterBranchTrip{}, fmt.Errorf("este viaje no tiene destino en tu sucursal")
		}
		return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
	}

	if trip.CurrentStopIndex >= len(trip.Stops) {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje ya completó todas sus paradas")
	}
	currentStop := trip.Stops[trip.CurrentStopIndex]
	if currentStop.BranchID != operatorBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("la parada actual del viaje es %s, no tu sucursal", currentStop.BranchID)
	}

	// Descargar los envíos de la parada actual
	branch, _ := s.branchRepo.GetByID(operatorBranchID)
	locationName := operatorBranchID
	if branch.ID != "" {
		locationName = branch.Address.City
	}
	terminalStatuses := map[model.Status]bool{
		model.StatusDelivered: true, model.StatusReturned: true,
		model.StatusCancelled: true, model.StatusLost: true, model.StatusDestroyed: true,
	}
	for _, tid := range currentStop.ShipmentIDs {
		if sh, err := s.shipmentSvc.GetByTrackingID(tid); err == nil && terminalStatuses[sh.Status] {
			continue
		}
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status:    model.StatusAtHub,
			ChangedBy: operatorUserID,
			Location:  locationName,
			Notes:     "Parada " + fmt.Sprintf("%d/%d", trip.CurrentStopIndex+1, len(trip.Stops)) + " del viaje. Vehículo: " + vehicle.LicensePlate,
		})
		// Quitar del array de envíos del vehículo
		_ = s.vehicleRepo.RemoveShipment(vehicle.ID, tid)
	}

	// Pickups cross-branch: subirlos al vehículo en estado loaded. Pasarán a
	// in_transit cuando el próximo chofer reclame y retome el viaje.
	pickupNote := "Cargado en parada " + fmt.Sprintf("%d/%d", trip.CurrentStopIndex+1, len(trip.Stops)) + ". Vehículo: " + vehicle.LicensePlate
	for _, tid := range currentStop.PickupShipmentIDs {
		_ = s.shipmentSvc.ReleaseShipmentFromTrip(tid)
		_ = s.vehicleRepo.AddShipment(vehicle.ID, tid)
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status:    model.StatusLoaded,
			ChangedBy: operatorUserID,
			Location:  locationName,
			Notes:     pickupNote,
		})
	}

	// Avanzar el contador atómicamente
	if err := s.repo.AdvanceStop(trip.ID, trip.CurrentStopIndex, operatorUserID); err != nil {
		return model.InterBranchTrip{}, fmt.Errorf("error al avanzar la parada: %w", err)
	}

	isLastStop := trip.CurrentStopIndex == len(trip.Stops)-1
	if isLastStop {
		// Última parada: cerrar el viaje completo
		return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
	}

	// Parada intermedia: el vehículo queda en_carga en la sucursal recién
	// recibida (assigned_branch) y apunta a la próxima parada como destino
	// (destination_branch). El chofer se desvincula.
	assigned := operatorBranchID
	_ = s.vehicleRepo.AssignBranch(vehicle.ID, &assigned)
	// AdvanceStop ya incrementó CurrentStopIndex en DB; refrescamos el trip para
	// saber cuál es la próxima parada.
	refreshed, _ := s.repo.GetByID(trip.ID)
	if refreshed.CurrentStopIndex < len(refreshed.Stops) {
		nextBranchID := refreshed.Stops[refreshed.CurrentStopIndex].BranchID
		_ = s.vehicleRepo.SetDestinationBranch(vehicle.ID, &nextBranchID)
	}
	_ = s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusLoading, operatorUserID)
	_ = s.repo.ReleaseDriver(trip.ID)

	return refreshed, nil
}

// Start is called by the driver. Transitions vehicle to en_transito and shipments
// according to trip kind: last_mile → out_for_delivery, inter_branch → in_transit.
func (s *InterBranchTripService) Start(tripID, driverID string) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	if trip.DriverID == nil || *trip.DriverID != driverID {
		return model.InterBranchTrip{}, fmt.Errorf("no sos el chofer asignado a este viaje")
	}
	if trip.Status != model.TripStatusPending {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje ya fue iniciado o finalizado")
	}

	vehicle, ok := s.vehicleRepo.GetByID(trip.VehicleID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("vehículo no encontrado")
	}
	if vehicle.Status != model.VehicleStatusLoading {
		return model.InterBranchTrip{}, fmt.Errorf("el vehículo no está en estado 'en carga'")
	}

	// Transition vehicle to en_transito
	if err := s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusInTransit, driverID); err != nil {
		return model.InterBranchTrip{}, fmt.Errorf("error al actualizar estado del vehículo: %w", err)
	}

	if trip.Kind == model.TripKindLastMile {
		// Last-mile: shipments go to out_for_delivery
		originBranch, ok := s.branchRepo.GetByID(trip.OriginBranchID)
		locationName := trip.OriginBranchID
		if ok {
			locationName = originBranch.Address.City
		}
		for _, tid := range trip.ShipmentIDs {
			_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusOutForDelivery,
				ChangedBy: driverID,
				DriverID:  driverID,
				Location:  locationName,
				Notes:     "Viaje de última milla iniciado. Vehículo: " + vehicle.LicensePlate,
			})
		}
	} else {
		// Inter-branch: shipments go to in_transit. La location apuntada es la
		// PRÓXIMA parada (la primera del viaje multi-hop, o el destino final si
		// es single-hop). No usamos el destino final del trip para multi-hop
		// porque rompe el unload en paradas intermedias.
		var locationName string
		var nextBranchID string
		if len(trip.Stops) > 0 {
			nextBranchID = trip.Stops[0].BranchID
		} else if trip.DestinationBranchID != nil {
			nextBranchID = *trip.DestinationBranchID
		}
		if nextBranchID != "" {
			if nextBranch, ok := s.branchRepo.GetByID(nextBranchID); ok {
				locationName = nextBranch.Address.City
			} else {
				locationName = nextBranchID
			}
		}
		for _, tid := range trip.ShipmentIDs {
			_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusInTransit,
				ChangedBy: driverID,
				Location:  locationName,
				Notes:     "Viaje iniciado por chofer. Vehículo: " + vehicle.LicensePlate,
			})
		}
	}

	if err := s.repo.SetStartedAt(tripID); err != nil {
		return model.InterBranchTrip{}, err
	}

	trip.Status = model.TripStatusInProgress
	now := clock.Now()
	trip.StartedAt = &now
	return trip, nil
}

// FinishByScan is called when the operator at the destination branch scans the driver's QR (trip QR).
// For inter-branch trips only — last-mile trips use CloseByVehicleQR.
// FinishByScan is called when an operator scans the QR shown by the driver on
// their phone. For multi-hop trips it advances one stop at a time (same logic
// as CloseByVehicleQR); for single-hop legacy trips it closes the whole trip.
func (s *InterBranchTripService) FinishByScan(tripID, operatorUserID, operatorBranchID string) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	if trip.Status != model.TripStatusInProgress {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje no está en tránsito")
	}

	vehicle, ok := s.vehicleRepo.GetByID(trip.VehicleID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("vehículo no encontrado")
	}

	// Last-mile: retorno al depósito de origen. Cerrar el viaje completo.
	if trip.Kind == model.TripKindLastMile {
		if trip.OriginBranchID != operatorBranchID {
			return model.InterBranchTrip{}, fmt.Errorf("este viaje de última milla no corresponde a tu sucursal")
		}
		return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
	}

	// Multi-hop: validar que el operador esté en la parada actual y avanzar.
	if len(trip.Stops) > 0 {
		if trip.CurrentStopIndex >= len(trip.Stops) {
			return model.InterBranchTrip{}, fmt.Errorf("el viaje ya completó todas sus paradas")
		}
		currentStop := trip.Stops[trip.CurrentStopIndex]
		if currentStop.BranchID != operatorBranchID {
			return model.InterBranchTrip{}, fmt.Errorf("la parada actual del viaje es %s, no tu sucursal", currentStop.BranchID)
		}

		// Descargar los envíos de esta parada
		branch, _ := s.branchRepo.GetByID(operatorBranchID)
		locationName := operatorBranchID
		if branch.ID != "" {
			locationName = branch.Address.City
		}
		terminalStatuses := map[model.Status]bool{
			model.StatusDelivered: true, model.StatusReturned: true,
			model.StatusCancelled: true, model.StatusLost: true, model.StatusDestroyed: true,
		}
		for _, tid := range currentStop.ShipmentIDs {
			if sh, err := s.shipmentSvc.GetByTrackingID(tid); err == nil && terminalStatuses[sh.Status] {
				continue
			}
			_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusAtHub,
				ChangedBy: operatorUserID,
				Location:  locationName,
				Notes:     fmt.Sprintf("Parada %d/%d del viaje. Vehículo: %s", trip.CurrentStopIndex+1, len(trip.Stops), vehicle.LicensePlate),
			})
			_ = s.vehicleRepo.RemoveShipment(vehicle.ID, tid)
		}

		// Pickups en esta parada: quedan loaded en el vehículo. Pasarán a
		// in_transit cuando el próximo chofer reclame y retome el viaje.
		pickupNote := fmt.Sprintf("Cargado en parada %d/%d. Vehículo: %s", trip.CurrentStopIndex+1, len(trip.Stops), vehicle.LicensePlate)
		for _, tid := range currentStop.PickupShipmentIDs {
			_ = s.shipmentSvc.ReleaseShipmentFromTrip(tid)
			_ = s.vehicleRepo.AddShipment(vehicle.ID, tid)
			_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusLoaded,
				ChangedBy: operatorUserID,
				Location:  locationName,
				Notes:     pickupNote,
			})
		}

		// Avanzar el contador
		if err := s.repo.AdvanceStop(trip.ID, trip.CurrentStopIndex, operatorUserID); err != nil {
			return model.InterBranchTrip{}, fmt.Errorf("error al avanzar la parada: %w", err)
		}

		isLastStop := trip.CurrentStopIndex == len(trip.Stops)-1
		if isLastStop {
			return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
		}

		// Parada intermedia: el vehículo queda en_carga en la sucursal recién
		// recibida (assigned_branch) y apunta a la próxima parada como destino
		// (destination_branch). El chofer se desvincula para que cualquier
		// chofer intersucursal pueda re-reclamar escaneando el QR del vehículo.
		assigned := operatorBranchID
		_ = s.vehicleRepo.AssignBranch(vehicle.ID, &assigned)
		nextBranchID := trip.Stops[trip.CurrentStopIndex+1].BranchID
		_ = s.vehicleRepo.SetDestinationBranch(vehicle.ID, &nextBranchID)
		_ = s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusLoading, operatorUserID)
		_ = s.repo.ReleaseDriver(trip.ID)

		updated, _ := s.repo.GetByID(trip.ID)
		return updated, nil
	}

	// Single-hop legacy: el operador debe ser el destino final.
	if trip.DestinationBranchID == nil || *trip.DestinationBranchID != operatorBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("este viaje no tiene destino en tu sucursal")
	}
	return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
}

// finishTrip contains the shared finish logic for both FinishByScan and CloseByVehicleQR.
func (s *InterBranchTripService) finishTrip(trip model.InterBranchTrip, vehicle model.Vehicle, operatorUserID, operatorBranchID string) (model.InterBranchTrip, error) {
	terminalStatuses := map[model.Status]bool{
		model.StatusDelivered: true, model.StatusReturned: true,
		model.StatusCancelled: true, model.StatusLost: true, model.StatusDestroyed: true,
	}

	if trip.Kind == model.TripKindLastMile {
		// Auto-transition delivery_failed shipments: rechazado / ready_for_pickup / redelivery_scheduled
		for _, tid := range trip.ShipmentIDs {
			_ = s.shipmentSvc.FinalizeLastMileTripReturn(tid, operatorUserID)
		}
	} else {
		// Inter-branch: solo transicionar los envíos que están físicamente en el
		// vehículo en este momento. trip.ShipmentIDs incluye todos los envíos del
		// viaje (todas las paradas), pero los de paradas anteriores ya fueron
		// descargados y no deben moverse a la sucursal de destino final.
		branch, _ := s.branchRepo.GetByID(operatorBranchID)
		locationName := operatorBranchID
		if branch.ID != "" {
			locationName = branch.Address.City
		}
		for _, tid := range vehicle.AssignedShipments {
			if sh, err := s.shipmentSvc.GetByTrackingID(tid); err == nil && terminalStatuses[sh.Status] {
				continue
			}
			_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
				Status:    model.StatusAtHub,
				ChangedBy: operatorUserID,
				Location:  locationName,
				Notes:     "Viaje recibido en sucursal. Vehículo: " + vehicle.LicensePlate,
			})
		}
	}

	// Release vehicle: move to receiving branch, clear shipments, set disponible
	receivingBranchID := operatorBranchID
	_ = s.vehicleRepo.AssignBranch(vehicle.ID, &receivingBranchID)
	if branch, ok := s.branchRepo.GetByID(receivingBranchID); ok && branch.Latitude != nil {
		_ = s.vehicleRepo.UpdateLocation(vehicle.ID, *branch.Latitude, *branch.Longitude)
	}
	_ = s.vehicleRepo.ClearShipments(vehicle.ID)
	_ = s.vehicleRepo.SetDestinationBranch(vehicle.ID, nil)
	_ = s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusAvailable, operatorUserID)

	if err := s.repo.SetCompleted(trip.ID, operatorUserID); err != nil {
		return model.InterBranchTrip{}, err
	}

	trip.Status = model.TripStatusCompleted
	now := clock.Now()
	trip.CompletedAt = &now
	trip.FinishedByUserID = &operatorUserID
	return trip, nil
}

func (s *InterBranchTripService) Cancel(tripID, requestorBranchID, username string) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	if trip.Status == model.TripStatusCompleted || trip.Status == model.TripStatusCancelled {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje ya está finalizado o cancelado")
	}
	if trip.Status == model.TripStatusInProgress {
		return model.InterBranchTrip{}, fmt.Errorf("no se puede cancelar un viaje en tránsito")
	}
	if trip.OriginBranchID != requestorBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("solo podés cancelar viajes de tu sucursal")
	}

	vehicle, ok := s.vehicleRepo.GetByID(trip.VehicleID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("vehículo no encontrado")
	}

	originBranch, ok := s.branchRepo.GetByID(trip.OriginBranchID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("sucursal de origen no encontrada")
	}

	// Revert shipments to at_origin_hub / at_hub
	cancelNote := "Viaje cancelado"
	if trip.Kind == model.TripKindInterBranch {
		cancelNote = "Viaje intersucursal cancelado"
	}
	for _, tid := range trip.ShipmentIDs {
		sh, err := s.shipmentSvc.GetByTrackingID(tid)
		if err != nil {
			continue
		}
		targetStatus := model.StatusAtHub
		if sh.OriginBranchID == trip.OriginBranchID {
			targetStatus = model.StatusAtOriginHub
		}
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status:    targetStatus,
			ChangedBy: username,
			Location:  originBranch.Address.City,
			Notes:     cancelNote,
		})
		_ = s.vehicleRepo.RemoveShipment(vehicle.ID, tid)
	}

	if vehicle.Status == model.VehicleStatusLoading {
		_ = s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusAvailable, username)
	}
	_ = s.vehicleRepo.SetDestinationBranch(vehicle.ID, nil)

	if err := s.repo.UpdateStatus(tripID, model.TripStatusCancelled); err != nil {
		return model.InterBranchTrip{}, err
	}

	// Liberar pickups cross-branch reservados para este trip
	for _, stop := range trip.Stops {
		for _, tid := range stop.PickupShipmentIDs {
			_ = s.shipmentSvc.ReleaseShipmentFromTrip(tid)
		}
	}

	trip.Status = model.TripStatusCancelled
	return trip, nil
}

func (s *InterBranchTripService) ListByBranch(branchID string) []model.InterBranchTrip {
	origin := s.repo.ListByOriginBranch(branchID)
	dest := s.repo.ListByDestinationBranch(branchID)
	stops := s.repo.ListByStopBranch(branchID)
	seen := map[string]bool{}
	result := make([]model.InterBranchTrip, 0, len(origin)+len(dest)+len(stops))
	for _, t := range append(append(origin, dest...), stops...) {
		if !seen[t.ID] {
			seen[t.ID] = true
			result = append(result, t)
		}
	}
	return result
}

// ListAllActive devuelve todos los trips inter-sucursal activos (pendientes + en_transito).
// Usado por manager/admin para ver la red completa.
func (s *InterBranchTripService) ListAllActive() []model.InterBranchTrip {
	all := s.repo.ListAllActive()
	return all
}

// GetTripByID devuelve un viaje por ID para que el operador pueda ver los detalles
// antes de confirmar descarga/carga. Valida que la sucursal del operador participe.
func (s *InterBranchTripService) GetTripByID(tripID, operatorBranchID string) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	// Verificar que la sucursal del operador sea origen, destino o parada actual.
	if trip.OriginBranchID == operatorBranchID {
		return trip, nil
	}
	if trip.DestinationBranchID != nil && *trip.DestinationBranchID == operatorBranchID {
		return trip, nil
	}
	for _, st := range trip.Stops {
		if st.BranchID == operatorBranchID {
			return trip, nil
		}
	}
	return model.InterBranchTrip{}, fmt.Errorf("tu sucursal no participa en este viaje")
}

// ConfirmUnload es el paso 1 de la recepción en parada intermedia.
// El operador confirma qué envíos llegaron físicamente (delivered → at_hub)
// y cuáles tuvieron problema (missing → lost con nota).
func (s *InterBranchTripService) ConfirmUnload(
	tripID string, stopIdx int,
	operatorUserID, operatorBranchID string,
	delivered []string, missing []string,
) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	if trip.Status != model.TripStatusInProgress {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje no está en tránsito")
	}
	if stopIdx < 0 || stopIdx >= len(trip.Stops) {
		return model.InterBranchTrip{}, fmt.Errorf("parada inválida")
	}
	if stopIdx != trip.CurrentStopIndex {
		return model.InterBranchTrip{}, fmt.Errorf("esa no es la parada actual del viaje")
	}
	if trip.Stops[stopIdx].BranchID != operatorBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("la parada actual no corresponde a tu sucursal")
	}
	if trip.Stops[stopIdx].UnloadedAt != nil {
		return model.InterBranchTrip{}, fmt.Errorf("la descarga de esta parada ya fue confirmada")
	}

	branch, _ := s.branchRepo.GetByID(operatorBranchID)
	locationName := operatorBranchID
	if branch.ID != "" {
		locationName = branch.Address.City
	}

	vehicle, ok := s.vehicleRepo.GetByID(trip.VehicleID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("vehículo no encontrado")
	}

	terminalStatuses := map[model.Status]bool{
		model.StatusDelivered: true, model.StatusReturned: true,
		model.StatusCancelled: true, model.StatusLost: true, model.StatusDestroyed: true,
	}
	note := fmt.Sprintf("Descargado en parada %d/%d. Vehículo: %s", stopIdx+1, len(trip.Stops), vehicle.LicensePlate)

	for _, tid := range delivered {
		if sh, err := s.shipmentSvc.GetByTrackingID(tid); err == nil && terminalStatuses[sh.Status] {
			continue
		}
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status: model.StatusAtHub, ChangedBy: operatorUserID,
			Location: locationName, Notes: note,
		})
		_ = s.vehicleRepo.RemoveShipment(vehicle.ID, tid)
	}
	for _, tid := range missing {
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status: model.StatusLost, ChangedBy: operatorUserID,
			Location: locationName,
			Notes:    fmt.Sprintf("No llegó en parada %d/%d. Vehículo: %s", stopIdx+1, len(trip.Stops), vehicle.LicensePlate),
		})
		_ = s.vehicleRepo.RemoveShipment(vehicle.ID, tid)
	}

	now := clock.Now()
	_ = s.repo.MarkStopUnloaded(trip.ID, stopIdx, now, operatorUserID)

	updated, _ := s.repo.GetByID(trip.ID)
	return updated, nil
}

// ConfirmLoad es el paso 2 de la recepción en parada intermedia.
// El operador confirma qué pickups subieron físicamente al vehículo.
// Luego avanza la parada, vehículo → en_carga y chofer liberado.
// Si es la última parada, cierra el viaje completo.
func (s *InterBranchTripService) ConfirmLoad(
	tripID string, stopIdx int,
	operatorUserID, operatorBranchID string,
	loaded []string, skipped []string,
) (model.InterBranchTrip, error) {
	trip, ok := s.repo.GetByID(tripID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("viaje no encontrado")
	}
	if trip.Status != model.TripStatusInProgress {
		return model.InterBranchTrip{}, fmt.Errorf("el viaje no está en tránsito")
	}
	if stopIdx < 0 || stopIdx >= len(trip.Stops) {
		return model.InterBranchTrip{}, fmt.Errorf("parada inválida")
	}
	if stopIdx != trip.CurrentStopIndex {
		return model.InterBranchTrip{}, fmt.Errorf("esa no es la parada actual del viaje")
	}
	if trip.Stops[stopIdx].BranchID != operatorBranchID {
		return model.InterBranchTrip{}, fmt.Errorf("la parada actual no corresponde a tu sucursal")
	}
	if trip.Stops[stopIdx].UnloadedAt == nil && len(trip.Stops[stopIdx].ShipmentIDs) > 0 {
		return model.InterBranchTrip{}, fmt.Errorf("primero confirmá la descarga antes de confirmar la carga")
	}

	vehicle, ok := s.vehicleRepo.GetByID(trip.VehicleID)
	if !ok {
		return model.InterBranchTrip{}, fmt.Errorf("vehículo no encontrado")
	}

	branch, _ := s.branchRepo.GetByID(operatorBranchID)
	locationName := operatorBranchID
	if branch.ID != "" {
		locationName = branch.Address.City
	}

	pickupNote := fmt.Sprintf("Cargado en parada %d/%d. Vehículo: %s", stopIdx+1, len(trip.Stops), vehicle.LicensePlate)
	for _, tid := range loaded {
		_ = s.shipmentSvc.ReleaseShipmentFromTrip(tid)
		_ = s.vehicleRepo.AddShipment(vehicle.ID, tid)
		_, _ = s.shipmentSvc.UpdateStatus(tid, model.UpdateStatusRequest{
			Status: model.StatusLoaded, ChangedBy: operatorUserID,
			Location: locationName, Notes: pickupNote,
		})
	}
	for _, tid := range skipped {
		_ = s.shipmentSvc.ReleaseShipmentFromTrip(tid)
	}

	if err := s.repo.AdvanceStop(trip.ID, stopIdx, operatorUserID); err != nil {
		return model.InterBranchTrip{}, fmt.Errorf("error al avanzar la parada: %w", err)
	}

	isLastStop := stopIdx == len(trip.Stops)-1
	if isLastStop {
		return s.finishTrip(trip, vehicle, operatorUserID, operatorBranchID)
	}

	// Parada intermedia: el vehículo queda físicamente en la sucursal del operador
	// (assigned_branch) y apunta a la próxima parada como destino (destination_branch).
	assigned := operatorBranchID
	_ = s.vehicleRepo.AssignBranch(vehicle.ID, &assigned)
	nextBranchID := trip.Stops[stopIdx+1].BranchID
	_ = s.vehicleRepo.SetDestinationBranch(vehicle.ID, &nextBranchID)
	_ = s.vehicleRepo.UpdateStatusByUser(vehicle.ID, model.VehicleStatusLoading, operatorUserID)
	_ = s.repo.ReleaseDriver(trip.ID)

	updated, _ := s.repo.GetByID(trip.ID)
	return updated, nil
}
