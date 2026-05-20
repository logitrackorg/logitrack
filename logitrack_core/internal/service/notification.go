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
	repo repository.NotificationRepository
	hub  Pusher
}

// NewNotificationService creates a new NotificationService.
func NewNotificationService(repo repository.NotificationRepository) *NotificationService {
	return &NotificationService{repo: repo}
}

// SetHub wires in the SSE hub so that new notifications are pushed in real time.
func (s *NotificationService) SetHub(hub Pusher) {
	s.hub = hub
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
	// El ETA ISO se incrusta al final del body para que el frontend calcule el
	// countdown en tiempo real. Formato: "TID · origen → destino · eta:RFC3339"
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

// NotifyFatigueAlert sends an urgent notification to all supervisors of the given
// branch when a driver's composite fatigue score reaches the RED (high risk) level.
// Deduplication: only one alert per driver per hour to avoid flooding supervisors.
// Intended to be called as a goroutine (fire-and-forget).
func (s *NotificationService) NotifyFatigueAlert(branchID, driverUsername, driverFullName string, score int) {
	// Dedup: skip if an alert for the same driver was already sent within the last hour.
	since := clock.Now().Add(-1 * time.Hour)
	exists, err := s.repo.ExistsRecent(model.NotificationFatigueAlert, driverUsername, since)
	if err != nil {
		log.Printf("[NotificationService] NotifyFatigueAlert ExistsRecent error: %v", err)
	}
	if exists {
		return
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
			ResourceID: driverUsername, // usado para dedup y navegación en el frontend
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
