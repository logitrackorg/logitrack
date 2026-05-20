package model

import "time"

type NotificationType string

const (
	NotificationShipmentReceived   NotificationType = "shipment_received"   // llegó a sucursal intermedia
	NotificationDestinationArrival NotificationType = "destination_arrival"  // llegó a sucursal destino final
	NotificationReturnArrival      NotificationType = "return_arrival"       // llegó a sucursal de origen (devolución)
	NotificationSLARisk            NotificationType = "sla_risk"             // envío en riesgo de incumplir SLA
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
