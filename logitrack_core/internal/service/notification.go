package service

import (
	"fmt"
	"log"
	"sync"
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

// arrivalBatch accumulates shipments reaching a destination branch within a 5-minute window.
type arrivalBatch struct {
	shipments []model.Shipment
	timer     *time.Timer
}

// arrivalBuffer groups destination-branch arrivals per branch and flushes them
// as a single notification after a 5-minute tumbling window.
type arrivalBuffer struct {
	mu      sync.Mutex
	batches map[string]*arrivalBatch // branchID → batch
	flush   func([]model.Shipment, string)
}

func newArrivalBuffer(flush func([]model.Shipment, string)) *arrivalBuffer {
	return &arrivalBuffer{
		batches: make(map[string]*arrivalBatch),
		flush:   flush,
	}
}

func (b *arrivalBuffer) add(shipment model.Shipment, branchID string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	batch, exists := b.batches[branchID]
	if !exists {
		batch = &arrivalBatch{}
		b.batches[branchID] = batch
		batch.timer = time.AfterFunc(5*time.Minute, func() {
			b.mu.Lock()
			toFlush := batch.shipments
			delete(b.batches, branchID)
			b.mu.Unlock()
			b.flush(toFlush, branchID)
		})
	}
	batch.shipments = append(batch.shipments, shipment)
}

// NotificationService handles creation and retrieval of in-app notifications.
type NotificationService struct {
	repo   repository.NotificationRepository
	hub    Pusher
	buffer *arrivalBuffer
}

// NewNotificationService creates a new NotificationService.
func NewNotificationService(repo repository.NotificationRepository) *NotificationService {
	svc := &NotificationService{repo: repo}
	svc.buffer = newArrivalBuffer(svc.flushDestinationArrivals)
	return svc
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

// NotifyDestinationArrival enqueues a shipment into the 5-minute grouping buffer
// for its destination branch. Called (non-blocking) when a shipment reaches at_hub
// at its FinalBranchID. The buffer flushes once per branch per 5-minute window.
func (s *NotificationService) NotifyDestinationArrival(shipment model.Shipment, branchID string) {
	s.buffer.add(shipment, branchID)
}

// flushDestinationArrivals is called by the arrival buffer after each 5-minute window.
// It creates one notification per operator/supervisor of the branch:
//   - 1 shipment  → CA-04: individual detail (tracking ID, origin, weight, ML priority)
//   - N shipments → CA-05: grouped summary (count, total bultos, total weight)
func (s *NotificationService) flushDestinationArrivals(shipments []model.Shipment, branchID string) {
	if len(shipments) == 0 {
		return
	}

	users, err := s.repo.GetUsersByBranchAndRoles(branchID, []model.Role{
		model.RoleOperator,
		model.RoleSupervisor,
	})
	if err != nil {
		log.Printf("[NotificationService] flushDestinationArrivals GetUsers error: %v", err)
		return
	}
	if len(users) == 0 {
		return
	}

	var title, body, resourceID string

	if len(shipments) == 1 {
		sh := shipments[0]
		title = "Envío recibido en tu sucursal destino"
		body = fmt.Sprintf("%s · Desde %s · %.1f kg · 1 bulto",
			sh.TrackingID, sh.Sender.Address.City, sh.WeightKg)
		if sh.Priority == "alta" {
			body += " · ⚡ Prioridad alta"
		}
		resourceID = sh.TrackingID
	} else {
		totalWeight := 0.0
		for _, sh := range shipments {
			totalWeight += sh.WeightKg
		}
		n := len(shipments)
		title = fmt.Sprintf("Llegaron %d envíos a tu sucursal", n)
		body = fmt.Sprintf("%d bultos · %.1f kg en total", n, totalWeight)
		resourceID = "" // frontend navigates to shipments list
	}

	now := clock.Now().UTC()
	for _, u := range users {
		notif := model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       model.NotificationDestinationArrival,
			Title:      title,
			Body:       body,
			ResourceID: resourceID,
			CreatedAt:  now,
		}
		if err := s.repo.Create(notif); err != nil {
			log.Printf("[NotificationService] flushDestinationArrivals Create error for user %s: %v", u.ID, err)
		} else if s.hub != nil {
			s.hub.Push(notif.UserID)
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
