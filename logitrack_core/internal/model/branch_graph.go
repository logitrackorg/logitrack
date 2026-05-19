package model

import "time"

// BranchEdge representa una arista dirigida en el grafo de sucursales.
// Cada par (FromBranchID, ToBranchID) es único — la clave primaria de la tabla.
//
// Source indica el origen del dato:
//   - "auto": derivada automáticamente del historial de shipment_hop_metrics.
//   - "manual": creada o modificada por un admin.
//
// Enabled permite a un admin desactivar una arista sin borrarla (auditoría).
type BranchEdge struct {
	FromBranchID    string    `json:"from_branch_id"`
	ToBranchID      string    `json:"to_branch_id"`
	DistanceKm      float64   `json:"distance_km"`
	AvgTransitHours float64   `json:"avg_transit_hours"`
	ObservedCount   int       `json:"observed_count"` // tramos históricos observados
	Enabled         bool      `json:"enabled"`
	Source          string    `json:"source"` // "auto" | "manual"
	UpdatedAt       time.Time `json:"updated_at"`
}

// BranchGraph es la colección de todas las aristas del grafo de red.
type BranchGraph struct {
	Edges []BranchEdge `json:"edges"`
}

// HopAggregate es el resultado crudo del auto-derive antes de enriquecer con distancias.
type HopAggregate struct {
	FromBranchID    string
	ToBranchID      string
	ObservedCount   int
	AvgTransitHours float64
}
