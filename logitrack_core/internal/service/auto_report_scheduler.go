package service

import (
	"log"
	"time"

	"github.com/logitrack/core/internal/model"
)

// AutoReportScheduler dispara cada minuto y ejecuta los schedules que deban correr en este momento.
// Granularidad de un minuto es suficiente: los schedules definen hora HH:MM, y nos aseguramos de
// no correr el mismo schedule dos veces el mismo minuto vía LastRunAt.
type AutoReportScheduler struct {
	svc  *AutoReportService
	stop chan struct{}
	// loc es la zona horaria usada para interpretar el time_of_day del schedule.
	loc *time.Location
}

// NewAutoReportScheduler construye el scheduler usando ART (America/Argentina/Buenos_Aires).
func NewAutoReportScheduler(svc *AutoReportService) *AutoReportScheduler {
	loc, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		loc = time.UTC
	}
	return &AutoReportScheduler{svc: svc, stop: make(chan struct{}), loc: loc}
}

// Start lanza el loop en background.
func (s *AutoReportScheduler) Start() {
	go s.loop()
}

// Stop detiene el scheduler.
func (s *AutoReportScheduler) Stop() {
	close(s.stop)
}

func (s *AutoReportScheduler) loop() {
	s.tick()
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.tick()
		case <-s.stop:
			log.Println("[auto-report-scheduler] stopped")
			return
		}
	}
}

func (s *AutoReportScheduler) tick() {
	schedules, err := s.svc.repo.ListActiveSchedules()
	if err != nil {
		log.Printf("[auto-report-scheduler] list active: %v", err)
		return
	}
	now := time.Now().In(s.loc)
	for _, sched := range schedules {
		if !s.shouldRun(sched, now) {
			continue
		}
		if _, err := s.svc.RunSchedule(sched); err != nil {
			log.Printf("[auto-report-scheduler] run schedule id=%s: %v", sched.ID, err)
		}
	}
}

// shouldRun decide si un schedule debe correr en el minuto actual.
// Reglas:
//   - Hora/minuto del schedule debe coincidir con now.
//   - Para weekly: el day_of_week debe coincidir con now.Weekday().
//   - Para monthly: el day_of_month debe coincidir con now.Day().
//   - Si ya corrió en este minuto/día (según frecuencia), se saltea.
func (s *AutoReportScheduler) shouldRun(sched model.AutoReportSchedule, now time.Time) bool {
	h, m := ParseTimeOfDay(sched.TimeOfDay)
	if now.Hour() != h || now.Minute() != m {
		return false
	}
	switch sched.Frequency {
	case model.ReportFrequencyDaily:
		// nada extra
	case model.ReportFrequencyWeekly:
		if sched.DayOfWeek == nil || *sched.DayOfWeek != int(now.Weekday()) {
			return false
		}
	case model.ReportFrequencyMonthly:
		if sched.DayOfMonth == nil || *sched.DayOfMonth != now.Day() {
			return false
		}
	}
	if sched.LastRunAt != nil {
		// Evitar doble disparo dentro del mismo minuto si el tick se ejecutó dos veces.
		last := sched.LastRunAt.In(s.loc)
		if last.Year() == now.Year() && last.YearDay() == now.YearDay() &&
			last.Hour() == now.Hour() && last.Minute() == now.Minute() {
			return false
		}
	}
	return true
}
