package model

import (
	"encoding/json"
	"time"
)

// DateOnly wraps time.Time and serializes as a YYYY-MM-DD string, avoiding
// full RFC3339 timestamps in the API response for date-only values.
type DateOnly time.Time

// NewDateOnly creates a DateOnly from a time.Time, truncated to midnight UTC.
func NewDateOnly(t time.Time) DateOnly {
	y, m, d := t.UTC().Date()
	return DateOnly(time.Date(y, m, d, 0, 0, 0, 0, time.UTC))
}

func (d DateOnly) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Time(d).Format("2006-01-02"))
}

func (d *DateOnly) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return err
	}
	*d = DateOnly(t)
	return nil
}

func (d DateOnly) Equal(other DateOnly) bool {
	return time.Time(d).Equal(time.Time(other))
}

func (d DateOnly) String() string {
	return time.Time(d).Format("2006-01-02")
}

type RouteStatus string

const (
	RouteStatusPending  RouteStatus = "pendiente"
	RouteStatusActive   RouteStatus = "en_curso"
	RouteStatusFinished RouteStatus = "finalizada"
)

type Route struct {
	ID          string      `json:"id"`
	Date        DateOnly    `json:"date"`
	DriverID    string      `json:"driver_id"`
	ShipmentIDs []string    `json:"shipment_ids"`
	CreatedBy   string      `json:"created_by"`
	CreatedAt   time.Time   `json:"created_at"`
	Status      RouteStatus `json:"status"`
	StartedAt   *time.Time  `json:"started_at,omitempty"`
}

func (r Route) HasShipment(trackingID string) bool {
	for _, id := range r.ShipmentIDs {
		if id == trackingID {
			return true
		}
	}
	return false
}

type CreateRouteRequest struct {
	Date        string   `json:"date"         binding:"required"` // YYYY-MM-DD; parsed to DateOnly in service
	DriverID    string   `json:"driver_id"    binding:"required"`
	ShipmentIDs []string `json:"shipment_ids" binding:"required"`
}
