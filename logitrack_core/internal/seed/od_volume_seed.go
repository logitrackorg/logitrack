package seed

import (
	"log"
	"math"
	"math/rand"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/repository"
)

// SeedODVolume genera 90 días sintéticos de volumen O-D para que el forecasting
// de Phase 4 tenga datos significativos en la demo. Determinístico (seed fija)
// para que dos arranques den los mismos números.
//
// Patrones generados:
//   - Lunes-Miércoles: volumen alto (negocios B2B)
//   - Jueves-Viernes: volumen medio
//   - Sábado-Domingo: volumen bajo
//   - Variación aleatoria ±20% sobre la base
//   - Pares principales (caba↔cordoba, caba↔mendoza, cordoba↔mendoza): más volumen
//   - Otros pares (jujuy, posadas, bariloche): volumen residual
//
// Idempotente: si ya hay datos en od_pair_daily_volume, no hace nada.
func SeedODVolume(repo repository.RoutingMetricsRepository, branchRepo repository.BranchRepository) {
	// Si ya hay datos, asumir que el backfill o seed previo los puso.
	now := time.Now().In(clock.LocalTZ)
	existing, err := repo.ListODVolume("", "", now.AddDate(0, 0, -90), now)
	if err == nil && len(existing) > 100 {
		// Suficiente data ya — skipear
		return
	}

	branches := branchRepo.ListActive()
	if len(branches) < 2 {
		return
	}

	rng := rand.New(rand.NewSource(42)) // seed fija → determinístico

	// Volumen base diario por par O-D (lunes típico, en envíos/día).
	// Los pares "calientes" tienen más volumen.
	baseVolumeForPair := func(origin, dest string) (count int, weight float64) {
		hotPairs := map[string]bool{
			"caba|cordoba":    true,
			"cordoba|caba":    true,
			"caba|mendoza":    true,
			"mendoza|caba":    true,
			"cordoba|mendoza": true,
			"mendoza|cordoba": true,
		}
		warmPairs := map[string]bool{
			"caba|posadas":    true,
			"posadas|caba":    true,
			"caba|jujuy":      true,
			"jujuy|caba":      true,
		}
		key := origin + "|" + dest
		if hotPairs[key] {
			return 18, 250.0
		}
		if warmPairs[key] {
			return 6, 80.0
		}
		return 2, 25.0
	}

	// Multiplicador por día de semana
	dowMultiplier := map[time.Weekday]float64{
		time.Monday:    1.2,
		time.Tuesday:   1.1,
		time.Wednesday: 1.1,
		time.Thursday:  0.9,
		time.Friday:    0.8,
		time.Saturday:  0.4,
		time.Sunday:    0.3,
	}

	count := 0
	for offset := 1; offset <= 90; offset++ {
		day := now.AddDate(0, 0, -offset)
		date := day.Format("2006-01-02")
		mult := dowMultiplier[day.Weekday()]

		for _, origin := range branches {
			for _, dest := range branches {
				if origin.ID == dest.ID {
					continue
				}
				baseCount, baseWeight := baseVolumeForPair(origin.ID, dest.ID)
				if baseCount == 0 {
					continue
				}
				// Variación aleatoria ±20%
				jitter := 0.8 + rng.Float64()*0.4
				predictedCount := math.Max(0, float64(baseCount)*mult*jitter)
				if predictedCount < 0.5 {
					continue // skipear ruido bajo
				}
				finalCount := int(predictedCount + 0.5)
				finalWeight := baseWeight * mult * jitter

				if err := repo.IncrementODVolume(origin.ID, dest.ID, date, finalCount, finalWeight); err != nil {
					log.Printf("[seed od_volume] error: %v", err)
					continue
				}
				count++
			}
		}
	}
	log.Printf("[seed od_volume] %d días-pares poblados (90 días sintéticos para forecasting)", count)
}
