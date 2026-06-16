// Package scheduler configura el cron in-process que genera el plan global de
// ruteo todos los días a las 08:00 hora argentina, y calcula el Empleado del Mes
// el primer día de cada mes a las 00:00. Requiere github.com/robfig/cron/v3.
package scheduler

import (
	"context"
	"log"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/service"
	"github.com/robfig/cron/v3"
)

// Scheduler envuelve el cron in-process y los servicios programados.
type Scheduler struct {
	c          *cron.Cron
	routingSvc *service.RoutingService
	eomSvc     *service.EmployeeOfMonthService
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

// SetEmployeeOfMonthService registers the monthly ranking service.
func (s *Scheduler) SetEmployeeOfMonthService(svc *service.EmployeeOfMonthService) {
	s.eomSvc = svc
}

// Start registra el job diario de ruteo a las 08:00 ART, el job mensual de
// Empleado del Mes a las 00:00 del día 1, y arranca el cron.
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

	if s.eomSvc != nil {
		_, err = s.c.AddFunc("0 0 1 * *", func() {
			log.Printf("[scheduler] calculando Empleado del Mes...")
			period := service.PreviousMonthStart()
			if err := s.eomSvc.ComputeAndPersist(period); err != nil {
				log.Printf("[scheduler] error calculando Empleado del Mes: %v", err)
				return
			}
			log.Printf("[scheduler] Empleado del Mes calculado para %s", period.Format("2006-01"))
		})
		if err != nil {
			return err
		}
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
