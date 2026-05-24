package model

import "time"

type Status string

const (
	StatusDraft               Status = "draft"                // borrador — datos parciales, sin tracking ID
	StatusAtOriginHub         Status = "at_origin_hub"        // en sucursal de origen, confirmado
	StatusLoaded              Status = "loaded"               // cargado en vehículo, listo para partir
	StatusInTransit           Status = "in_transit"           // en tránsito entre sucursales
	StatusAtHub               Status = "at_hub"               // en sucursal intermedia o de destino
	StatusOutForDelivery      Status = "out_for_delivery"     // en reparto última milla
	StatusDelivered           Status = "delivered"            // entregado — terminal
	StatusDeliveryFailed      Status = "delivery_failed"      // intento de entrega fallido
	StatusRedeliveryScheduled Status = "redelivery_scheduled" // reentrega agendada
	StatusNoEntregado         Status = "no_entregado"         // no retirado del mostrador
	StatusRechazado           Status = "rechazado"            // destinatario rechazó el envío
	StatusReadyForPickup      Status = "ready_for_pickup"     // listo para retiro en sucursal
	StatusReadyForReturn      Status = "ready_for_return"     // listo para devolución al remitente
	StatusReturned            Status = "returned"             // devuelto al remitente — terminal
	StatusCancelled           Status = "cancelled"            // cancelado — terminal
	StatusLost                Status = "lost"                 // extraviado — terminal
	StatusDestroyed           Status = "destroyed"            // daño total — terminal
	StatusRecipientNotFound   Status = "recipient_not_found"
	StatusExpired             Status = "expired"
	StatusPendingPayment      Status = "pending_payment"
	
)

type PackageType string

const (
	PackageEnvelope PackageType = "envelope"
	PackageBox      PackageType = "box"
)

type Address struct {
	Street     string   `json:"street,omitempty"`
	City       string   `json:"city"`
	Province   string   `json:"province"`
	PostalCode string   `json:"postal_code,omitempty"`
	Latitude   *float64 `json:"latitude,omitempty"`
	Longitude  *float64 `json:"longitude,omitempty"`
}

type ShipmentType string

const (
	ShipmentTypeNormal  ShipmentType = "normal"
	ShipmentTypeExpress ShipmentType = "express"
)

type TimeWindow string

const (
	TimeWindowMorning   TimeWindow = "morning"
	TimeWindowAfternoon TimeWindow = "afternoon"
	TimeWindowFlexible  TimeWindow = "flexible"
)

type DeliveryMethod string

const (
	DeliveryMethodLastMile     DeliveryMethod = "ultima_milla"
	DeliveryMethodBranchPickup DeliveryMethod = "retiro_sucursal"
)

