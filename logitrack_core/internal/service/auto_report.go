package service

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// AutoReportService gestiona schedules y la generación de reportes automáticos.
type AutoReportService struct {
	repo     repository.AutoReportRepository
	statsSvc *StatsExtendedService
	// shipmentRepo se usa para los KPIs base del resumen (delegate to *ShipmentService o repo directo).
	notifier *NotificationService
}

// NewAutoReportService construye el servicio.
func NewAutoReportService(repo repository.AutoReportRepository, statsSvc *StatsExtendedService, notifier *NotificationService) *AutoReportService {
	return &AutoReportService{repo: repo, statsSvc: statsSvc, notifier: notifier}
}

// CreateSchedule valida y persiste un nuevo schedule.
func (s *AutoReportService) CreateSchedule(ownerUserID string, in model.CreateAutoReportScheduleInput) (model.AutoReportSchedule, error) {
	if err := validateScheduleInput(in.Frequency, in.TimeOfDay, in.DayOfWeek, in.DayOfMonth, in.Metrics, in.Name); err != nil {
		return model.AutoReportSchedule{}, err
	}
	now := time.Now().UTC()
	sched := model.AutoReportSchedule{
		ID:          uuid.NewString(),
		OwnerUserID: ownerUserID,
		Name:        strings.TrimSpace(in.Name),
		Frequency:   in.Frequency,
		TimeOfDay:   in.TimeOfDay,
		DayOfWeek:   in.DayOfWeek,
		DayOfMonth:  in.DayOfMonth,
		Metrics:     in.Metrics,
		BranchID:    in.BranchID,
		Email:       strings.TrimSpace(in.Email),
		Active:      in.Active,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.CreateSchedule(sched); err != nil {
		return model.AutoReportSchedule{}, err
	}
	return sched, nil
}

// UpdateSchedule aplica los cambios y vuelve a validar el estado resultante.
func (s *AutoReportService) UpdateSchedule(id string, in model.UpdateAutoReportScheduleInput) (model.AutoReportSchedule, error) {
	existing, err := s.repo.GetSchedule(id)
	if err != nil {
		return model.AutoReportSchedule{}, err
	}
	if in.Name != nil {
		existing.Name = strings.TrimSpace(*in.Name)
	}
	if in.Frequency != nil {
		existing.Frequency = *in.Frequency
	}
	if in.TimeOfDay != nil {
		existing.TimeOfDay = *in.TimeOfDay
	}
	if in.DayOfWeek != nil {
		existing.DayOfWeek = in.DayOfWeek
	}
	if in.DayOfMonth != nil {
		existing.DayOfMonth = in.DayOfMonth
	}
	if in.Metrics != nil {
		existing.Metrics = *in.Metrics
	}
	if in.BranchID != nil {
		existing.BranchID = *in.BranchID
	}
	if in.Email != nil {
		existing.Email = strings.TrimSpace(*in.Email)
	}
	if in.Active != nil {
		existing.Active = *in.Active
	}
	if err := validateScheduleInput(existing.Frequency, existing.TimeOfDay, existing.DayOfWeek, existing.DayOfMonth, existing.Metrics, existing.Name); err != nil {
		return model.AutoReportSchedule{}, err
	}
	existing.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateSchedule(existing); err != nil {
		return model.AutoReportSchedule{}, err
	}
	return existing, nil
}

// DeleteSchedule borra un schedule.
func (s *AutoReportService) DeleteSchedule(id string) error {
	return s.repo.DeleteSchedule(id)
}

// GetSchedule devuelve un schedule por id.
func (s *AutoReportService) GetSchedule(id string) (model.AutoReportSchedule, error) {
	return s.repo.GetSchedule(id)
}

// ListSchedules devuelve todos los schedules.
func (s *AutoReportService) ListSchedules() ([]model.AutoReportSchedule, error) {
	return s.repo.ListSchedules()
}

// ListGenerated devuelve los reportes generados ordenados de más reciente a más antiguo.
func (s *AutoReportService) ListGenerated(limit int) ([]model.GeneratedReport, error) {
	return s.repo.ListGenerated(limit)
}

// GetGenerated devuelve un reporte generado por id.
func (s *AutoReportService) GetGenerated(id string) (model.GeneratedReport, error) {
	return s.repo.GetGenerated(id)
}

// RunSchedule genera el reporte ahora mismo (manual o disparado por scheduler).
// Crea la fila en auto_report_generated y dispara la notificación al owner.
func (s *AutoReportService) RunSchedule(sched model.AutoReportSchedule) (model.GeneratedReport, error) {
	now := time.Now().UTC()
	periodFrom, periodTo := computePeriod(sched.Frequency, now)
	snapshot, hasData := s.buildSnapshot(sched, periodFrom, periodTo)

	gen := model.GeneratedReport{
		ID:           uuid.NewString(),
		ScheduleID:   sched.ID,
		ScheduleName: sched.Name,
		Frequency:    sched.Frequency,
		PeriodFrom:   periodFrom,
		PeriodTo:     periodTo,
		BranchID:     sched.BranchID,
		Email:        sched.Email,
		GeneratedAt:  now,
		HasData:      hasData,
		Snapshot:     snapshot,
	}
	if err := s.repo.CreateGenerated(gen); err != nil {
		return model.GeneratedReport{}, err
	}
	if err := s.repo.MarkScheduleRun(sched.ID, now); err != nil {
		log.Printf("[auto-report] mark schedule run id=%s: %v", sched.ID, err)
	}
	s.notifyOwner(sched, gen)
	return gen, nil
}

func (s *AutoReportService) notifyOwner(sched model.AutoReportSchedule, gen model.GeneratedReport) {
	if s.notifier == nil {
		return
	}
	title := "Reporte automático listo"
	body := sched.Name
	if !gen.HasData {
		body += " · No hay datos disponibles para el período"
	} else {
		body += fmt.Sprintf(" · %s a %s", gen.PeriodFrom.Format("02/01/2006"), gen.PeriodTo.Format("02/01/2006"))
	}
	if err := s.notifier.CreateForUser(sched.OwnerUserID, model.NotificationAutoReportGenerated, title, body, gen.ID); err != nil {
		log.Printf("[auto-report] notify owner schedule=%s: %v", sched.ID, err)
	}
}

// buildSnapshot computa los KPIs según las métricas configuradas y devuelve (snapshot, hasData).
// Si todas las métricas devuelven datasets vacíos, hasData=false y se marca "No hay datos".
func (s *AutoReportService) buildSnapshot(sched model.AutoReportSchedule, from, to time.Time) (map[string]any, bool) {
	out := map[string]any{
		"period_from": from.Format("2006-01-02"),
		"period_to":   to.Format("2006-01-02"),
		"branch_id":   sched.BranchID,
	}
	hasData := false

	for _, m := range sched.Metrics {
		switch m {
		case model.MetricTipoEnvio:
			res, err := s.statsSvc.VolumeByShipmentType(&from, &to, sched.BranchID)
			if err == nil {
				out["tipo_envio"] = res
				if res.Total > 0 {
					hasData = true
				}
			}
		case model.MetricMetodoEntrega:
			res, err := s.statsSvc.VolumeByDeliveryMethod(&from, &to, sched.BranchID)
			if err == nil {
				out["metodo_entrega"] = res
				if res.Total > 0 {
					hasData = true
				}
			}
		case model.MetricVolumenVentana:
			res, err := s.statsSvc.VolumeByTimeWindow(&from, &to, sched.BranchID)
			if err == nil {
				out["volumen_ventana"] = res
				if res.Total > 0 {
					hasData = true
				}
			}
		case model.MetricTasaExito:
			res, err := s.statsSvc.SuccessRateByBranch(&from, &to, sched.BranchID)
			if err == nil {
				out["tasa_exito"] = res
				if len(res.Branches) > 0 {
					hasData = true
				}
			}
		case model.MetricChoferes:
			res, err := s.statsSvc.DriverPerformance(&from, &to, sched.BranchID)
			if err == nil {
				out["choferes"] = res
				if len(res.Drivers) > 0 {
					hasData = true
				}
			}
		case model.MetricFacturacion:
			res, err := s.statsSvc.BillingMetrics(&from, &to, sched.BranchID)
			if err == nil {
				out["facturacion"] = res
				if res.Count > 0 {
					hasData = true
				}
			}
		case model.MetricRanking:
			res, err := s.statsSvc.BranchRanking(&from, &to, sched.BranchID)
			if err == nil {
				out["ranking"] = res
				if len(res.Ranking) > 0 {
					hasData = true
				}
			}
		case model.MetricRetorno:
			res, err := s.statsSvc.ReturnMetrics(&from, &to, sched.BranchID)
			if err == nil {
				out["retorno"] = res
				if res.TotalReturned > 0 || res.TotalReadyForReturn > 0 || res.TotalReturnEligible > 0 {
					hasData = true
				}
			}
		case model.MetricResumen:
			// El resumen combina varios datasets; usamos lo que ya tenemos disponible vía stats extended.
			vt, _ := s.statsSvc.VolumeByTimeWindow(&from, &to, sched.BranchID)
			st, _ := s.statsSvc.VolumeByShipmentType(&from, &to, sched.BranchID)
			out["resumen"] = map[string]any{
				"total_envios": vt.Total,
				"por_ventana":  vt.Buckets,
				"por_tipo":     st.Buckets,
			}
			if vt.Total > 0 {
				hasData = true
			}
		}
	}
	return out, hasData
}

// computePeriod determina el rango de fechas que cubre un reporte según su frecuencia.
//   - daily   → ayer 00:00 a ayer 23:59:59
//   - weekly  → últimos 7 días completos
//   - monthly → mes calendario anterior
func computePeriod(freq model.ReportFrequency, now time.Time) (time.Time, time.Time) {
	loc := now.Location()
	switch freq {
	case model.ReportFrequencyDaily:
		y := now.AddDate(0, 0, -1)
		from := time.Date(y.Year(), y.Month(), y.Day(), 0, 0, 0, 0, loc)
		to := from.Add(24*time.Hour - time.Nanosecond)
		return from, to
	case model.ReportFrequencyWeekly:
		end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).Add(-time.Nanosecond)
		start := end.AddDate(0, 0, -6).Add(time.Nanosecond)
		start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
		return start, end
	case model.ReportFrequencyMonthly:
		firstOfThisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		end := firstOfThisMonth.Add(-time.Nanosecond)
		start := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, loc)
		return start, end
	default:
		from := now.AddDate(0, 0, -1)
		return from, now
	}
}

