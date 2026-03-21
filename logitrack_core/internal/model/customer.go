package model

type Customer struct {
	DNI     string  `json:"dni"`
	Name    string  `json:"name"`
	Phone   string  `json:"phone"`
	Email   string  `json:"email,omitempty"`
	Address Address `json:"address"`
}