type Shipment struct {
	TrackingID string `json:"tracking_id"`

	Sender    Customer `json:"sender"`
	Recipient Customer `json:"recipient"`

	// Package
	WeightKg            float64     `json:"weight_kg"`
	PackageType         PackageType `json:"package_type"`
	IsFragile           bool        `json:"is_fragile,omitempty"`
	SpecialInstructions string      `json:"special_instructions,omitempty"`

	// Shipment attributes
	ShipmentType   ShipmentType   `json:"shipment_type,omitempty"`   // normal / express
	TimeWindow     TimeWindow     `json:"time_window,omitempty"`     // morning / afternoon / flexible
	DeliveryMethod DeliveryMethod `json:"delivery_method,omitempty"` // ultima_milla / retiro_sucursal — fijado al crear, no editable

	// Receiving branch
	ReceivingBranchID string `json:"receiving_branch_id,omitempty"`
	// OriginBranchID is the branch where the shipment was first registered. Unlike
	// ReceivingBranchID (which tracks the current hosting branch), this never changes
	// and is used to enforce ready_for_return semantics.
	OriginBranchID string `json:"origin_branch_id,omitempty"`
	// FinalBranchID is the branch geographically closest to the recipient's address.
	// Set once at creation/confirmation and never changes. Represents the last-mile hub.
	FinalBranchID string `json:"final_branch_id,omitempty"`

	// Priority (set by ML service on create/confirm)
	Priority           string                  `json:"priority,omitempty"`            // alta / media / baja
	PriorityScore      float64                 `json:"priority_score,omitempty"`      // 0.0-1.0 weighted score
	PriorityConfidence float64                 `json:"priority_confidence,omitempty"` // 0.0-1.0 forest vote share
	PriorityFactors    map[string]FactorDetail `json:"priority_factors,omitempty"`    // per-factor breakdown

	// Status & dates
	Status              Status     `json:"status"`
	CurrentLocation     string     `json:"current_location,omitempty"` // branch ID of current location
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	EstimatedDeliveryAt *time.Time `json:"estimated_delivery_at"`
	DeliveredAt         *time.Time `json:"delivered_at,omitempty"`

	// Counter-shipment & return tracking
	ParentShipmentID    *string `json:"parent_shipment_id,omitempty"`    // set when this is a counter-shipment
	DeliveryAttempts    int     `json:"delivery_attempts,omitempty"`     // incremented on every delivery_failed
	IsReturning         bool    `json:"is_returning,omitempty"`          // true for counter-shipments and return-mode shipments
	RejectedByRecipient bool    `json:"rejected_by_recipient,omitempty"` // delivery_failed because recipient explicitly refused

	// Corrections: typed non-destructive field overrides; original data is never modified.
	Corrections *ShipmentCorrections `json:"corrections,omitempty"`

	// HasIncident is set when at least one incident has been reported on the shipment.
	HasIncident  bool         `json:"has_incident,omitempty"`
	IncidentType IncidentType `json:"incident_type,omitempty"`

	// Pricing — calculated at creation/confirmation, never recalculated.
	Price          *float64        `json:"price,omitempty"`
	PriceBreakdown *PriceBreakdown `json:"price_breakdown,omitempty"`
	PriceCurrency  string          `json:"price_currency,omitempty"`
	ChatbotMetadata *ChatbotMetadata `json:"chatbot_metadata,omitempty"`
	// Multi-hop routing
	ReservedForTripID *string  `json:"reserved_for_trip_id,omitempty"`
	NextHopBranchID   string   `json:"next_hop_branch_id,omitempty"`   
	PlannedPath       []string `json:"planned_path,omitempty"`         
	HopIndex          int      `json:"hop_index,omitempty"`            
	PathRevision      int      `json:"path_revision,omitempty"`        

	// SLANotifiedAt registra cuándo se emitió la última notificación de SLA en riesgo.
	// Se resetea a nil cuando el envío sale del estado crítico, habilitando una nueva
	// notificación si vuelve a entrar (CA-04).
	SLANotifiedAt *time.Time `json:"sla_notified_at,omitempty"`

	// SLAExpiredNotifiedAt registra cuándo se emitió la notificación de SLA vencido.
	// Se resetea si el envío sale del estado expirado (p. ej. ETA extendida).
	SLAExpiredNotifiedAt *time.Time `json:"sla_expired_notified_at,omitempty"`

	// ConfirmationEmailSentAt registra cuándo se enviaron los emails de confirmación
	// al destinatario y al remitente. Nil = aún no enviados. Usado para dedup (CA-05).
	ConfirmationEmailSentAt *time.Time `json:"confirmation_email_sent_at,omitempty"`
}

