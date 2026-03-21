package model

import "time"

type ShipmentEvent struct {
	ID         string    `json:"id"`
	TrackingID string    `json:"tracking_id"`
	EventType  string    `json:"event_type,omitempty"` // "status_change" | "edited"
	FromStatus Status    `json:"from_status"`
	ToStatus   Status    `json:"to_status"`
	ChangedBy  string    `json:"changed_by"`
	Location   string    `json:"location,omitempty"`
	Notes      string    `json:"notes,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
}

type UpdateStatusRequest struct {
	Status       Status `json:"status"        binding:"required"`
	ChangedBy    string `json:"changed_by"`
	Location     string `json:"location"`
	Notes        string `json:"notes"`
	DriverID     string `json:"driver_id"`     // required when status = "delivering"
	RecipientDNI string `json:"recipient_dni"` // required when status = "delivered"
	SenderDNI    string `json:"sender_dni"`    // required when status = "returned"
}
