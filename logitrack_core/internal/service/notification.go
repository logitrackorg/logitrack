package service

import (
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// Pusher is satisfied by the SSE hub; using an interface avoids an import cycle.
type Pusher interface {
	Push(userID string)
}

// NotificationService handles creation and retrieval of in-app notifications.
type NotificationService struct {
	repo               repository.NotificationRepository
	hub                Pusher
	fatigueBlockRepo   repository.FatigueBlockRepository
	interBranchTripSvc *InterBranchTripService
}

// NewNotificationService creates a new NotificationService.
func NewNotificationService(repo repository.NotificationRepository) *NotificationService {
	return &NotificationService{repo: repo}
}

// SetHub wires in the SSE hub so that new notifications are pushed in real time.
func (s *NotificationService) SetHub(hub Pusher) {
	s.hub = hub
}

// SetFatigueBlockRepo wires in the fatigue block repository (LOGITRACK-499).
func (s *NotificationService) SetFatigueBlockRepo(repo repository.FatigueBlockRepository) {
	s.fatigueBlockRepo = repo
}

// SetInterBranchTripService wires in the inter-branch trip service for fatigue block lookups (LOGITRACK-499).
func (s *NotificationService) SetInterBranchTripService(svc *InterBranchTripService) {
	s.interBranchTripSvc = svc
}

// statusLabel returns a human-readable label for the given shipment status.
func statusLabel(s model.Status) string {
	switch s {
	case model.StatusAtHub:
		return "En sucursal"
	case model.StatusAtOriginHub:
		return "En sucursal de origen"
	default:
		return string(s)
	}
}

// NotifyShipmentReceived creates in-app notifications for all operators and supervisors
// of the given branch when a shipment transitions to at_hub or at_origin_hub.
// Deduplication: if the same event fired within the last 5 minutes, it is skipped.
// This method is intended to be called as a goroutine (fire-and-forget).
func (s *NotificationService) NotifyShipmentReceived(shipment model.Shipment, branchID string, toStatus model.Status) {
	// Deduplication: skip if an identical notification was created in the last 5 minutes.
	since := clock.Now().Add(-5 * time.Minute)
	exists, err := s.repo.ExistsRecent(model.NotificationShipmentReceived, shipment.TrackingID, since)
	if err != nil {
		log.Printf("[NotificationService] ExistsRecent error: %v", err)
	}
	if exists {
		return
	}

	// Get operators and supervisors at the receiving branch.
	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] GetUsersByBranchAndRoles error: %v", err)
		return
	}

	originCity := shipment.Sender.Address.City
	destCity := shipment.Recipient.Address.City

	var title string
	var notifType model.NotificationType
	switch toStatus {
	case model.StatusAtOriginHub:
		title = "Envío en devolución — llegó a sucursal de origen"
		notifType = model.NotificationReturnArrival
	default:
		title = "Llegó a una sucursal intermedia"
		notifType = model.NotificationShipmentReceived
	}
	body := shipment.TrackingID + " · " + originCity + " → " + destCity

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       notifType,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] Create notification error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyDestinationArrival creates an individual destination_arrival notification
// immediately for each operator and supervisor of the branch.
// Called as a goroutine (fire-and-forget) from the shipment service.
// Grouping and expand/collapse is handled on the frontend.
func (s *NotificationService) NotifyDestinationArrival(shipment model.Shipment, branchID string) {
	// Deduplication: skip if an identical notification was created in the last 5 minutes.
	since := clock.Now().Add(-5 * time.Minute)
	exists, err := s.repo.ExistsRecent(model.NotificationDestinationArrival, shipment.TrackingID, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyDestinationArrival ExistsRecent error: %v", err)
	}
	if exists {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyDestinationArrival GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	title := "Llegó a su sucursal destino final"
	body := fmt.Sprintf("%s · Desde %s · %.1f kg",
		shipment.TrackingID, shipment.Sender.Address.City, shipment.WeightKg)
	if shipment.Priority == "alta" {
		body += " · ⚡ Prioridad alta"
	}

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationDestinationArrival,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyDestinationArrival Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyChatbotPickupRequested notifica a operadores y supervisores de la sucursal destino
// cuando el destinatario cambia el método de entrega a retiro en sucursal vía chatbot.
func (s *NotificationService) NotifyChatbotPickupRequested(shipment model.Shipment) {
	if shipment.FinalBranchID == "" {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(shipment.FinalBranchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyChatbotPickupRequested GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	title := "Cambio de método de entrega"
	body := fmt.Sprintf("%s · El destinatario cambió el método de entrega a retiro en sucursal vía chatbot", shipment.TrackingID)

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationChatbotPickupRequested,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyChatbotPickupRequested Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyChatbotRejectedByRecipient notifica a operadores y supervisores de la sucursal donde
// se encuentra el envío cuando el destinatario lo rechaza vía chatbot (LOGITRACK-457).
func (s *NotificationService) NotifyChatbotRejectedByRecipient(shipment model.Shipment) {
	branchID := shipment.CurrentLocation
	if branchID == "" {
		branchID = shipment.FinalBranchID
	}
	if branchID == "" {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyChatbotRejectedByRecipient GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	title := "Envío rechazado por el destinatario"
	body := fmt.Sprintf("%s · El destinatario ha rechazado el envío vía chatbot", shipment.TrackingID)

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationChatbotRejectedByRecipient,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyChatbotRejectedByRecipient Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyChatbotCancelledBySender notifica a operadores y supervisores de la sucursal donde
// se encuentra el envío cuando el remitente lo cancela vía chatbot (LOGITRACK-457).
func (s *NotificationService) NotifyChatbotCancelledBySender(shipment model.Shipment) {
	branchID := shipment.CurrentLocation
	if branchID == "" {
		branchID = shipment.FinalBranchID
	}
	if branchID == "" {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyChatbotCancelledBySender GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	title := "Envío cancelado por el remitente"
	body := fmt.Sprintf("%s · El remitente ha cancelado el envío vía chatbot", shipment.TrackingID)

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationChatbotCancelledBySender,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyChatbotCancelledBySender Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyChatbotDeliveryRescheduled notifica a operadores y supervisores de la sucursal de
// destino cuando el destinatario reprograma la fecha de entrega vía chatbot.
func (s *NotificationService) NotifyChatbotDeliveryRescheduled(shipment model.Shipment) {
	branchID := shipment.FinalBranchID
	if branchID == "" {
		branchID = shipment.CurrentLocation
	}
	if branchID == "" {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyChatbotDeliveryRescheduled GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	newDate := "—"
	if shipment.EstimatedDeliveryAt != nil {
		// Argentina es UTC-3 fijo (sin DST desde 1999)
		ar := time.FixedZone("ART", -3*60*60)
		newDate = shipment.EstimatedDeliveryAt.In(ar).Format("02/01/2006")
	}

	title := "Entrega reprogramada por el destinatario"
	body := fmt.Sprintf("%s · El destinatario reprogramó la entrega para el %s vía chatbot", shipment.TrackingID, newDate)

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationChatbotDeliveryRescheduled,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyChatbotDeliveryRescheduled Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifySLARisk crea una notificación de SLA en riesgo para los operadores y supervisores
// de la sucursal del envío. Si no hay ninguno, se notifica a los administradores (CA-02).
// La deduplicación por ciclo se controla externamente mediante shipment.SLANotifiedAt (CA-04).
// Debe llamarse como goroutine (fire-and-forget).
func (s *NotificationService) NotifySLARisk(shipment model.Shipment, branchID string) {
	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifySLARisk GetUsers error: %v", err)
		return
	}

	// Fallback CA-02: si no hay operadores/supervisores en la sucursal, notificar a admins.
	if len(users) == 0 {
		admins, err := s.repo.GetAdmins()
		if err != nil {
			log.Printf("[NotificationService] NotifySLARisk GetAdmins error: %v", err)
			return
		}
		users = admins
	}
	if len(users) == 0 {
		return
	}

	title := "⚠️ SLA en riesgo"
	body := fmt.Sprintf("%s · %s → %s",
		shipment.TrackingID,
		shipment.Sender.Address.City,
		shipment.Recipient.Address.City,
	)
	if shipment.EstimatedDeliveryAt != nil {
		body += " · eta:" + shipment.EstimatedDeliveryAt.UTC().Format(time.RFC3339)
	}

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationSLARisk,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifySLARisk Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifySLAExpired crea una notificación de SLA vencido para los operadores y supervisores
// de la sucursal del envío, con fallback a admins (CA-02).
// Debe llamarse como goroutine (fire-and-forget).
func (s *NotificationService) NotifySLAExpired(shipment model.Shipment, branchID string) {
	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifySLAExpired GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		admins, err := s.repo.GetAdmins()
		if err != nil {
			log.Printf("[NotificationService] NotifySLAExpired GetAdmins error: %v", err)
			return
		}
		users = admins
	}
	if len(users) == 0 {
		return
	}

	title := "🚨 SLA vencido"
	body := fmt.Sprintf("%s · %s → %s",
		shipment.TrackingID,
		shipment.Sender.Address.City,
		shipment.Recipient.Address.City,
	)

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationSLAExpired,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifySLAExpired Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyReturnStarted crea una notificación informativa para los operadores y supervisores
// de la sucursal de origen cuando un envío transiciona a "listo para devolución" (CA-01, CA-02, CA-03).
// Debe llamarse como goroutine (fire-and-forget).
func (s *NotificationService) NotifyReturnStarted(shipment model.Shipment, branchID, reason string) {
	since := clock.Now().Add(-5 * time.Minute)
	exists, err := s.repo.ExistsRecent(model.NotificationReturnStarted, shipment.TrackingID, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyReturnStarted ExistsRecent error: %v", err)
	}
	if exists {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyReturnStarted GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	title := fmt.Sprintf("El envío %s está en proceso de devolución y volverá a tu sucursal", shipment.TrackingID)
	body := shipment.TrackingID
	if reason != "" {
		body += " · " + reason
	}

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationReturnStarted,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyReturnStarted Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyReturnCompleted crea una notificación con mayor prominencia para los operadores y
// supervisores de la sucursal de origen cuando un envío es devuelto al remitente (CA-04, CA-05).
// Requiere acción: coordinar la entrega con el remitente.
// Debe llamarse como goroutine (fire-and-forget).
func (s *NotificationService) NotifyReturnCompleted(shipment model.Shipment, branchID string, titleOverride ...string) {
	since := clock.Now().Add(-5 * time.Minute)
	exists, err := s.repo.ExistsRecent(model.NotificationReturnCompleted, shipment.TrackingID, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyReturnCompleted ExistsRecent error: %v", err)
	}
	if exists {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] NotifyReturnCompleted GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	title := fmt.Sprintf("El envío %s fue devuelto y ya se encuentra en tu sucursal.", shipment.TrackingID)
	if len(titleOverride) > 0 && titleOverride[0] != "" {
		title = titleOverride[0]
	}
	body := shipment.TrackingID

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationReturnCompleted,
			Title:      title,
			Body:       body,
			ResourceID: shipment.TrackingID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyReturnCompleted Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// NotifyFatigueAlert sends an urgent notification to all supervisors of the given
// branch when a driver's composite fatigue score reaches the RED (high risk) level.
// Deduplication: only one alert per driver per hour to avoid flooding supervisors.
// driverID is the driver's user UUID; driverUsername is used for dedup and display.
// Intended to be called as a goroutine (fire-and-forget).
func (s *NotificationService) NotifyFatigueAlert(branchID, driverID, driverUsername, driverFullName string, score int) {
	since := clock.Now().Add(-1 * time.Hour)
	exists, err := s.repo.ExistsRecent(model.NotificationFatigueAlert, driverUsername, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyFatigueAlert ExistsRecent error: %v", err)
	}
	if exists {
		return
	}

	// Crear bloqueo de pantalla para el chofer ANTES del early return (LOGITRACK-499).
	// Aplica siempre, incluso si el chofer no tiene sucursal (ej: intersucursal).
	if s.fatigueBlockRepo != nil {
		var tripID *string
		if s.interBranchTripSvc != nil {
			if trip, err := s.interBranchTripSvc.GetActiveByDriver(driverID); err == nil {
				tripID = &trip.ID
			}
		}
		if err := s.fatigueBlockRepo.Create(driverID, tripID); err != nil {
			log.Printf("[NotificationService] NotifyFatigueAlert: error creando fatigue_block: %v", err)
		}
	}

	supervisors, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{model.RoleSupervisor})
	if err != nil {
		log.Printf("[NotificationService] NotifyFatigueAlert GetUsersByBranchAndRoles error: %v", err)
		return
	}
	if len(supervisors) == 0 {
		return
	}

	title := "⚠️ ALERTA: Fatiga Elevada"
	body := fmt.Sprintf("Chofer: %s · Score de riesgo: %d/100 (nivel ROJO)", driverFullName, score)

	now := clock.Now().UTC()
	for _, sup := range supervisors {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     sup.ID,
			Type:       model.NotificationFatigueAlert,
			Title:      title,
			Body:       body,
			ResourceID: driverUsername,
			CreatedAt:  now,
		}
		if err := s.repo.Create(n); err != nil {
			log.Printf("[NotificationService] NotifyFatigueAlert Create error for supervisor %s: %v", sup.ID, err)
		} else if s.hub != nil {
			s.hub.Push(n.UserID)
		}
	}
}

// GetForUser returns paginated notifications for a user.
func (s *NotificationService) GetForUser(userID string, filters repository.NotificationFilters) ([]model.Notification, int, error) {
	return s.repo.ListByUser(userID, filters)
}

// CreateForUser persiste una notificación arbitraria y la empuja por SSE si hay hub.
// Pensada para flujos donde el destinatario ya se conoce (p.ej. reportes automáticos).
func (s *NotificationService) CreateForUser(userID string, notifType model.NotificationType, title, body, resourceID string) error {
	n := model.Notification{
		ID:         uuid.NewString(),
		UserID:     userID,
		Type:       notifType,
		Title:      title,
		Body:       body,
		ResourceID: resourceID,
		CreatedAt:  clock.Now().UTC(),
	}
	if err := s.repo.Create(n); err != nil {
		return err
	}
	if s.hub != nil {
		s.hub.Push(userID)
	}
	return nil
}

// UnreadCount returns the count of unread notifications for a user.
func (s *NotificationService) UnreadCount(userID string) (int, error) {
	return s.repo.UnreadCount(userID)
}

// MarkRead marks a single notification as read (must belong to userID).
func (s *NotificationService) MarkRead(id, userID string) error {
	return s.repo.MarkRead(id, userID)
}

// MarkAllRead marks all notifications of a user as read.
func (s *NotificationService) MarkAllRead(userID string) error {
	return s.repo.MarkAllRead(userID)
}

// NotifyRouteAssigned crea una notificación in-app para el chofer cuando se le
// asigna una ruta. tripID se usa como resourceID y como clave de dedup (CA-07).
// stopCount es la cantidad de envíos/paradas. departureMin es minutos desde
// medianoche en hora local (0 = no disponible, se omite del body).
// Diseñado para llamarse como goroutine (fire-and-forget). LOGITRACK-453.
func (s *NotificationService) NotifyRouteAssigned(driverID, tripID string, stopCount, departureMin int) {
	// CA-07: idempotencia — no re-notificar al mismo chofer por el mismo viaje.
	since := clock.Now().Add(-23 * time.Hour)
	exists, err := s.repo.ExistsForUser(model.NotificationRouteAssigned, tripID, driverID, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyRouteAssigned ExistsForUser error: %v", err)
	}
	if exists {
		return
	}

	body := fmt.Sprintf("%d paradas", stopCount)
	if departureMin > 0 {
		h := departureMin / 60
		m := departureMin % 60
		body += fmt.Sprintf(" · Salida sugerida: %02d:%02d", h, m)
	}

	n := model.Notification{
		ID:         uuid.NewString(),
		UserID:     driverID,
		Type:       model.NotificationRouteAssigned,
		Title:      "Tenés una ruta para hoy",
		Body:       body,
		ResourceID: tripID,
		CreatedAt:  clock.Now().UTC(),
	}
	if err := s.repo.Create(n); err != nil {
		log.Printf("[NotificationService] NotifyRouteAssigned Create error for driver %s: %v", driverID, err)
		return
	}
	if s.hub != nil {
		s.hub.Push(driverID)
	}
}

// NotifyRouteReassigned crea una notificación in-app para el chofer anterior
// cuando su ruta es reasignada a otro chofer. LOGITRACK-453 CA-06.
func (s *NotificationService) NotifyRouteReassigned(oldDriverID, tripID, tripDate string) {
	n := model.Notification{
		ID:         uuid.NewString(),
		UserID:     oldDriverID,
		Type:       model.NotificationRouteReassigned,
		Title:      "Tu ruta fue reasignada",
		Body:       fmt.Sprintf("La ruta del %s fue asignada a otro chofer.", tripDate),
		ResourceID: tripID,
		CreatedAt:  clock.Now().UTC(),
	}
	if err := s.repo.Create(n); err != nil {
		log.Printf("[NotificationService] NotifyRouteReassigned Create error for driver %s: %v", oldDriverID, err)
		return
	}
	if s.hub != nil {
		s.hub.Push(oldDriverID)
	}
}

// NotifyTripClaimed notifica a los operadores/supervisores de las sucursales
// involucradas en el viaje cuando un chofer lo reclama vía QR.
// branchIDs es la lista de sucursales a notificar (origen + destino cuando aplica).
// Diseñado para llamarse como goroutine (fire-and-forget).
func (s *NotificationService) NotifyTripClaimed(tripID, driverUsername string, branchIDs []string) {
	// Dedup: si ya se notificó este viaje en los últimos 5 minutos, saltar.
	since := clock.Now().Add(-5 * time.Minute)
	exists, err := s.repo.ExistsRecent(model.NotificationTripDriverAssigned, tripID, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyTripClaimed ExistsRecent error: %v", err)
	}
	if exists {
		return
	}

	title := "Chofer asignado al viaje"
	body := fmt.Sprintf("@%s tomó el viaje %s", driverUsername, tripID)

	now := clock.Now().UTC()
	notified := map[string]bool{}
	for _, branchID := range branchIDs {
		users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
			model.RoleOperator,
			model.RoleSupervisor,
		})
		if err != nil {
			log.Printf("[NotificationService] NotifyTripClaimed GetUsersByBranchAndRoles error for branch %s: %v", branchID, err)
			continue
		}
		for _, u := range users {
			if notified[u.ID] {
				continue
			}
			notified[u.ID] = true
			n := model.Notification{
				ID:         uuid.NewString(),
				UserID:     u.ID,
				Type:       model.NotificationTripDriverAssigned,
				Title:      title,
				Body:       body,
				ResourceID: tripID,
				CreatedAt:  now,
			}
			if err := s.repo.Create(n); err != nil {
				log.Printf("[NotificationService] NotifyTripClaimed Create error for user %s: %v", u.ID, err)
			} else if s.hub != nil {
				s.hub.Push(u.ID)
			}
		}
	}
}