// ShipmentCorrections holds non-destructive field overrides for a confirmed shipment.
// Only non-nil fields have been corrected; original values are always preserved in Shipment.
type ShipmentCorrections struct {
	SenderName            *string       `json:"sender_name,omitempty"`
	SenderPhone           *string       `json:"sender_phone,omitempty"`
	SenderEmail           *string       `json:"sender_email,omitempty"`
	SenderDNI             *string       `json:"sender_dni,omitempty"`
	OriginStreet          *string       `json:"origin_street,omitempty"`
	OriginCity            *string       `json:"origin_city,omitempty"`
	OriginProvince        *string       `json:"origin_province,omitempty"`
	OriginPostalCode      *string       `json:"origin_postal_code,omitempty"`
	RecipientName         *string       `json:"recipient_name,omitempty"`
	RecipientPhone        *string       `json:"recipient_phone,omitempty"`
	RecipientEmail        *string       `json:"recipient_email,omitempty"`
	RecipientDNI          *string       `json:"recipient_dni,omitempty"`
	DestinationStreet     *string       `json:"destination_street,omitempty"`
	DestinationCity       *string       `json:"destination_city,omitempty"`
	DestinationProvince   *string       `json:"destination_province,omitempty"`
	DestinationPostalCode *string       `json:"destination_postal_code,omitempty"`
	SpecialInstructions   *string       `json:"special_instructions,omitempty"`
	TimeWindow            *TimeWindow   `json:"time_window,omitempty"`
}

// CorrectedField pairs a human-readable label with its corrected value, used for auto-comments.
type CorrectedField struct {
	Label string
	Value string
}

// Fields returns only the non-nil corrections as labeled pairs, for comment generation.
func (c ShipmentCorrections) Fields() []CorrectedField {
	var fields []CorrectedField
	str := func(v *string, label string) {
		if v != nil {
			fields = append(fields, CorrectedField{Label: label, Value: *v})
		}
	}
	str(c.SenderName, "Nombre remitente")
	str(c.SenderPhone, "Teléfono remitente")
	str(c.SenderEmail, "Email remitente")
	str(c.SenderDNI, "DNI remitente")
	str(c.OriginStreet, "Dirección origen (calle)")
	str(c.OriginCity, "Ciudad origen")
	str(c.OriginProvince, "Provincia origen")
	str(c.OriginPostalCode, "Código postal origen")
	str(c.RecipientName, "Nombre destinatario")
	str(c.RecipientPhone, "Teléfono destinatario")
	str(c.RecipientEmail, "Email destinatario")
	str(c.RecipientDNI, "DNI destinatario")
	str(c.DestinationStreet, "Dirección destino (calle)")
	str(c.DestinationCity, "Ciudad destino")
	str(c.DestinationProvince, "Provincia destino")
	str(c.DestinationPostalCode, "Código postal destino")
	str(c.SpecialInstructions, "Instrucciones especiales")
	if c.TimeWindow != nil {
		fields = append(fields, CorrectedField{Label: "Ventana horaria", Value: string(*c.TimeWindow)})
	}
	return fields
}

// IsEmpty returns true when no field has been corrected.
func (c ShipmentCorrections) IsEmpty() bool {
	return len(c.Fields()) == 0
}

// Merge overwrites non-nil fields in base with those from incoming. Nil fields in incoming are left unchanged.
func (base *ShipmentCorrections) Merge(incoming ShipmentCorrections) {
	if incoming.SenderName != nil {
		base.SenderName = incoming.SenderName
	}
	if incoming.SenderPhone != nil {
		base.SenderPhone = incoming.SenderPhone
	}
	if incoming.SenderEmail != nil {
		base.SenderEmail = incoming.SenderEmail
	}
	if incoming.SenderDNI != nil {
		base.SenderDNI = incoming.SenderDNI
	}
	if incoming.OriginStreet != nil {
		base.OriginStreet = incoming.OriginStreet
	}
	if incoming.OriginCity != nil {
		base.OriginCity = incoming.OriginCity
	}
	if incoming.OriginProvince != nil {
		base.OriginProvince = incoming.OriginProvince
	}
	if incoming.OriginPostalCode != nil {
		base.OriginPostalCode = incoming.OriginPostalCode
	}
	if incoming.RecipientName != nil {
		base.RecipientName = incoming.RecipientName
	}
	if incoming.RecipientPhone != nil {
		base.RecipientPhone = incoming.RecipientPhone
	}
	if incoming.RecipientEmail != nil {
		base.RecipientEmail = incoming.RecipientEmail
	}
	if incoming.RecipientDNI != nil {
		base.RecipientDNI = incoming.RecipientDNI
	}
	if incoming.DestinationStreet != nil {
		base.DestinationStreet = incoming.DestinationStreet
	}
	if incoming.DestinationCity != nil {
		base.DestinationCity = incoming.DestinationCity
	}
	if incoming.DestinationProvince != nil {
		base.DestinationProvince = incoming.DestinationProvince
	}
	if incoming.DestinationPostalCode != nil {
		base.DestinationPostalCode = incoming.DestinationPostalCode
	}
	if incoming.TimeWindow != nil {
		base.TimeWindow = incoming.TimeWindow
	}
	if incoming.SpecialInstructions != nil {
		base.SpecialInstructions = incoming.SpecialInstructions
	}
}

