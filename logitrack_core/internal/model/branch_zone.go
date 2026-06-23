package model

import "time"

type BranchZoneType string

const (
	ZoneEntrada    BranchZoneType = "entrada"
	ZoneSalida     BranchZoneType = "salida"
	ZoneRevision   BranchZoneType = "revision"
	ZoneDevolucion BranchZoneType = "devolucion"
)

type BranchZone struct {
	ID        string         `json:"id"`
	BranchID  string         `json:"branch_id"`
	ZoneType  BranchZoneType `json:"zone_type"`
	Name      string         `json:"name"`
	Active    bool           `json:"active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

var BranchZoneNames = map[BranchZoneType]string{
	ZoneEntrada:    "Entrada",
	ZoneSalida:     "En depósito para despachar",
	ZoneRevision:   "Revisión",
	ZoneDevolucion: "Listo para devolución",
}
