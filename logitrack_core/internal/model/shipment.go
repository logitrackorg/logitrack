package model

import "time"

type Status string

const (
	StatusPending        Status = "pending"     // draft — partial data, no tracking ID yet
	StatusInProgress     Status = "in_progress" // confirmed — tracking ID assigned, awaiting transit
	StatusInTransit      Status = "in_transit"
	StatusAtBranch       Status = "at_branch"
	StatusDelivering     Status = "delivering"
	StatusDelivered      Status = "delivered"
	StatusDeliveryFailed Status = "delivery_failed"
	StatusReadyForPickup Status = "ready_for_pickup" // recipient picks up at current branch
	StatusReadyForReturn Status = "ready_for_return" // sender picks up — only valid at origin branch
	StatusReturned       Status = "returned"         // sender picked up — terminal
)

type PackageType string

const (
	PackageEnvelope PackageType = "envelope"
	PackageBox      PackageType = "box"
	PackagePallet   PackageType = "pallet"
	PackageFragile  PackageType = "fragile"
)

type Address struct {
	Street     string `json:"street,omitempty"`
	City       string `json:"city"`
	Province   string `json:"province"`
	PostalCode string `json:"postal_code,omitempty"`
}

type Shipment struct {
	TrackingID string `json:"tracking_id"`

	// Sender
	SenderName  string  `json:"sender_name"`
	SenderPhone string  `json:"sender_phone"`
	SenderEmail string  `json:"sender_email,omitempty"`
	SenderDNI   string  `json:"sender_dni"`
	Origin      Address `json:"origin"`

	// Recipient
	RecipientName  string  `json:"recipient_name"`
	RecipientPhone string  `json:"recipient_phone"`
	RecipientEmail string  `json:"recipient_email,omitempty"`
	RecipientDNI   string  `json:"recipient_dni"`
	Destination    Address `json:"destination"`

	// Package
	WeightKg            float64     `json:"weight_kg"`
	PackageType         PackageType `json:"package_type"`
	SpecialInstructions string      `json:"special_instructions,omitempty"`

	// Receiving branch
	ReceivingBranchID string `json:"receiving_branch_id,omitempty"`

	// Status & dates
	Status              Status     `json:"status"`
	CurrentLocation     string     `json:"current_location,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	EstimatedDeliveryAt time.Time  `json:"estimated_delivery_at"`
	DeliveredAt         *time.Time `json:"delivered_at,omitempty"`
}

type CreateShipmentRequest struct {
	SenderName  string  `json:"sender_name"  binding:"required"`
	SenderPhone string  `json:"sender_phone" binding:"required"`
	SenderEmail string  `json:"sender_email"`
	SenderDNI   string  `json:"sender_dni"   binding:"required"`
	Origin      Address `json:"origin"       binding:"required"`

	RecipientName  string  `json:"recipient_name"  binding:"required"`
	RecipientPhone string  `json:"recipient_phone" binding:"required"`
	RecipientEmail string  `json:"recipient_email"`
	RecipientDNI   string  `json:"recipient_dni"   binding:"required"`
	Destination    Address `json:"destination"     binding:"required"`

	WeightKg            float64     `json:"weight_kg"           binding:"required,gt=0"`
	PackageType         PackageType `json:"package_type"        binding:"required"`
	SpecialInstructions string      `json:"special_instructions"`
	ReceivingBranchID   string      `json:"receiving_branch_id" binding:"required"`
	CreatedBy           string      `json:"created_by"`
}

// ShipmentFilter holds optional query filters for listing shipments.
type ShipmentFilter struct {
	DateFrom *time.Time // inclusive lower bound on created_at
	DateTo   *time.Time // inclusive upper bound on created_at (end of day)
}

// EditShipmentRequest updates a confirmed (in_progress) shipment's data.
type EditShipmentRequest struct {
	SenderName  string  `json:"sender_name"  binding:"required"`
	SenderPhone string  `json:"sender_phone" binding:"required"`
	SenderEmail string  `json:"sender_email"`
	SenderDNI   string  `json:"sender_dni"   binding:"required"`
	Origin      Address `json:"origin"       binding:"required"`

	RecipientName  string  `json:"recipient_name"  binding:"required"`
	RecipientPhone string  `json:"recipient_phone" binding:"required"`
	RecipientEmail string  `json:"recipient_email"`
	RecipientDNI   string  `json:"recipient_dni"   binding:"required"`
	Destination    Address `json:"destination"     binding:"required"`

	WeightKg            float64     `json:"weight_kg"           binding:"required,gt=0"`
	PackageType         PackageType `json:"package_type"        binding:"required"`
	SpecialInstructions string      `json:"special_instructions"`
	ReceivingBranchID   string      `json:"receiving_branch_id" binding:"required"`
	ChangedBy           string      `json:"changed_by"`
}

// SaveDraftRequest allows partial data — no required fields.
type SaveDraftRequest struct {
	SenderName  string  `json:"sender_name"`
	SenderPhone string  `json:"sender_phone"`
	SenderEmail string  `json:"sender_email"`
	SenderDNI   string  `json:"sender_dni"`
	Origin      Address `json:"origin"`

	RecipientName  string  `json:"recipient_name"`
	RecipientPhone string  `json:"recipient_phone"`
	RecipientEmail string  `json:"recipient_email"`
	RecipientDNI   string  `json:"recipient_dni"`
	Destination    Address `json:"destination"`

	WeightKg            float64     `json:"weight_kg"`
	PackageType         PackageType `json:"package_type"`
	SpecialInstructions string      `json:"special_instructions"`
	ReceivingBranchID   string      `json:"receiving_branch_id"`
	CreatedBy           string      `json:"created_by"`
}