// CanGenerateQR returns true if the shipment can generate a QR code.
// QR codes can only be generated for confirmed shipments (not drafts).
func (s *Shipment) CanGenerateQR() bool {
	return s.TrackingID != "" && s.Status != StatusDraft
}

// IsTerminalStatus returns true for statuses that accept no further transitions or incidents.
func IsTerminalStatus(s Status) bool {
	switch s {
	case StatusDelivered, StatusReturned, StatusCancelled, StatusLost, StatusDestroyed:
		return true
	}
	return false
}

type CreateShipmentRequest struct {
	Sender    Customer `json:"sender"    binding:"required"`
	Recipient Customer `json:"recipient" binding:"required"`

	WeightKg            float64        `json:"weight_kg"           binding:"required,gt=0"`
	PackageType         PackageType    `json:"package_type"        binding:"required"`
	IsFragile           bool           `json:"is_fragile"`
	SpecialInstructions string         `json:"special_instructions"`
	ShipmentType        ShipmentType   `json:"shipment_type"`
	TimeWindow          TimeWindow     `json:"time_window"`
	DeliveryMethod      DeliveryMethod `json:"delivery_method"`
	ReceivingBranchID   string         `json:"receiving_branch_id" binding:"required"`
	CreatedBy           string         `json:"created_by"`
}

// ShipmentFilter holds optional query filters for listing shipments.
type ShipmentFilter struct {
	DateFrom          *time.Time // inclusive lower bound on created_at
	DateTo            *time.Time // inclusive upper bound on created_at (end of day)
	ReceivingBranchID string     // if non-empty, only shipments with this branch
	IncludeExpired    bool 
}

// CorrectShipmentRequest carries typed field corrections.
// The original shipment data is never modified; corrections are stored separately.
type CorrectShipmentRequest struct {
	Corrections ShipmentCorrections `json:"corrections"`
}

// SaveDraftRequest allows partial data — no required fields.
type SaveDraftRequest struct {
	Sender    Customer `json:"sender"`
	Recipient Customer `json:"recipient"`

	WeightKg            float64        `json:"weight_kg"`
	PackageType         PackageType    `json:"package_type"`
	IsFragile           bool           `json:"is_fragile"`
	SpecialInstructions string         `json:"special_instructions"`
	ShipmentType        ShipmentType   `json:"shipment_type"`
	TimeWindow          TimeWindow     `json:"time_window"`
	DeliveryMethod      DeliveryMethod `json:"delivery_method"`
	ReceivingBranchID   string         `json:"receiving_branch_id"`
	CreatedBy           string         `json:"created_by"`
}

// ==========================================
// CHATBOT EXTENSIONS
// ==========================================

// ChatbotMetadata holds chatbot-related tracking data
type ChatbotMetadata struct {
	RescheduleCount        int        `json:"reschedule_count"`
	MaxReschedules         int        `json:"max_reschedules"`
	OriginalDeliveryDate   *time.Time `json:"original_delivery_date,omitempty"`
	ScheduledDeliveryDate  *time.Time `json:"scheduled_delivery_date,omitempty"`
	CancelledAt            *time.Time `json:"cancelled_at,omitempty"`
	CancelledBy            string     `json:"cancelled_by,omitempty"` // RECIPIENT, SENDER, SYSTEM
	CancellationReason     string     `json:"cancellation_reason,omitempty"`
	LastChatbotInteraction *time.Time `json:"last_chatbot_interaction,omitempty"`
}

