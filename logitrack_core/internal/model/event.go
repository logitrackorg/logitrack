package model

import "time"

type ShipmentEvent struct {
	ID         string    `json:"id"`
	TrackingID string    `json:"tracking_id"`
	EventType  string    `json:"event_type,omitempty"`  // "status_change" | "edited" | "rescheduled"
	FromStatus *Status   `json:"from_status,omitempty"` // nil for initial creation events
	ToStatus   Status    `json:"to_status"`
	ChangedBy  string    `json:"changed_by"`
	Location   string    `json:"location,omitempty"`
	Notes      string    `json:"notes,omitempty"`
	Timestamp  time.Time `json:"timestamp"`

	// ✅ NUEVOS CAMPOS PARA REPROGRAMACIÓN
	CurrentLocation *EventLocation `json:"current_location,omitempty"` // Ubicación actual del envío
	RescheduledDate *time.Time     `json:"rescheduled_date,omitempty"` // Fecha de reentrega programada
	Via             string         `json:"via,omitempty"`              // "chatbot" | "manual" | "system"
}

// ✅ NUEVA ESTRUCTURA para ubicación detallada
type EventLocation struct {
	Type       string `json:"type"`        // "ORIGIN_BRANCH" | "DESTINATION_BRANCH" | "IN_TRANSIT"
	BranchCode string `json:"branch_code"` // Ej: "CORD-01"
	BranchName string `json:"branch_name"` // Ej: "Córdoba Centro"
	Status     string `json:"status"`      // Ej: "Disponible para retiro"
}

type UpdateStatusRequest struct {
	Status              Status `json:"status"                binding:"required"`
	ChangedBy           string `json:"changed_by"`
	Location            string `json:"location"`
	Notes               string `json:"notes"`
	DriverID            string `json:"driver_id"`            // required when status = "out_for_delivery"
	RecipientDNI        string `json:"recipient_dni"`        // required when status = "delivered"
	SenderDNI           string `json:"sender_dni"`           // required when status = "returned"
	RejectedByRecipient bool   `json:"rejected_by_recipient"` // delivery_failed: recipient explicitly refused
	SystemTransition    bool   `json:"-"`                    // skips driver_id requirement for system-initiated transitions
}

// ✅ NUEVO: Request para reprogramación
type RescheduleRequest struct {
	TrackingID      string    `json:"tracking_id" binding:"required"`
	NewDeliveryDate time.Time `json:"new_delivery_date" binding:"required"`
	Reason          string    `json:"reason"`
	Via             string    `json:"via"` // "chatbot" | "manual"
}

type BulkStatusRequest struct {
	TrackingIDs []string `json:"tracking_ids" binding:"required,min=1"`
	Status      Status   `json:"status"       binding:"required"`
	DriverID    string   `json:"driver_id"`
}

type BulkSkipped struct {
	TrackingID string `json:"tracking_id"`
	Reason     string `json:"reason"`
}

type BulkStatusResult struct {
	Updated int           `json:"updated"`
	Skipped []BulkSkipped `json:"skipped"`
}