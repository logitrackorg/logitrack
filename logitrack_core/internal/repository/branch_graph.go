package repository

import "github.com/logitrack/core/internal/model"

// BranchGraphRepository persiste el grafo de sucursales y expone el auto-derive.
type BranchGraphRepository interface {
	// ListEdges devuelve todas las aristas (habilitadas y deshabilitadas).
	ListEdges() ([]model.BranchEdge, error)
	// GetEdge devuelve una arista específica. ok=false si no existe.
	GetEdge(fromBranchID, toBranchID string) (model.BranchEdge, bool)
	// UpsertEdge inserta o actualiza una arista (clave = from+to).
	UpsertEdge(edge model.BranchEdge) error
	// SetEnabled activa o desactiva una arista existente.
	SetEnabled(fromBranchID, toBranchID string, enabled bool) error
	// DeriveHopAggregates calcula estadísticas de tramos desde shipment_hop_metrics.
	// Devuelve solo pares con llegada registrada y transit_hours > 0.
	DeriveHopAggregates() ([]model.HopAggregate, error)
}