// CanReschedule checks if shipment can be rescheduled via chatbot (US3)
func (s *Shipment) CanReschedule() (bool, string) {
	if s.ChatbotMetadata == nil {
		return true, ""
	}

	if s.ChatbotMetadata.RescheduleCount >= s.ChatbotMetadata.MaxReschedules {
		return false, "Has alcanzado el límite máximo de 2 reprogramaciones para este envío"
	}

	if s.Status == StatusOutForDelivery {
		return false, "Tu paquete ya está en camino y no puede ser reprogramado"
	}

	if IsTerminalStatus(s.Status) {
		return false, "Este envío ya no puede ser modificado"
	}

	return true, ""
}

// CanCancel checks if shipment can be cancelled via chatbot (US4)
func (s *Shipment) CanCancel() (bool, string) {
	if s.Status == StatusOutForDelivery {
		return false, "Tu paquete ya está en camino a tu domicilio y no podemos detener al repartidor. Si no lo deseas, por favor recházalo cuando llegue"
	}

	if IsTerminalStatus(s.Status) {
		return false, "Este envío ya no puede ser cancelado"
	}

	validStatuses := []Status{
		StatusAtHub,
		StatusReadyForPickup,
		StatusRedeliveryScheduled,
		StatusInTransit,
		StatusAtOriginHub,
		StatusLoaded,
	}

	for _, valid := range validStatuses {
		if s.Status == valid {
			return true, ""
		}
	}

	return false, "Este envío no puede ser cancelado en su estado actual"
}

// CanRequestPickup checks if shipment can be changed to pickup mode (US2)
func (s *Shipment) CanRequestPickup() (bool, string) {
	if s.DeliveryMethod != DeliveryMethodLastMile {
		return false, "Este envío ya está configurado para retiro en sucursal"
	}

	if s.Status == StatusOutForDelivery {
		return false, "Tu paquete ya está en camino y no puede ser redirigido"
	}

	if IsTerminalStatus(s.Status) {
		return false, "Este envío ya no puede ser modificado"
	}

	if s.FinalBranchID == "" {
		return false, "No se pudo determinar la sucursal de destino"
	}

	return true, ""
}

// GetAvailableRescheduleDates calculates available dates for rescheduling (US3 CA-01 & CA-03)
func (s *Shipment) GetAvailableRescheduleDates() []time.Time {
	if s.EstimatedDeliveryAt == nil {
		return []time.Time{}
	}

	baseDate := s.EstimatedDeliveryAt
	if s.ChatbotMetadata != nil && s.ChatbotMetadata.OriginalDeliveryDate != nil {
		baseDate = s.ChatbotMetadata.OriginalDeliveryDate
	}

	today := time.Now().Truncate(24 * time.Hour)
	maxDate := baseDate.AddDate(0, 0, 3)

	var dates []time.Time
	for i := 1; i <= 3; i++ {
		newDate := baseDate.AddDate(0, 0, i)
		if newDate.After(today) && !newDate.After(maxDate) {
			dates = append(dates, newDate)
		}
	}

	return dates
}

// InitializeChatbotMetadata sets up chatbot metadata if not present
func (s *Shipment) InitializeChatbotMetadata() {
	if s.ChatbotMetadata == nil {
		s.ChatbotMetadata = &ChatbotMetadata{
			RescheduleCount: 0,
			MaxReschedules:  2,
		}

		if s.EstimatedDeliveryAt != nil {
			originalDate := *s.EstimatedDeliveryAt
			s.ChatbotMetadata.OriginalDeliveryDate = &originalDate
		}
	}
}