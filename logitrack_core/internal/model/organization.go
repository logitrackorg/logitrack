package model

import "time"

type OrganizationConfig struct {
	ID           int       `json:"id"`
	Name         string    `json:"name"`
	CUIT         string    `json:"cuit"`
	Address      string    `json:"address"`
	Phone        string    `json:"phone"`
	Email        string    `json:"email"`
	TrackURL     string    `json:"track_url"`
	PrimaryColor string    `json:"primary_color"`
	AccentColor  string    `json:"accent_color"`
	SidebarColor string    `json:"sidebar_color"`
	LogoURL      string    `json:"logo_url"`
	UpdatedAt    time.Time `json:"updated_at"`
	UpdatedBy    string    `json:"updated_by"`
}
