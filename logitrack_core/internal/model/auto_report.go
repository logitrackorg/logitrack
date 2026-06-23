package model

import "time"

// ReportFrequency define la cadencia de generación automática.
type ReportFrequency string

const (
	ReportFrequencyDaily   ReportFrequency = "daily"
	ReportFrequencyWeekly  ReportFrequency = "weekly"
	ReportFrequencyMonthly ReportFrequency = "monthly"
)

// ReportMetric identifica una métrica que puede incluirse en un reporte automático.
type ReportMetric string

const (
	MetricResumen        ReportMetric = "resumen"
	MetricTipoEnvio      ReportMetric = "tipo_envio"
	MetricMetodoEntrega  ReportMetric = "metodo_entrega"
	MetricVolumenVentana ReportMetric = "volumen_ventana"
	MetricTasaExito      ReportMetric = "tasa_exito"
	MetricChoferes       ReportMetric = "choferes"
	MetricFacturacion    ReportMetric = "facturacion"
	MetricRanking        ReportMetric = "ranking"
	MetricRetorno        ReportMetric = "retorno"
)

// AutoReportSchedule es la configuración persistida de un reporte automático.
type AutoReportSchedule struct {
	ID          string          `json:"id"`
	OwnerUserID string          `json:"owner_user_id"`
	Name        string          `json:"name"`
	Frequency   ReportFrequency `json:"frequency"`
	// TimeOfDay en formato "HH:MM" (24h), zona ART.
	TimeOfDay string `json:"time_of_day"`
	// DayOfWeek 0–6 (domingo=0). Solo aplica si Frequency=weekly.
	DayOfWeek *int `json:"day_of_week,omitempty"`
	// DayOfMonth 1–28. Solo aplica si Frequency=monthly. Se limita a 28 para evitar fines de mes irregulares.
	DayOfMonth *int           `json:"day_of_month,omitempty"`
	Metrics    []ReportMetric `json:"metrics"`
	// BranchID vacío = todas las sucursales (manager scope).
	BranchID  string     `json:"branch_id"`
	Email     string     `json:"email"`
	Active    bool       `json:"active"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	LastRunAt *time.Time `json:"last_run_at,omitempty"`
}

// GeneratedReport es el snapshot ejecutado para un schedule en un momento dado.
type GeneratedReport struct {
	ID           string          `json:"id"`
	ScheduleID   string          `json:"schedule_id"`
	ScheduleName string          `json:"schedule_name"`
	Frequency    ReportFrequency `json:"frequency"`
	PeriodFrom   time.Time       `json:"period_from"`
	PeriodTo     time.Time       `json:"period_to"`
	BranchID     string          `json:"branch_id"`
	Email        string          `json:"email"`
	GeneratedAt  time.Time       `json:"generated_at"`
	HasData      bool            `json:"has_data"`
	// Snapshot guarda los KPIs serializados en JSON. Las llaves dependen de las métricas configuradas.
	Snapshot map[string]any `json:"snapshot"`
}

// CreateAutoReportScheduleInput es la entrada para crear un schedule.
type CreateAutoReportScheduleInput struct {
	Name       string          `json:"name"`
	Frequency  ReportFrequency `json:"frequency"`
	TimeOfDay  string          `json:"time_of_day"`
	DayOfWeek  *int            `json:"day_of_week,omitempty"`
	DayOfMonth *int            `json:"day_of_month,omitempty"`
	Metrics    []ReportMetric  `json:"metrics"`
	BranchID   string          `json:"branch_id"`
	Email      string          `json:"email"`
	Active     bool            `json:"active"`
}

// UpdateAutoReportScheduleInput es la entrada para editar un schedule existente.
// Punteros = "no cambiar este campo".
type UpdateAutoReportScheduleInput struct {
	Name       *string          `json:"name,omitempty"`
	Frequency  *ReportFrequency `json:"frequency,omitempty"`
	TimeOfDay  *string          `json:"time_of_day,omitempty"`
	DayOfWeek  *int             `json:"day_of_week,omitempty"`
	DayOfMonth *int             `json:"day_of_month,omitempty"`
	Metrics    *[]ReportMetric  `json:"metrics,omitempty"`
	BranchID   *string          `json:"branch_id,omitempty"`
	Email      *string          `json:"email,omitempty"`
	Active     *bool            `json:"active,omitempty"`
}
