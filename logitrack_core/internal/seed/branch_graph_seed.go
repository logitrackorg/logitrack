package seed

import (
	"log"
	"time"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// LoadBranchGraph pre-popula branch_graph con conexiones bidireccionales entre
// todas las sucursales activas. Permite que el feature multi-hop funcione desde
// el primer minuto sin esperar al cron del auto-derive de las 02:00 ART.
//
// Idempotente: si ya existen aristas, no hace nada (preserva ajustes del admin).
// El auto-derive nocturno refinará observed_count y avg_transit_hours con datos reales.
func LoadBranchGraph(repo repository.BranchGraphRepository, branchRepo repository.BranchRepository) {
	// Sin early-return: UpsertEdge es idempotente (ON CONFLICT UPDATE),
	// así que nuevas sucursales reciben sus aristas en cada arranque.
	branches := branchRepo.ListActive()
	if len(branches) < 2 {
		return
	}

	now := time.Now().UTC()
	count := 0
	for _, from := range branches {
		for _, to := range branches {
			if from.ID == to.ID {
				continue
			}
			var distKm float64
			if from.Latitude != nil && from.Longitude != nil &&
				to.Latitude != nil && to.Longitude != nil {
				distKm = ml.HaversineKm(*from.Latitude, *from.Longitude, *to.Latitude, *to.Longitude)
			} else {
				distKm = ml.ComputeDistance(from.Province, to.Province)
			}
			if distKm <= 0 {
				continue
			}
			// Estimación inicial: 60 km/h promedio en ruta inter-sucursal.
			// El auto-derive lo refinará con tiempos observados reales.
			avgHours := distKm / 60.0

			edge := model.BranchEdge{
				FromBranchID:    from.ID,
				ToBranchID:      to.ID,
				DistanceKm:      distKm,
				AvgTransitHours: avgHours,
				ObservedCount:   0,
				Enabled:         true,
				Source:          "auto",
				UpdatedAt:       now,
			}
			if err := repo.UpsertEdge(edge); err != nil {
				log.Printf("[seed branch_graph] error guardando %s→%s: %v", from.ID, to.ID, err)
				continue
			}
			count++
		}
	}
	log.Printf("[seed branch_graph] %d aristas inicializadas", count)
}
