package repository

import (
	"time"

	"github.com/logitrack/core/internal/model"
)

// NotificationFilters holds optional filters for listing notifications.
type NotificationFilters struct {
	Search   string
	DateFrom *time.Time
	DateTo   *time.Time
	Limit    int
	Offset   int
}

// NotificationRepository defines persistence operations for notifications.
type NotificationRepository interface {
	// Create persists a new notification.
	Create(n model.Notification) error

	// ListByUser returns paginated notifications for a user plus the total count.
	ListByUser(userID string, filters NotificationFilters) ([]model.Notification, int, error)

	// UnreadCount returns the number of unread notifications for a user.
	UnreadCount(userID string) (int, error)

	// MarkRead marks a single notification as read, only if it belongs to userID.
	MarkRead(id, userID string) error

	// MarkAllRead marks all unread notifications of a user as read.
	MarkAllRead(userID string) error

	// ExistsRecent returns true if a notification of the given type and resourceID
	// was created after `since`.
	ExistsRecent(notifType model.NotificationType, resourceID string, since time.Time) (bool, error)

	// ExistsForUser returns true if a notification of the given type and resourceID
	// already exists for a specific user, created after `since`. Used for per-user dedup.
	ExistsForUser(notifType model.NotificationType, resourceID, userID string, since time.Time) (bool, error)

	// GetUsersByBranchAndRoles returns users belonging to branchID with any of
	// the given roles and status 'activo'.
	GetUsersByBranchAndRoles(branchID string, roles []model.Role) ([]model.User, error)

	// GetAdmins returns all active users with role 'admin' (fallback for CA-02).
	GetAdmins() ([]model.User, error)
}
