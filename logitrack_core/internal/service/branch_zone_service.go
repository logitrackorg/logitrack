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
	commentSvc   *CommentService
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

func (s *BranchZoneService) SetCommentService(svc *CommentService) {
	s.commentSvc = svc
}

// logZoneComment registra un movimiento de zona como comentario del envío.
// Es best-effort: si falla (o no hay CommentService inyectado) no interrumpe el flujo.
func (s *BranchZoneService) logZoneComment(trackingID, author, body string) {
	if s.commentSvc == nil {
		return
	}
	_, _ = s.commentSvc.AddComment(trackingID, author, body)
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

// allowedZoneTransitions devuelve las zonas destino válidas desde fromZone.
//
// Reglas:
//   - Salida y Devolución son terminales: una vez ahí el envío no se mueve a otra zona.
//   - Para envíos en modo devolución (is_returning), desde Entrada solo se puede ir a
//     Devolución o Revisión (nunca a Salida); tras Revisión vuelven a Devolución.
//   - Para el resto, desde Entrada se va a Salida o Revisión; tras Revisión, a Salida.
func allowedZoneTransitions(fromZone model.BranchZoneType, isReturning bool) map[model.BranchZoneType]bool {
	switch fromZone {
	case model.ZoneEntrada:
		if isReturning {
			return map[model.BranchZoneType]bool{
				model.ZoneDevolucion: true,
				model.ZoneRevision:   true,
			}
		}
		return map[model.BranchZoneType]bool{
			model.ZoneSalida:   true,
			model.ZoneRevision: true,
		}
	case model.ZoneRevision:
		if isReturning {
			return map[model.BranchZoneType]bool{model.ZoneDevolucion: true}
		}
		return map[model.BranchZoneType]bool{model.ZoneSalida: true}
	default:
		// Salida y Devolución son terminales.
		return map[model.BranchZoneType]bool{}
	}
}

// AssignToEntrada registra automáticamente un envío en la zona Entrada al llegar a una
// sucursal (US-02 CA-01/CA-02). A diferencia de MoveShipment, no valida transiciones entre
// zonas: es una recepción automática del sistema que emite EventShipmentZoned y aplica sin
// importar la zona previa (típicamente nil en el flujo manual desde origen, o "salida" si el
// envío ya había sido despachado). Es idempotente: si ya está en Entrada, no hace nada.
func (s *BranchZoneService) AssignToEntrada(trackingID, branchID, username string) error {
	sh, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("envío no encontrado")
	}
	if sh.CurrentZone != nil && *sh.CurrentZone == string(model.ZoneEntrada) {
		return nil
	}

	event := model.DomainEvent{
		ID:         uuid.New().String(),
		TrackingID: trackingID,
		EventType:  model.EventShipmentZoned,
		Payload: model.ShipmentZonedPayload{
			BranchID: branchID,
			Zone:     model.ZoneEntrada,
		},
		ChangedBy: username,
		Timestamp: clock.Now().UTC(),
	}
	if err := s.eventStore.Append(event); err != nil {
		return err
	}
	s.proj.Apply(event)
	s.logZoneComment(trackingID, username, "[Zona] Recepción en almacén → Entrada")
	return nil
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

	// Salida es terminal: el envío ya está listo para despacho y no puede moverse a otra zona.
	if fromZone == model.ZoneSalida {
		return fmt.Errorf("Un envío en depósito para despachar está listo para despacho y no puede moverse a otra zona")
	}

	// Devolución solo está disponible para envíos en modo devolución.
	if toZone == model.ZoneDevolucion && !sh.IsReturning {
		return fmt.Errorf("Solo los envíos en devolución pueden moverse a la zona Devolución")
	}

	// Validar transición según la zona actual y si el envío está en modo devolución.
	if !allowedZoneTransitions(fromZone, sh.IsReturning)[toZone] {
		return fmt.Errorf("no se puede mover de %s a %s", model.BranchZoneNames[fromZone], model.BranchZoneNames[toZone])
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

	body := fmt.Sprintf("[Zona] %s → %s", model.BranchZoneNames[fromZone], model.BranchZoneNames[toZone])
	if strings.TrimSpace(notes) != "" {
		body += ": " + strings.TrimSpace(notes)
	}
	s.logZoneComment(trackingID, username, body)
	return nil
}

// ApproveFromRevision aprueba un envío que estaba en Revisión (solo supervisor).
// Los envíos en modo devolución pasan a Devolución; el resto, a Salida.
func (s *BranchZoneService) ApproveFromRevision(trackingID, username, branchID, notes string) error {
	if strings.TrimSpace(notes) == "" {
		return fmt.Errorf("Debe indicar un comentario sobre la resolución de la revisión")
	}
	sh, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("envío no encontrado")
	}
	target := model.ZoneSalida
	if sh.IsReturning {
		target = model.ZoneDevolucion
	}
	return s.MoveShipment(trackingID, username, branchID, notes, target, model.RoleSupervisor)
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
	s.logZoneComment(trackingID, username, fmt.Sprintf("[Zona] %s → clasificación %s. %s", model.BranchZoneNames[fromZone], strings.ToUpper(classification), notes))

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
