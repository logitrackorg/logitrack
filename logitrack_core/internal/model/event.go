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

	// Chatbot rescheduling fields
	CurrentLocation *EventLocation `json:"current_location,omitempty"`
	RescheduledDate *time.Time     `json:"rescheduled_date,omitempty"`
	Via             string         `json:"via,omitempty"`

	// Delivery photo evidence (populated for última milla delivered events)
	HasDeliveryPhoto  bool   `json:"has_delivery_photo,omitempty"`
	DeliveryPhotoName string `json:"delivery_photo_name,omitempty"`
	DeliveryPhotoPath string `json:"-"` // not exposed in API; used internally by GetDeliveryPhoto handler
}

// ✅ NUEVA ESTRUCTURA para ubicación detallada
type EventLocation struct {
	Type       string `json:"type"`        // "ORIGIN_BRANCH" | "DESTINATION_BRANCH" | "IN_TRANSIT"
	BranchCode string `json:"branch_code"` // Ej: "CORD-01"
	BranchName string `json:"branch_name"` // Ej: "Córdoba Centro"
	Status     string `json:"status"`      // Ej: "Disponible para retiro"
}

// MaxDeliverySpeedKmh is the speed threshold (km/h) above which a driver is
// considered to be moving and therefore must NOT be able to confirm a delivery
// or a failed-delivery attempt (BUG-43). The 5 km/h margin tolerates GPS jitter
// while the vehicle is effectively stopped.
const MaxDeliverySpeedKmh = 5.0

// GeofenceRadiusMeters is the maximum accepted distance (meters) between the
// driver's reported position and the recipient address when confirming a
// delivery or a failed attempt. Beyond this radius the driver is warned and,
// if they confirm anyway, an "ubicación fuera de rango" incident is auto-reported
// for supervisor review. Keep in sync with the frontend constant in utils/geo.ts.
const GeofenceRadiusMeters = 300.0

type UpdateStatusRequest struct {
	Status              Status `json:"status"                binding:"required"`
	ChangedBy           string `json:"changed_by"`
	Location            string `json:"location"`
	Notes               string `json:"notes"`
	DriverID            string `json:"driver_id"`             // required when status = "out_for_delivery"
	RecipientDNI        string `json:"recipient_dni"`         // required when status = "delivered"
	SenderDNI           string `json:"sender_dni"`            // required when status = "returned"
	RejectedByRecipient bool   `json:"rejected_by_recipient"` // delivery_failed: recipient explicitly refused
	// CurrentSpeed is the driver's speed in km/h at the moment of the action.
	// nil = not reported (operator/system flows); the speed guard only applies
	// when the value is present AND the transition is delivered / delivery_failed.
	CurrentSpeed *float64 `json:"current_speed,omitempty"`
	// SpeedSource records whether CurrentSpeed came from the Leaflet route
	// simulation ("simulation") or the device GPS ("real_gps"). Persisted to the
	// event notes for the delivery audit trail (BUG-43).
	SpeedSource      string `json:"speed_source,omitempty"`
	SystemTransition bool   `json:"-"` // skips driver_id requirement for system-initiated transitions
	// DeliveryPhotoBase64 is an optional base64-encoded JPEG image for última milla
	// deliveries (status = delivered). Saved to filesystem; path stored in event.
	DeliveryPhotoBase64 string `json:"delivery_photo_base64,omitempty"`
	// Latitude/Longitude: driver's GPS position at the moment of the delivered /
	// delivery_failed action. Recorded in the event notes and validated against
	// the recipient address geofence (see GeofenceRadiusMeters).
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
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
