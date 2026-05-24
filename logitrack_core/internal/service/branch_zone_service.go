package service

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
)

type BranchZoneService struct {
	zoneRepo     repository.BranchZoneRepository
	shipmentRepo repository.ShipmentRepository
	eventStore   repository.EventStore
	proj         projection.Projector
	shipmentSvc  *ShipmentService
}

func NewBranchZoneService(
	zoneRepo repository.BranchZoneRepository,
	shipmentRepo repository.ShipmentRepository,
	eventStore repository.EventStore,
	proj projection.Projector,
) *BranchZoneService {
	return &BranchZoneService{
		zoneRepo:     zoneRepo,
		shipmentRepo: shipmentRepo,
		eventStore:   eventStore,
		proj:         proj,
	}
}

func (s *BranchZoneService) SetShipmentService(svc *ShipmentService) {
	s.shipmentSvc = svc
}

func (s *BranchZoneService) EnsureZonesForBranch(branchID string) error {
	return s.zoneRepo.EnsureZonesForBranch(branchID)
}

func (s *BranchZoneService) ListByBranch(branchID string, includeInactive bool) ([]model.BranchZone, error) {
	return s.zoneRepo.ListByBranch(branchID, includeInactive)
}

func (s *BranchZoneService) SetActiveForBranch(branchID string, active bool) error {
	return s.zoneRepo.SetActiveForBranch(branchID, active)
}

// validTransitions defines allowed zone-to-zone moves.
// key = from_zone, value = set of allowed to_zones.
var validTransitions = map[model.BranchZoneType]map[model.BranchZoneType]bool{
	model.ZoneEntrada: {
		model.ZoneSalida:   true,
		model.ZoneRevision: true,
	},
	model.ZoneSalida: {
		model.ZoneRevision: true,
		model.ZoneEntrada:  true,
	},
	model.ZoneRevision: {
		model.ZoneSalida: true,
	},
}

// MoveShipment mueve un envío de una zona a otra dentro de la sucursal.
// Valida que la transición sea válida según el mapa de transiciones.
// role es el rol del usuario que ejecuta el movimiento.
func (s *BranchZoneService) MoveShipment(trackingID, username, branchID, notes string, toZone model.BranchZoneType, role model.Role) error {
	sh, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("envío no encontrado")
	}

	if sh.ReceivingBranchID != branchID {
		return fmt.Errorf("el envío no pertenece a esta sucursal")
	}

	// Determinar zona actual
	fromZone := model.ZoneEntrada
	if sh.CurrentZone != nil && *sh.CurrentZone != "" {
		fromZone = model.BranchZoneType(*sh.CurrentZone)
	}

	// Solo supervisor puede mover desde Revisión
	if fromZone == model.ZoneRevision && role != model.RoleSupervisor {
		return fmt.Errorf("Solo un supervisor puede mover envíos desde la zona Revisión")
	}

	// Validar transición
	if toZone == model.ZoneDevolucion {
		return fmt.Errorf("Debe pasar por Revisión antes de clasificar como devolución")
	}

	if toZone == model.ZoneEntrada && fromZone != model.ZoneSalida {
		return fmt.Errorf("solo se puede mover a Entrada desde Salida")
	}

	allowed, ok := validTransitions[fromZone]
	if !ok || !allowed[toZone] {
		return fmt.Errorf("no se puede mover de %s a %s", fromZone, toZone)
	}

	// Validar que la zona destino existe en la sucursal
	if _, err := s.zoneRepo.GetByBranchAndType(branchID, toZone); err != nil {
		return fmt.Errorf("zona destino no disponible en esta sucursal")
	}

	now := clock.Now().UTC()
	event := model.DomainEvent{
		ID:         uuid.New().String(),
		TrackingID: trackingID,
		EventType:  model.EventShipmentMoved,
		Payload: model.ShipmentMovedPayload{
			FromZone: fromZone,
			ToZone:   toZone,
			BranchID: branchID,
			Notes:    notes,
		},
		ChangedBy: username,
		Timestamp: now,
	}
	if err := s.eventStore.Append(event); err != nil {
		return err
	}
	s.proj.Apply(event)
	return nil
}

// ApproveFromRevision mueve un envío de Revisión a Salida (solo supervisor).
func (s *BranchZoneService) ApproveFromRevision(trackingID, username, branchID, notes string) error {
	return s.MoveShipment(trackingID, username, branchID, notes, model.ZoneSalida, model.RoleSupervisor)
}

// ClassifyShipment clasifica un envío en Revisión como lost o destroyed (solo supervisor).
// Actualiza el estado del envío a lost/destroyed y limpia la zona actual.
func (s *BranchZoneService) ClassifyShipment(trackingID, username, branchID, classification, notes string) error {
	if classification != "lost" && classification != "destroyed" {
		return fmt.Errorf("clasificación inválida: debe ser 'lost' o 'destroyed'")
	}

	sh, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("envío no encontrado")
	}

	if sh.ReceivingBranchID != branchID {
		return fmt.Errorf("el envío no pertenece a esta sucursal")
	}

	// Determinar zona actual
	fromZone := model.ZoneEntrada
	if sh.CurrentZone != nil && *sh.CurrentZone != "" {
		fromZone = model.BranchZoneType(*sh.CurrentZone)
	}

	// Solo supervisor puede clasificar
	if sh.ReceivingBranchID != branchID {
		return fmt.Errorf("el envío no pertenece a esta sucursal")
	}

	// Emitir evento de movimiento limpiando la zona
	now := clock.Now().UTC()
	event := model.DomainEvent{
		ID:         uuid.New().String(),
		TrackingID: trackingID,
		EventType:  model.EventShipmentMoved,
		Payload: model.ShipmentMovedPayload{
			FromZone: fromZone,
			ToZone:   "",
			BranchID: branchID,
			Notes:    fmt.Sprintf("Clasificación: %s. %s", classification, notes),
		},
		ChangedBy: username,
		Timestamp: now,
	}
	if err := s.eventStore.Append(event); err != nil {
		return err
	}
	s.proj.Apply(event)

	// Actualizar estado del envío a lost o destroyed
	targetStatus := model.StatusLost
	if classification == "destroyed" {
		targetStatus = model.StatusDestroyed
	}

	commentText := fmt.Sprintf("[Clasificación] %s: %s", strings.ToUpper(classification), notes)
	statusReq := model.UpdateStatusRequest{
		Status:           targetStatus,
		ChangedBy:        username,
		Notes:            commentText,
		SystemTransition: true,
	}
	if _, err := s.shipmentSvc.UpdateStatus(trackingID, statusReq); err != nil {
		return fmt.Errorf("error al actualizar estado a %s: %w", targetStatus, err)
	}

	return nil
}
