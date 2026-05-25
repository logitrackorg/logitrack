package repository

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
)

// eventSourcedShipmentRepository implements ShipmentRepository using event sourcing.
// Writes append a DomainEvent to the EventStore and apply it to the projection.
// Reads are served directly from the materialized projection.
type eventSourcedShipmentRepository struct {
	store      EventStore
	projection projection.Projector
}

func NewEventSourcedShipmentRepository(store EventStore, proj projection.Projector) ShipmentRepository {
	return &eventSourcedShipmentRepository{store: store, projection: proj}
}

func (r *eventSourcedShipmentRepository) Create(cmd CreateShipmentCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventShipmentCreated,
		Payload:    model.ShipmentCreatedPayload{Shipment: cmd.Shipment, Notes: cmd.Notes},
		ChangedBy:  cmd.ChangedBy,
		Timestamp:  cmd.Shipment.CreatedAt,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) SaveDraft(cmd SaveDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventDraftSaved,
		Payload:    model.DraftSavedPayload{Shipment: cmd.Shipment},
		Timestamp:  cmd.Shipment.CreatedAt,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) UpdateDraft(cmd UpdateDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventDraftUpdated,
		Payload:    model.DraftUpdatedPayload{Shipment: cmd.Shipment},
		Timestamp:  cmd.Shipment.UpdatedAt,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) ConfirmDraft(cmd ConfirmDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.DraftID,
		EventType:  model.EventDraftConfirmed,
		Payload: model.DraftConfirmedPayload{
			OldTrackingID:       cmd.DraftID,
			NewTrackingID:       cmd.NewTrackingID,
			Prediction:          cmd.Prediction,
			EstimatedDeliveryAt: cmd.EstimatedDeliveryAt,
			Price:               cmd.Price,
			PriceBreakdown:      cmd.PriceBreakdown,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	// After confirming, the event's TrackingID in the store becomes the new ID.
	// The projection event needs the new tracking ID so Apply can find the correct entry.
	event.TrackingID = cmd.NewTrackingID
	r.projection.Apply(event)
	return r.projection.Get(cmd.NewTrackingID)
}

func (r *eventSourcedShipmentRepository) UpdateStatus(cmd StatusUpdateCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventStatusChanged,
		Payload: model.StatusChangedPayload{
			FromStatus:          cmd.FromStatus,
			ToStatus:            cmd.ToStatus,
			Location:            cmd.Location,
			Notes:               cmd.Notes,
			DriverID:            cmd.DriverID,
			RejectedByRecipient: cmd.RejectedByRecipient,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) ApplyCorrections(cmd CorrectCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventShipmentCorrected,
		Payload: model.ShipmentCorrectedPayload{
			Status:        cmd.Status,
			Corrections:   cmd.Corrections,
			Prediction:    cmd.Prediction,
			FinalBranchID: cmd.FinalBranchID,
		},
		ChangedBy: cmd.Username,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) ExtendETA(cmd ExtendETACmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventShipmentETAExtended,
		Payload: model.ShipmentETAExtendedPayload{
			OldETA:    cmd.OldETA,
			NewETA:    cmd.NewETA,
			AddedDays: cmd.AddedDays,
			Reason:    cmd.Reason,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) CancelShipment(cmd CancelCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventShipmentCancelled,
		Payload: model.ShipmentCancelledPayload{
			FromStatus: cmd.FromStatus,
			Reason:     cmd.Reason,
		},
		ChangedBy: cmd.Username,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) GetByTrackingID(trackingID string) (model.Shipment, error) {
	return r.projection.Get(trackingID)
}

func (r *eventSourcedShipmentRepository) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	return r.projection.List(filter)
}

func (r *eventSourcedShipmentRepository) Search(query string) ([]model.Shipment, error) {
	return r.projection.Search(query)
}

func (r *eventSourcedShipmentRepository) Stats(filter model.ShipmentFilter) (model.Stats, error) {
	return r.projection.Stats(filter)
}

func (r *eventSourcedShipmentRepository) StatsDetail(statusFilter string, dateFrom, dateTo *time.Time) (map[string]int, error) {
	return r.projection.StatsDetail(statusFilter, dateFrom, dateTo)
}

func (r *eventSourcedShipmentRepository) CancellationStats(dateFrom, dateTo *time.Time, branchID string) (model.CancellationStats, error) {
	return r.projection.CancellationStats(dateFrom, dateTo, branchID)
}

func (r *eventSourcedShipmentRepository) AvgTimePerStatus(dateFrom, dateTo *time.Time) (model.AvgTimePerStatus, error) {
	return r.projection.AvgTimePerStatus(dateFrom, dateTo)
}

func (r *eventSourcedShipmentRepository) RequestPayment(cmd RequestPaymentCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.Shipment.TrackingID,
		EventType:  model.EventPaymentRequested,
		Payload: model.PaymentRequestedPayload{
			PaymentID:      cmd.PaymentID,
			MPPreferenceID: cmd.MPPreferenceID,
			InitPoint:      cmd.InitPoint,
			Amount:         cmd.Amount,
			Currency:       cmd.Currency,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.Shipment.TrackingID)
}

func (r *eventSourcedShipmentRepository) ConfirmPayment(cmd ConfirmPaymentCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.OldTrackingID,
		EventType:  model.EventPaymentConfirmed,
		Payload: model.PaymentConfirmedPayload{
			PaymentID:           cmd.PaymentID,
			MPPaymentID:         cmd.MPPaymentID,
			OldTrackingID:       cmd.OldTrackingID,
			NewTrackingID:       cmd.NewTrackingID,
			Amount:              cmd.Amount,
			EstimatedDeliveryAt: cmd.EstimatedDeliveryAt,
			Prediction:          cmd.Prediction,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	// Mirror the ConfirmDraft pattern: set TrackingID to new ID before Apply
	// so the projection's Get call uses the right key.
	event.TrackingID = cmd.NewTrackingID
	r.projection.Apply(event)
	return r.projection.Get(cmd.NewTrackingID)
}

func (r *eventSourcedShipmentRepository) RevertToDraft(cmd RevertToDraftCmd) (model.Shipment, error) {
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventReturnedToDraft,
		Payload: model.ReturnedToDraftPayload{
			PaymentID: cmd.PaymentID,
			Reason:    cmd.Reason,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}
	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}
	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) RecordPathPlanned(_ PathPlannedCmd) error { return nil }
func (r *eventSourcedShipmentRepository) SetPalletID(_, _ string) error           { return nil }
func (r *eventSourcedShipmentRepository) ReserveForTrip(trackingID, tripID string) error {
	return r.projection.ReserveForTrip(trackingID, tripID)
}
func (r *eventSourcedShipmentRepository) ReleaseFromTrip(trackingID string) error {
	return r.projection.ReleaseFromTrip(trackingID)
}
func (r *eventSourcedShipmentRepository) SetSLANotified(trackingID string, notifiedAt *time.Time) error {
	return r.projection.SetSLANotified(trackingID, notifiedAt)
}
func (r *eventSourcedShipmentRepository) SetSLAExpiredNotified(trackingID string, notifiedAt *time.Time) error {
	return r.projection.SetSLAExpiredNotified(trackingID, notifiedAt)
}
func (r *eventSourcedShipmentRepository) SetConfirmationEmailSent(trackingID string) (bool, error) {
	return r.projection.SetConfirmationEmailSent(trackingID)
}

// GetEvents transforms DomainEvents from the store into ShipmentEvent (API format).
// draft_saved and draft_updated events are excluded — they are not part of the
// public event history.
func (r *eventSourcedShipmentRepository) GetEvents(trackingID string) ([]model.ShipmentEvent, error) {
	domainEvents, err := r.store.LoadStream(trackingID)
	if err != nil {
		// Stream vacío (envíos de seed o sin historial aún): devolver lista vacía en lugar de error.
		// LoadStream retorna error cuando no hay eventos para el tracking ID.
		return []model.ShipmentEvent{}, nil
	}

	result := make([]model.ShipmentEvent, 0)
	for _, de := range domainEvents {
		se, ok := toShipmentEvent(de)
		if !ok {
			continue // skip draft_saved, draft_updated
		}
		result = append(result, se)
	}
	return result, nil
}

// toShipmentEvent converts a DomainEvent to the external ShipmentEvent format.
// Returns false for event types that should not be exposed via the events API.
func toShipmentEvent(de model.DomainEvent) (model.ShipmentEvent, bool) {
	switch de.EventType {
	case model.EventShipmentCreated:
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			ToStatus:   model.StatusAtOriginHub,
			ChangedBy:  de.ChangedBy,
			Notes:      de.Payload.(model.ShipmentCreatedPayload).Notes,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventDraftConfirmed:
		from := model.StatusDraft
		payload := de.Payload.(model.DraftConfirmedPayload)
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusAtOriginHub,
			ChangedBy:  de.ChangedBy,
			Notes:      fmt.Sprintf("Confirmado desde borrador %s", payload.OldTrackingID),
			Timestamp:  de.Timestamp,
		}, true

	case model.EventStatusChanged:
		payload := de.Payload.(model.StatusChangedPayload)
		from := payload.FromStatus
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   payload.ToStatus,
			ChangedBy:  de.ChangedBy,
			Location:   payload.Location,
			Notes:      payload.Notes,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventShipmentCorrected:
		payload := de.Payload.(model.ShipmentCorrectedPayload)
		from := payload.Status
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			EventType:  "edited",
			FromStatus: &from,
			ToStatus:   payload.Status,
			ChangedBy:  de.ChangedBy,
			Notes:      fmt.Sprintf("Corrección de datos: %d campo(s) actualizado(s)", len(payload.Corrections.Fields())),
			Timestamp:  de.Timestamp,
		}, true

	case model.EventShipmentCancelled:
		payload := de.Payload.(model.ShipmentCancelledPayload)
		from := payload.FromStatus
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusCancelled,
			ChangedBy:  de.ChangedBy,
			Notes:      payload.Reason,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventIncidentReported:
		payload := de.Payload.(model.IncidentReportedPayload)
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			EventType:  model.EventIncidentReported,
			ChangedBy:  de.ChangedBy,
			Notes:      payload.Description,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventClaimCreated:
		payload := de.Payload.(model.ShipmentClaimCreatedPayload)
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			EventType:  model.EventClaimCreated,
			ChangedBy:  de.ChangedBy,
			Notes:      fmt.Sprintf("Reclamo %s registrado (%s)", payload.ClaimID, payload.ClaimType),
			Timestamp:  de.Timestamp,
		}, true

	case model.EventPaymentRequested:
		from := model.StatusDraft
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusPendingPayment,
			ChangedBy:  de.ChangedBy,
			Notes:      "Pago solicitado vía Mercado Pago",
			Timestamp:  de.Timestamp,
		}, true

	case model.EventPaymentConfirmed:
		payload := de.Payload.(model.PaymentConfirmedPayload)
		from := model.StatusPendingPayment
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusAtOriginHub,
			ChangedBy:  de.ChangedBy,
			Notes:      fmt.Sprintf("Pago aprobado — confirmado desde borrador %s", payload.OldTrackingID),
			Timestamp:  de.Timestamp,
		}, true

	case model.EventReturnedToDraft:
		from := model.StatusPendingPayment
		payload := de.Payload.(model.ReturnedToDraftPayload)
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusDraft,
			ChangedBy:  de.ChangedBy,
			Notes:      "Devuelto a borrador: " + payload.Reason,
			Timestamp:  de.Timestamp,
		}, true

	case model.EventPickupRequested:
		payload := de.Payload.(model.PickupRequestedPayload)
		from := model.Status("at_origin_hub") // puede variar, pero el payload no lo guarda
		_ = payload
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusReadyForPickup,
			ChangedBy:  de.ChangedBy,
			Notes:      "Destinatario solicitó retiro en sucursal vía chatbot",
			Timestamp:  de.Timestamp,
		}, true

	case model.EventDeliveryRescheduled:
	payload := de.Payload.(model.DeliveryRescheduledPayload)
	
	// ✅ NUEVO: Preparar fecha de reprogramación
	rescheduledDate := payload.NewDeliveryDate
	
	return model.ShipmentEvent{
		ID:         de.ID,
		TrackingID: de.TrackingID,
		EventType:  "rescheduled", // ✅ NUEVO: Especificar tipo
		ChangedBy:  de.ChangedBy,
		Notes:      fmt.Sprintf("Entrega reprogramada para el %s", payload.NewDeliveryDate.Format("02/01/2006")),
		Timestamp:  de.Timestamp,
		
		// ✅ NUEVOS CAMPOS
		CurrentLocation: payload.CurrentLocation,
		RescheduledDate: &rescheduledDate,
		Via:             payload.RequestedVia,
	}, true

	case model.EventCancelledByRecipient:
		payload := de.Payload.(model.CancelledByRecipientPayload)
		from := payload.FromStatus
		return model.ShipmentEvent{
			ID:         de.ID,
			TrackingID: de.TrackingID,
			FromStatus: &from,
			ToStatus:   model.StatusCancelled,
			ChangedBy:  de.ChangedBy,
			Notes:      payload.Reason,
			Timestamp:  de.Timestamp,
		}, true

	default:
		// draft_saved, draft_updated — not exposed
		return model.ShipmentEvent{}, false
	}
}

