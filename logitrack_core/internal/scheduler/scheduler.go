// Package scheduler configura el cron in-process que genera el plan global de
// ruteo todos los días a las 08:00 hora argentina. Requiere github.com/robfig/cron/v3.
package scheduler

import (
	"context"
	"log"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/service"
	"github.com/robfig/cron/v3"
)

// Scheduler envuelve el cron in-process y el servicio de ruteo.
type Scheduler struct {
	c          *cron.Cron
	routingSvc *service.RoutingService
}

// New crea el scheduler con la zona horaria America/Argentina/Buenos_Aires.
// Llama Start() para activarlo y Stop() en el shutdown del servidor.
func New(routingSvc *service.RoutingService) *Scheduler {
	c := cron.New(
		cron.WithLocation(clock.LocalTZ),
		cron.WithLogger(cron.PrintfLogger(log.Default())),
	)
	return &Scheduler{c: c, routingSvc: routingSvc}
}

// Start registra el job diario a las 08:00 ART y arranca el cron.
func (s *Scheduler) Start() error {
	_, err := s.c.AddFunc("0 8 * * *", func() {
		log.Printf("[scheduler] generando plan global de ruteo...")
		plan, err := s.routingSvc.GenerateAndPersistGlobalPlan(context.Background())
		if err != nil {
			log.Printf("[scheduler] error generando plan: %v", err)
			return
		}
		log.Printf("[scheduler] plan %s listo — %d asignados, %d sin asignar, %d sucursales",
			plan.PlanDate, plan.Log.TotalAssigned, plan.Log.TotalUnassigned, plan.Log.TotalBranches)
	})
	if err != nil {
		return err
	}
	s.c.Start()
	return nil
}

// Stop detiene el cron de forma ordenada (espera que el job en curso termine).
func (s *Scheduler) Stop() {
	s.c.Stop()
}

// RunNow dispara el job inmediatamente en la goroutine actual. Útil en dev y tests.
func (s *Scheduler) RunNow() {
	log.Printf("[scheduler] ejecución manual del plan de ruteo...")
	plan, err := s.routingSvc.GenerateAndPersistGlobalPlan(context.Background())
	if err != nil {
		log.Printf("[scheduler] error: %v", err)
		return
	}
	log.Printf("[scheduler] plan %s listo — %d asignados, %d sin asignar",
		plan.PlanDate, plan.Log.TotalAssigned, plan.Log.TotalUnassigned)
}
