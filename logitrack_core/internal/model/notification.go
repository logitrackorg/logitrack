package model

import "time"

type NotificationType string

const (
	NotificationShipmentReceived   NotificationType = "shipment_received"
	NotificationDestinationArrival NotificationType = "destination_arrival"
)

type Notification struct {
	ID         string           `json:"id"`
	UserID     string           `json:"user_id"`
	Type       NotificationType `json:"type"`
	Title      string           `json:"title"`
	Body       string           `json:"body"`
	ResourceID string           `json:"resource_id,omitempty"`
	ReadAt     *time.Time       `json:"read_at,omitempty"`
	CreatedAt  time.Time        `json:"created_at"`
}