// ==========================================
// CHATBOT OPERATIONS
// ==========================================

func (r *eventSourcedShipmentRepository) AuthenticateRecipient(cmd AuthenticateRecipientCmd) (model.Shipment, error) {
	shipment, err := r.projection.Get(cmd.TrackingID)
	if err != nil {
		return model.Shipment{}, fmt.Errorf("envío no encontrado")
	}

	// Obtener DNI del destinatario (considerar correcciones)
	recipientDNI := shipment.Recipient.DNI
	if shipment.Corrections != nil && shipment.Corrections.RecipientDNI != nil {
		recipientDNI = *shipment.Corrections.RecipientDNI
	}

	// Validar DNI
	if recipientDNI != cmd.RecipientDNI {
		return model.Shipment{}, fmt.Errorf("los datos ingresados no coinciden con nuestros registros")
	}

	// Inicializar metadata del chatbot si no existe
	if shipment.ChatbotMetadata == nil {
		shipment.InitializeChatbotMetadata()
	}

	return shipment, nil
}

func (r *eventSourcedShipmentRepository) RequestPickup(cmd RequestPickupCmd) (model.Shipment, error) {
	// Autenticar primero
	shipment, err := r.AuthenticateRecipient(AuthenticateRecipientCmd{
		TrackingID:   cmd.TrackingID,
		RecipientDNI: cmd.RecipientDNI,
	})
	if err != nil {
		return model.Shipment{}, err
	}

	// Validar que se puede solicitar retiro
	canPickup, reason := shipment.CanRequestPickup()
	if !canPickup {
		return model.Shipment{}, errors.New(reason)
	}

	// Crear evento
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventPickupRequested,
		Payload: model.PickupRequestedPayload{
			RecipientDNI:   cmd.RecipientDNI,
			PreviousMethod: shipment.DeliveryMethod,
			FinalBranchID:  shipment.FinalBranchID,
			RequestedVia:   "chatbot",
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}

	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}

	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) RescheduleDelivery(cmd RescheduleDeliveryCmd) (model.Shipment, error) {
	// Autenticar primero
	shipment, err := r.AuthenticateRecipient(AuthenticateRecipientCmd{
		TrackingID:   cmd.TrackingID,
		RecipientDNI: cmd.RecipientDNI,
	})
	if err != nil {
		return model.Shipment{}, err
	}
	
	// Inicializar metadata si no existe
	if shipment.ChatbotMetadata == nil {
		shipment.InitializeChatbotMetadata()
	}

	// Validar que se puede reprogramar
	canReschedule, reason := shipment.CanReschedule()
	if !canReschedule {
		return model.Shipment{}, errors.New(reason)
	}

	// Validar que la fecha está dentro del rango permitido
	availableDates := shipment.GetAvailableRescheduleDates()
	validDate := false
	for _, date := range availableDates {
		if date.Truncate(24*time.Hour).Equal(cmd.NewDeliveryDate.Truncate(24*time.Hour)) {
			validDate = true
			break
		}
	}
	if !validDate {
		return model.Shipment{}, fmt.Errorf("la fecha seleccionada no está disponible")
	}

	// Calcular días desde la fecha original
	daysFromOriginal := 0
	if shipment.ChatbotMetadata.OriginalDeliveryDate != nil {
		daysFromOriginal = int(cmd.NewDeliveryDate.Sub(*shipment.ChatbotMetadata.OriginalDeliveryDate).Hours() / 24)
	}

	// ✅ NUEVO: Obtener ubicación actual del envío
	currentLocation := model.GetCurrentLocation(&shipment)

	// Crear evento CON UBICACIÓN
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventDeliveryRescheduled,
		Payload: model.DeliveryRescheduledPayload{
			RecipientDNI:     cmd.RecipientDNI,
			OldDeliveryDate:  shipment.EstimatedDeliveryAt,
			NewDeliveryDate:  cmd.NewDeliveryDate,
			OriginalDate:     shipment.ChatbotMetadata.OriginalDeliveryDate,
			RescheduleCount:  shipment.ChatbotMetadata.RescheduleCount + 1,
			DaysFromOriginal: daysFromOriginal,
			RequestedVia:     "chatbot",
			// ✅ NUEVO: Agregar ubicación actual
			CurrentLocation:  currentLocation,
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}

	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}

	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) AuthenticateSender(cmd AuthenticateSenderCmd) (model.Shipment, error) {
	shipment, err := r.projection.Get(cmd.TrackingID)
	if err != nil {
		return model.Shipment{}, fmt.Errorf("envío no encontrado")
	}

	// Obtener DNI del remitente (considerar correcciones)
	senderDNI := shipment.Sender.DNI
	if shipment.Corrections != nil && shipment.Corrections.SenderDNI != nil {
		senderDNI = *shipment.Corrections.SenderDNI
	}

	if senderDNI == "" {
		return model.Shipment{}, fmt.Errorf("este envío no tiene datos del remitente registrados")
	}
	if senderDNI != cmd.SenderDNI {
		return model.Shipment{}, fmt.Errorf("los datos ingresados no coinciden con nuestros registros")
	}

	return shipment, nil
}