func validateScheduleInput(freq model.ReportFrequency, timeOfDay string, dayOfWeek, dayOfMonth *int, metrics []model.ReportMetric, name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("nombre requerido")
	}
	switch freq {
	case model.ReportFrequencyDaily, model.ReportFrequencyWeekly, model.ReportFrequencyMonthly:
	default:
		return fmt.Errorf("frecuencia inválida: usar daily, weekly o monthly")
	}
	if !isValidTimeOfDay(timeOfDay) {
		return fmt.Errorf("hora inválida, usar HH:MM (24h)")
	}
	if freq == model.ReportFrequencyWeekly {
		if dayOfWeek == nil || *dayOfWeek < 0 || *dayOfWeek > 6 {
			return fmt.Errorf("day_of_week requerido para frecuencia semanal (0–6, domingo=0)")
		}
	}
	if freq == model.ReportFrequencyMonthly {
		if dayOfMonth == nil || *dayOfMonth < 1 || *dayOfMonth > 28 {
			return fmt.Errorf("day_of_month requerido para frecuencia mensual (1–28)")
		}
	}
	if len(metrics) == 0 {
		return fmt.Errorf("debe seleccionarse al menos una métrica")
	}
	allowed := map[model.ReportMetric]bool{
		model.MetricResumen: true, model.MetricTipoEnvio: true, model.MetricMetodoEntrega: true,
		model.MetricVolumenVentana: true, model.MetricTasaExito: true, model.MetricChoferes: true,
		model.MetricFacturacion: true, model.MetricRanking: true, model.MetricRetorno: true,
	}
	for _, m := range metrics {
		if !allowed[m] {
			return fmt.Errorf("métrica inválida: %s", m)
		}
	}
	return nil
}

func isValidTimeOfDay(s string) bool {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return false
	}
	_ = t
	return true
}

// ParseTimeOfDay devuelve hora y minutos de un string "HH:MM" (ya validado).
func ParseTimeOfDay(s string) (int, int) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, 0
	}
	return t.Hour(), t.Minute()
}
