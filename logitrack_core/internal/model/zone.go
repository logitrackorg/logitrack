package model

import "time"

type ZonePoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Zone struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Polygon     []ZonePoint `json:"polygon"`
	Active      bool        `json:"active"`
	CreatedBy   string      `json:"created_by"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

type CreateZoneRequest struct {
	Name        string      `json:"name" binding:"required"`
	Description string      `json:"description"`
	Polygon     []ZonePoint `json:"polygon" binding:"required"`
}

type UpdateZoneRequest struct {
	Name        *string     `json:"name"`
	Description *string     `json:"description"`
	Polygon     []ZonePoint `json:"polygon"`
	Active      *bool       `json:"active"`
}
