package model

import "time"

// PublicLocation is the geo info exposed publicly: only city + province, no
// street address or postal code.
type PublicLocation struct {
	City     string `json:"city"`
	Province string `json:"province"`
}

// PublicShipmentView is the redacted projection of a Shipment served on
// /public/track endpoints. It deliberately omits all personal data (names,
// DNI, phone, email, full address) and any internal/business fields (price,
// ML priority, internal IDs other than the ones the public UI needs to
// identify the destination branch).
type PublicShipmentView struct {
	TrackingID string `json:"tracking_id"`

	Status              Status     `json:"status"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	EstimatedDeliveryAt *time.Time `json:"estimated_delivery_at"`
	DeliveredAt         *time.Time `json:"delivered_at,omitempty"`

	Origin      PublicLocation `json:"origin"`
	Destination PublicLocation `json:"destination"`

	// Branch IDs needed by the UI to render contextual labels. These are
	// non-sensitive identifiers (already exposed by /public/branches).
	CurrentLocation string `json:"current_location,omitempty"`
	FinalBranchID   string `json:"final_branch_id,omitempty"`

	ShipmentType   ShipmentType   `json:"shipment_type,omitempty"`
	TimeWindow     TimeWindow     `json:"time_window,omitempty"`
	DeliveryMethod DeliveryMethod `json:"delivery_method,omitempty"`
	IsFragile      bool           `json:"is_fragile,omitempty"`
	IsReturning    bool           `json:"is_returning,omitempty"`

	DeliveryAttempts int          `json:"delivery_attempts,omitempty"`
	HasIncident      bool         `json:"has_incident,omitempty"`
	IncidentType     IncidentType `json:"incident_type,omitempty"`
}

// PublicShipmentEvent is the redacted projection of a ShipmentEvent. It drops
// the operator username (changed_by) and any free-form notes, since notes can
// contain operational language not meant for end users.
type PublicShipmentEvent struct {
	ID              string         `json:"id"`
	TrackingID      string         `json:"tracking_id"`
	EventType       string         `json:"event_type,omitempty"`
	FromStatus      *Status        `json:"from_status,omitempty"`
	ToStatus        Status         `json:"to_status"`
	Location        string         `json:"location,omitempty"`
	Notes           string         `json:"notes,omitempty"`
	Timestamp       time.Time      `json:"timestamp"`
	CurrentLocation *EventLocation `json:"current_location,omitempty"`
	RescheduledDate *time.Time     `json:"rescheduled_date,omitempty"`
	Via             string         `json:"via,omitempty"`
	ClaimStatus     ClaimStatus    `json:"claim_status,omitempty"`
	ClaimUpdatedAt  *time.Time     `json:"claim_updated_at,omitempty"`
}

// ToPublicView builds a PublicShipmentView from a Shipment, applying any
// recipient/sender corrections to the origin/destination city + province so the
// public timeline reflects post-correction locations.
func (s *Shipment) ToPublicView() PublicShipmentView {
	originCity, originProv := s.Sender.Address.City, s.Sender.Address.Province
	destCity, destProv := s.Recipient.Address.City, s.Recipient.Address.Province
	if c := s.Corrections; c != nil {
		if c.OriginCity != nil {
			originCity = *c.OriginCity
		}
		if c.OriginProvince != nil {
			originProv = *c.OriginProvince
		}
		if c.DestinationCity != nil {
			destCity = *c.DestinationCity
		}
		if c.DestinationProvince != nil {
			destProv = *c.DestinationProvince
		}
	}
	return PublicShipmentView{
		TrackingID:          s.TrackingID,
		Status:              s.Status,
		CreatedAt:           s.CreatedAt,
		UpdatedAt:           s.UpdatedAt,
		EstimatedDeliveryAt: s.EstimatedDeliveryAt,
		DeliveredAt:         s.DeliveredAt,
		Origin:              PublicLocation{City: originCity, Province: originProv},
		Destination:         PublicLocation{City: destCity, Province: destProv},
		CurrentLocation:     s.CurrentLocation,
		FinalBranchID:       s.FinalBranchID,
		ShipmentType:        s.ShipmentType,
		TimeWindow:          s.TimeWindow,
		DeliveryMethod:      s.DeliveryMethod,
		IsFragile:           s.IsFragile,
		IsReturning:         s.IsReturning,
		DeliveryAttempts:    s.DeliveryAttempts,
		HasIncident:         s.HasIncident,
		IncidentType:        s.IncidentType,
	}
}

// ToPublicEvent strips operator/notes data from a ShipmentEvent.
func (e ShipmentEvent) ToPublicEvent() PublicShipmentEvent {
	return PublicShipmentEvent{
		ID:              e.ID,
		TrackingID:      e.TrackingID,
		EventType:       e.EventType,
		FromStatus:      e.FromStatus,
		ToStatus:        e.ToStatus,
		Location:        e.Location,
		Notes:           e.Notes,
		Timestamp:       e.Timestamp,
		CurrentLocation: e.CurrentLocation,
		RescheduledDate: e.RescheduledDate,
		Via:             e.Via,
	}
}
