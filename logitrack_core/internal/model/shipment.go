package model

import "time"

type Status string

const (
	StatusPending        Status = "pending"     // draft — partial data, no tracking ID yet
	StatusInProgress     Status = "in_progress" // confirmed — tracking ID assigned, awaiting transit
	StatusPreTransit     Status = "pre_transit" // pre-transit — vehicle assigned, ready to depart
	StatusInTransit      Status = "in_transit"
	StatusAtBranch       Status = "at_branch"
	StatusDelivering     Status = "delivering"
	StatusDelivered      Status = "delivered"
	StatusDeliveryFailed Status = "delivery_failed"
	StatusReadyForPickup Status = "ready_for_pickup" // recipient picks up at current branch
	StatusReadyForReturn Status = "ready_for_return" // sender picks up — only valid at origin branch
	StatusReturned       Status = "returned"         // sender picked up — terminal
	StatusCancelled      Status = "cancelled"        // cancelled by supervisor/admin — terminal
)

type PackageType string

const (
	PackageEnvelope PackageType = "envelope"
	PackageBox      PackageType = "box"
	PackagePallet   PackageType = "pallet"
)

type Address struct {
	Street     string `json:"street,omitempty"`
	City       string `json:"city"`
	Province   string `json:"province"`
	PostalCode string `json:"postal_code,omitempty"`
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
	ShipmentType ShipmentType `json:"shipment_type,omitempty"` // normal / express
	TimeWindow   TimeWindow   `json:"time_window,omitempty"`   // morning / afternoon / flexible
	ColdChain    bool         `json:"cold_chain,omitempty"`    // requires refrigeration

	// Receiving branch
	ReceivingBranchID string `json:"receiving_branch_id,omitempty"`

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
	EstimatedDeliveryAt time.Time  `json:"estimated_delivery_at"`
	DeliveredAt         *time.Time `json:"delivered_at,omitempty"`

	// Corrections: typed non-destructive field overrides; original data is never modified.
	Corrections *ShipmentCorrections `json:"corrections,omitempty"`
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
	WeightKg              *string       `json:"weight_kg,omitempty"`
	PackageType           *PackageType  `json:"package_type,omitempty"`
	SpecialInstructions   *string       `json:"special_instructions,omitempty"`
	ShipmentType          *ShipmentType `json:"shipment_type,omitempty"`
	TimeWindow            *TimeWindow   `json:"time_window,omitempty"`
	ColdChain             *string       `json:"cold_chain,omitempty"` // "true" / "false"
	IsFragile             *string       `json:"is_fragile,omitempty"` // "true" / "false"
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
	str(c.SenderName, "Sender name")
	str(c.SenderPhone, "Sender phone")
	str(c.SenderEmail, "Sender email")
	str(c.SenderDNI, "Sender DNI")
	str(c.OriginStreet, "Origin address (street)")
	str(c.OriginCity, "Origin city")
	str(c.OriginProvince, "Origin province")
	str(c.OriginPostalCode, "Origin postal code")
	str(c.RecipientName, "Recipient name")
	str(c.RecipientPhone, "Recipient phone")
	str(c.RecipientEmail, "Recipient email")
	str(c.RecipientDNI, "Recipient DNI")
	str(c.DestinationStreet, "Destination address (street)")
	str(c.DestinationCity, "Destination city")
	str(c.DestinationProvince, "Destination province")
	str(c.DestinationPostalCode, "Destination postal code")
	str(c.WeightKg, "Weight (kg)")
	if c.PackageType != nil {
		fields = append(fields, CorrectedField{Label: "Package type", Value: string(*c.PackageType)})
	}
	str(c.SpecialInstructions, "Special instructions")
	if c.ShipmentType != nil {
		fields = append(fields, CorrectedField{Label: "Shipment type", Value: string(*c.ShipmentType)})
	}
	if c.TimeWindow != nil {
		fields = append(fields, CorrectedField{Label: "Time window", Value: string(*c.TimeWindow)})
	}
	str(c.ColdChain, "Cold chain")
	str(c.IsFragile, "Fragile")
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
	if incoming.WeightKg != nil {
		base.WeightKg = incoming.WeightKg
	}
	if incoming.PackageType != nil {
		base.PackageType = incoming.PackageType
	}
	if incoming.ShipmentType != nil {
		base.ShipmentType = incoming.ShipmentType
	}
	if incoming.TimeWindow != nil {
		base.TimeWindow = incoming.TimeWindow
	}
	if incoming.ColdChain != nil {
		base.ColdChain = incoming.ColdChain
	}
	if incoming.IsFragile != nil {
		base.IsFragile = incoming.IsFragile
	}
	if incoming.SpecialInstructions != nil {
		base.SpecialInstructions = incoming.SpecialInstructions
	}
}

type CreateShipmentRequest struct {
	Sender    Customer `json:"sender"    binding:"required"`
	Recipient Customer `json:"recipient" binding:"required"`

	WeightKg            float64      `json:"weight_kg"           binding:"required,gt=0"`
	PackageType         PackageType  `json:"package_type"        binding:"required"`
	IsFragile           bool         `json:"is_fragile"`
	SpecialInstructions string       `json:"special_instructions"`
	ShipmentType        ShipmentType `json:"shipment_type"`
	TimeWindow          TimeWindow   `json:"time_window"`
	ColdChain           bool         `json:"cold_chain"`
	ReceivingBranchID   string       `json:"receiving_branch_id" binding:"required"`
	CreatedBy           string       `json:"created_by"`
}

// ShipmentFilter holds optional query filters for listing shipments.
type ShipmentFilter struct {
	DateFrom *time.Time // inclusive lower bound on created_at
	DateTo   *time.Time // inclusive upper bound on created_at (end of day)
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

	WeightKg            float64      `json:"weight_kg"`
	PackageType         PackageType  `json:"package_type"`
	IsFragile           bool         `json:"is_fragile"`
	SpecialInstructions string       `json:"special_instructions"`
	ShipmentType        ShipmentType `json:"shipment_type"`
	TimeWindow          TimeWindow   `json:"time_window"`
	ColdChain           bool         `json:"cold_chain"`
	ReceivingBranchID   string       `json:"receiving_branch_id"`
	CreatedBy           string       `json:"created_by"`
}