func (r *eventSourcedShipmentRepository) CancelBySender(cmd CancelBySenderCmd) (model.Shipment, error) {
	shipment, err := r.AuthenticateSender(AuthenticateSenderCmd{
		TrackingID: cmd.TrackingID,
		SenderDNI:  cmd.SenderDNI,
	})
	if err != nil {
		return model.Shipment{}, err
	}

	canCancel, reason := shipment.CanCancel()
	if !canCancel {
		return model.Shipment{}, errors.New(reason)
	}

	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventCancelledBySender,
		Payload: model.CancelledBySenderPayload{
			SenderDNI:    cmd.SenderDNI,
			FromStatus:   shipment.Status,
			Reason:       cmd.Reason,
			RequestedVia: "chatbot",
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}

	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}

	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}

func (r *eventSourcedShipmentRepository) CancelByRecipient(cmd CancelByRecipientCmd) (model.Shipment, error) {
	// Autenticar primero
	shipment, err := r.AuthenticateRecipient(AuthenticateRecipientCmd{
		TrackingID:   cmd.TrackingID,
		RecipientDNI: cmd.RecipientDNI,
	})
	if err != nil {
		return model.Shipment{}, err
	}

	// Validar que se puede cancelar
	canCancel, reason := shipment.CanCancel()
	if !canCancel {
		return model.Shipment{}, errors.New(reason)
	}

	// Crear evento
	event := model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: cmd.TrackingID,
		EventType:  model.EventCancelledByRecipient,
		Payload: model.CancelledByRecipientPayload{
			RecipientDNI: cmd.RecipientDNI,
			FromStatus:   shipment.Status,
			Reason:       cmd.Reason,
			RequestedVia: "chatbot",
		},
		ChangedBy: cmd.ChangedBy,
		Timestamp: cmd.Timestamp,
	}

	if err := r.store.Append(event); err != nil {
		return model.Shipment{}, err
	}

	r.projection.Apply(event)
	return r.projection.Get(cmd.TrackingID)
}
