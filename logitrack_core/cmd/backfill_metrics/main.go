// backfill_metrics reconstruye las métricas históricas de observabilidad
// (Phase 0 del roadmap de ruteo) desde los datos existentes en la base.
//
// Ejecución:
//
//	go run cmd/backfill_metrics/main.go
//
// Es idempotente: puede correrse varias veces. La misma lógica está expuesta
// en el scheduler para correr a diario automáticamente.
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/logitrack/core/internal/db"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	database, err := db.NewDB(
		getenv("DB_HOST", "localhost"),
		getenv("DB_PORT", "5432"),
		getenv("DB_USER", "logitrack"),
		getenv("DB_PASSWORD", ""),
		getenv("DB_NAME", "logitrack"),
		getenv("DB_SSLMODE", "require"),
	)
	if err != nil {
		log.Fatalf("no se pudo conectar a la base: %v", err)
	}
	if err := db.RunMigrations(database); err != nil {
		log.Fatalf("error en migraciones: %v", err)
	}

	repo := repository.NewPostgresRoutingMetricsRepository(database)
	svc := service.NewRoutingMetricsService(repo)

	fmt.Println("=== Backfill métricas Phase 0 ===")
	odCount, hopCount, err := svc.RunBackfill()
	if err != nil {
		log.Fatalf("error en backfill: %v", err)
	}
	fmt.Printf("OD volumes:  %d pares procesados\n", odCount)
	fmt.Printf("Hops:        %d tramos registrados\n", hopCount)
	fmt.Println("=== Backfill completado ===")
}
