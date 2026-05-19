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
	label := statusLabel(toStatus)

	title := "Envío recibido en sucursal"
	body := shipment.TrackingID + " · " + originCity + " → " + destCity + " · " + label

	now := clock.Now().UTC()
	for _, u := range users {
		n := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationShipmentReceived,
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

	title := "Envío llegó a tu sucursal destino"
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
