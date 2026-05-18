package service

import (
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// NotificationService handles creation and retrieval of in-app notifications.
type NotificationService struct {
	repo repository.NotificationRepository
}

// NewNotificationService creates a new NotificationService.
func NewNotificationService(repo repository.NotificationRepository) *NotificationService {
	return &NotificationService{repo: repo}
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
