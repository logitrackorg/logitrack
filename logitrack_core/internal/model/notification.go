package model

import "time"

type NotificationType string

const (
	NotificationShipmentReceived       NotificationType = "shipment_received"        // llegó a sucursal intermedia
	NotificationDestinationArrival     NotificationType = "destination_arrival"      // llegó a sucursal destino final
	NotificationReturnArrival          NotificationType = "return_arrival"           // llegó a sucursal de origen (devolución)
	NotificationReturnStarted          NotificationType = "return_started"           // envío listo para devolución (LOGITRACK-408)
	NotificationReturnCompleted        NotificationType = "return_completed"         // envío devuelto al remitente — requiere coordinación (LOGITRACK-408)
	NotificationSLARisk                NotificationType = "sla_risk"                 // envío en riesgo de incumplir SLA
	NotificationSLAExpired             NotificationType = "sla_expired"              // envío venció su SLA
	NotificationFatigueAlert           NotificationType = "fatigue_alert"            // score de riesgo del chofer en nivel ROJO
	NotificationChatbotPickupRequested     NotificationType = "chatbot_pickup_requested"     // destinatario cambió método de entrega a retiro en sucursal vía chatbot
	NotificationChatbotRejectedByRecipient NotificationType = "chatbot_rejected_by_recipient" // destinatario rechazó el envío vía chatbot (LOGITRACK-457)
	NotificationChatbotCancelledBySender        NotificationType = "chatbot_cancelled_by_sender"        // remitente canceló el envío vía chatbot (LOGITRACK-457)
	NotificationChatbotDeliveryRescheduled      NotificationType = "chatbot_delivery_rescheduled"       // destinatario reprogramó la entrega vía chatbot
	NotificationMinFillReached             NotificationType = "min_fill_reached"               // volumen mínimo de despacho alcanzado (LOGITRACK-409)
	NotificationRouteAssigned          NotificationType = "route_assigned"            // ruta asignada al chofer (LOGITRACK-453)
	NotificationRouteReassigned        NotificationType = "route_reassigned"          // ruta reasignada a otro chofer (LOGITRACK-453)
	NotificationTripDriverAssigned     NotificationType = "trip_driver_assigned"      // chofer reclamó un viaje vía QR — avisa a operadores de sucursales involucradas
	NotificationDataAccessRequest      NotificationType = "data_access_request"       // chofer solicitó sus datos de monitoreo (Ley 25.326)
	NotificationAutoReportGenerated    NotificationType = "auto_report_generated"     // reporte automático generado y listo para descargar
	NotificationClaimCustomerResponded NotificationType = "claim_customer_responded"  // cliente respondió a reclamo pending_customer vía chatbot (US-4)
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
