package model

import "time"

// KnownMetric describes a controllable dashboard metric.
type KnownMetric struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// AllMetrics is the ordered, authoritative list of metric IDs managed by
// the permission system. IDs match the tab IDs in DashboardHost.tsx.
// Both the migration seed and the PATCH validator derive the valid set from this slice.
var AllMetrics = []KnownMetric{
	{ID: "resumen",        Label: "Resumen"},
	{ID: "choferes",       Label: "Choferes"},
	{ID: "reclamos",       Label: "Reclamos"},
	{ID: "facturacion",    Label: "Facturación"},
	{ID: "ranking",        Label: "Ranking"},
	{ID: "volumen",        Label: "Vol. por Ventana"},
	{ID: "tipo-envio",     Label: "Tipo de Envío"},
	{ID: "metodo-entrega", Label: "Método de Entrega"},
	{ID: "retorno",        Label: "Retorno"},
	{ID: "exito",          Label: "Tasa de Éxito"},
	{ID: "fatiga",         Label: "Fatiga"},
	{ID: "sla",            Label: "SLA"},
	{ID: "empleado-mes",   Label: "Empleado del Mes"},
}

// MetricPermission stores whether a role can see a specific metric.
type MetricPermission struct {
	RoleName  string `json:"role_name"`
	MetricID  string `json:"metric_id"`
	IsVisible bool   `json:"is_visible"`
}

// MetricPermissionsMatrix is the full admin view: all roles × all metrics.
type MetricPermissionsMatrix struct {
	Metrics []KnownMetric              `json:"metrics"`
	Roles   []string                   `json:"roles"`
	Matrix  map[string]map[string]bool `json:"matrix"`
}

// PermissionChange is a single pending change in a batch update.
type PermissionChange struct {
	RoleName  string `json:"role_name"`
	MetricID  string `json:"metric_id"`
	IsVisible bool   `json:"is_visible"`
}

// UserMetricOverride is a per-user exception that overrides the role-level permission.
type UserMetricOverride struct {
	UserID    string `json:"user_id"`
	MetricID  string `json:"metric_id"`
	IsVisible bool   `json:"is_visible"`
}

// PermissionAuditLog records a single permission change event.
type PermissionAuditLog struct {
	ID            string    `json:"id"`
	CreatedAt     time.Time `json:"created_at"`
	AdminUserID   string    `json:"admin_user_id"`
	AdminUsername string    `json:"admin_username"`
	BatchID       string    `json:"batch_id"`
	AffectedRole  string    `json:"affected_role"`
	MetricID      string    `json:"metric_id"`
	MetricName    string    `json:"metric_name"`
	Action        string    `json:"action"`
	PreviousState bool      `json:"previous_state"`
	NewState      bool      `json:"new_state"`
}
