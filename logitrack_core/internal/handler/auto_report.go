package handler

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

// AutoReportHandler expone los endpoints de configuración + lectura de reportes automáticos.
type AutoReportHandler struct {
	svc *service.AutoReportService
}

// NewAutoReportHandler construye el handler.
func NewAutoReportHandler(svc *service.AutoReportService) *AutoReportHandler {
	return &AutoReportHandler{svc: svc}
}

// CreateSchedule registra un nuevo schedule.
func (h *AutoReportHandler) CreateSchedule(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var in model.CreateAutoReportScheduleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	sched, err := h.svc.CreateSchedule(user.ID, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, sched)
}

// UpdateSchedule edita un schedule existente.
func (h *AutoReportHandler) UpdateSchedule(c *gin.Context) {
	id := c.Param("id")
	var in model.UpdateAutoReportScheduleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	sched, err := h.svc.UpdateSchedule(id, in)
	if err != nil {
		if errors.Is(err, repository.ErrAutoReportScheduleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "schedule no encontrado"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sched)
}

// DeleteSchedule borra un schedule.
func (h *AutoReportHandler) DeleteSchedule(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.DeleteSchedule(id); err != nil {
		if errors.Is(err, repository.ErrAutoReportScheduleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "schedule no encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusNoContent, nil)
}

// ListSchedules lista todos los schedules configurados.
func (h *AutoReportHandler) ListSchedules(c *gin.Context) {
	out, err := h.svc.ListSchedules()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"schedules": out})
}

// RunNow dispara la generación manual de un schedule (útil para preview).
func (h *AutoReportHandler) RunNow(c *gin.Context) {
	id := c.Param("id")
	sched, err := h.svc.GetSchedule(id)
	if err != nil {
		if errors.Is(err, repository.ErrAutoReportScheduleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "schedule no encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	gen, err := h.svc.RunSchedule(sched)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gen)
}

// ListGenerated devuelve la lista cronológica de reportes generados.
func (h *AutoReportHandler) ListGenerated(c *gin.Context) {
	limit := 100
	if raw := c.Query("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	out, err := h.svc.ListGenerated(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reports": out})
}

// GetGenerated devuelve el snapshot completo de un reporte (el front lo usa para renderizar PDF).
func (h *AutoReportHandler) GetGenerated(c *gin.Context) {
	id := c.Param("id")
	gen, err := h.svc.GetGenerated(id)
	if err != nil {
		if errors.Is(err, repository.ErrAutoReportScheduleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "reporte no encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gen)
}

// DownloadCSV devuelve el snapshot en formato CSV (abre en Excel sin problemas).
// Cada métrica se exporta como una sección separada con su propio encabezado.
func (h *AutoReportHandler) DownloadCSV(c *gin.Context) {
	id := c.Param("id")
	gen, err := h.svc.GetGenerated(id)
	if err != nil {
		if errors.Is(err, repository.ErrAutoReportScheduleNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "reporte no encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("reporte_%s_%s.csv", safeFilename(gen.ScheduleName), gen.GeneratedAt.Format("2006-01-02"))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	_ = w.Write([]string{"Reporte", gen.ScheduleName})
	_ = w.Write([]string{"Período desde", gen.PeriodFrom.Format("2006-01-02")})
	_ = w.Write([]string{"Período hasta", gen.PeriodTo.Format("2006-01-02")})
	_ = w.Write([]string{"Generado", gen.GeneratedAt.Format("2006-01-02 15:04")})
	_ = w.Write([]string{})

	if !gen.HasData {
		_ = w.Write([]string{"No hay datos disponibles para el período seleccionado"})
		return
	}

	// Recorre el snapshot en orden de claves para que el CSV sea determinístico.
	keys := make([]string, 0, len(gen.Snapshot))
	for k := range gen.Snapshot {
		if k == "period_from" || k == "period_to" || k == "branch_id" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		_ = w.Write([]string{})
		_ = w.Write([]string{metricTitle(k)})
		writeMetricRows(w, k, gen.Snapshot[k])
	}
}

var (
	tipoLabels = map[string]string{
		"express": "Expreso",
		"normal":  "Normal",
	}
	metodoLabels = map[string]string{
		"ultima_milla":    "Última milla",
		"retiro_sucursal": "Retiro en sucursal",
	}
	ventanaLabels = map[string]string{
		"morning":   "Mañana",
		"afternoon": "Tarde",
		"flexible":  "Flexible",
	}
	metricTitles = map[string]string{
		"resumen":         "Resumen",
		"tipo_envio":      "Distribución por tipo de envío",
		"metodo_entrega":  "Distribución por método de entrega",
		"volumen_ventana": "Volumen por ventana horaria",
		"tasa_exito":      "Tasa de éxito por sucursal",
		"choferes":        "Performance de choferes",
		"facturacion":     "Facturación",
		"ranking":         "Ranking de sucursales",
		"retorno":         "Métricas de retorno",
	}
)

func metricTitle(k string) string {
	if t, ok := metricTitles[k]; ok {
		return t
	}
	return strings.Title(strings.ReplaceAll(k, "_", " "))
}

func writeMetricRows(w *csv.Writer, metricKey string, raw any) {
	if raw == nil {
		return
	}
	switch metricKey {
	case "tipo_envio":
		writeBucketsMetric(w, raw, "shipment_type", "Tipo", tipoLabels)
	case "metodo_entrega":
		writeBucketsMetric(w, raw, "delivery_method", "Método", metodoLabels)
	case "volumen_ventana":
		writeBucketsMetric(w, raw, "time_window", "Ventana horaria", ventanaLabels)
	case "tasa_exito":
		writeTasaExito(w, raw)
	case "choferes":
		writeChoferes(w, raw)
	case "facturacion":
		writeFacturacion(w, raw)
	case "ranking":
		writeRanking(w, raw)
	case "retorno":
		writeRetorno(w, raw)
	case "resumen":
		writeResumen(w, raw)
	default:
		writeGeneric(w, raw)
	}
}

// -----------------------------------------------------------------------------
// Formatters por métrica — todos asumen el shape devuelto por StatsExtendedService
// serializado vía JSON: structs anidados se vuelven map[string]any, slices []any,
// y los enteros/floats float64.
// -----------------------------------------------------------------------------

func writeBucketsMetric(w *csv.Writer, raw any, fieldKey, label string, labels map[string]string) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	total := getInt(m, "total")
	_ = w.Write([]string{"Total", strconv.Itoa(total)})
	_ = w.Write([]string{})
	_ = w.Write([]string{label, "Cantidad", "Porcentaje"})
	for _, b := range getSlice(m, "buckets") {
		bm, ok := b.(map[string]any)
		if !ok {
			continue
		}
		key := getString(bm, fieldKey)
		count := getInt(bm, "count")
		name := labels[key]
		if name == "" {
			name = key
		}
		pct := "—"
		if total > 0 {
			pct = formatPct(float64(count) / float64(total) * 100)
		}
		_ = w.Write([]string{name, strconv.Itoa(count), pct})
	}
}

func writeTasaExito(w *csv.Writer, raw any) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	_ = w.Write([]string{"Sucursal", "Total", "Entregadas", "Fallidas", "Éxito"})
	for _, b := range getSlice(m, "branches") {
		bm, ok := b.(map[string]any)
		if !ok {
			continue
		}
		_ = w.Write([]string{
			getString(bm, "branch_name"),
			strconv.Itoa(getInt(bm, "total")),
			strconv.Itoa(getInt(bm, "delivered")),
			strconv.Itoa(getInt(bm, "failed")),
			formatPct(getFloat(bm, "success_rate")),
		})
	}
}

func writeChoferes(w *csv.Writer, raw any) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	_ = w.Write([]string{"Chofer", "Sucursal", "Asignados", "Entregados", "Fallidos", "Éxito", "Prom. (h)"})
	for _, d := range getSlice(m, "drivers") {
		dm, ok := d.(map[string]any)
		if !ok {
			continue
		}
		successRate := "—"
		if v, ok := dm["success_rate"].(float64); ok {
			successRate = formatPct(v)
		}
		avgHours := "—"
		if v, ok := dm["avg_delivery_hours"].(float64); ok {
			avgHours = strconv.FormatFloat(v, 'f', 1, 64)
		}
		_ = w.Write([]string{
			getString(dm, "driver_name"),
			getString(dm, "branch_name"),
			strconv.Itoa(getInt(dm, "total_assigned")),
			strconv.Itoa(getInt(dm, "delivered")),
			strconv.Itoa(getInt(dm, "delivery_failed")),
			successRate,
			avgHours,
		})
	}
}

func writeFacturacion(w *csv.Writer, raw any) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	currency := getString(m, "currency")
	if currency == "" {
		currency = "ARS"
	}
	_ = w.Write([]string{"Facturación total", currency + " " + formatMoney(getFloat(m, "total_revenue"))})
	_ = w.Write([]string{"Envíos facturados", strconv.Itoa(getInt(m, "count"))})
	avg := "—"
	if v, ok := m["avg_ticket"].(float64); ok {
		avg = currency + " " + formatMoney(v)
	}
	_ = w.Write([]string{"Ticket promedio", avg})

	byBranch := getMap(m, "by_branch")
	if len(byBranch) > 0 {
		_ = w.Write([]string{})
		_ = w.Write([]string{"Por sucursal"})
		_ = w.Write([]string{"Sucursal", "Facturación", "Envíos", "Ticket promedio"})
		for _, key := range keysSorted(byBranch) {
			bm, ok := byBranch[key].(map[string]any)
			if !ok {
				continue
			}
			_ = w.Write([]string{
				key,
				currency + " " + formatMoney(getFloat(bm, "revenue")),
				strconv.Itoa(getInt(bm, "count")),
				currency + " " + formatMoney(getFloat(bm, "avg_ticket")),
			})
		}
	}

	byPeriod := getMap(m, "by_period")
	if len(byPeriod) > 0 {
		_ = w.Write([]string{})
		_ = w.Write([]string{"Por período"})
		_ = w.Write([]string{"Período", "Facturación"})
		for _, key := range keysSorted(byPeriod) {
			rev, _ := byPeriod[key].(float64)
			_ = w.Write([]string{key, currency + " " + formatMoney(rev)})
		}
	}
}

func writeRanking(w *csv.Writer, raw any) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	_ = w.Write([]string{"#", "Sucursal", "Volumen", "Entregadas", "Éxito"})
	for _, r := range getSlice(m, "ranking") {
		rm, ok := r.(map[string]any)
		if !ok {
			continue
		}
		successRate := "—"
		if v, ok := rm["success_rate"].(float64); ok {
			successRate = formatPct(v)
		}
		_ = w.Write([]string{
			strconv.Itoa(getInt(rm, "rank")),
			getString(rm, "branch_name"),
			strconv.Itoa(getInt(rm, "volume_confirmed")),
			strconv.Itoa(getInt(rm, "delivered")),
			successRate,
		})
	}
}

func writeRetorno(w *csv.Writer, raw any) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	_ = w.Write([]string{"Devueltos", strconv.Itoa(getInt(m, "total_returned"))})
	_ = w.Write([]string{"Listos para devolución", strconv.Itoa(getInt(m, "total_ready_for_return"))})
	_ = w.Write([]string{"Elegibles para devolución", strconv.Itoa(getInt(m, "total_return_eligible"))})
	rate := "—"
	if v, ok := m["return_rate"].(float64); ok {
		rate = formatPct(v)
	}
	_ = w.Write([]string{"Tasa de devolución", rate})

	byBranch := getMap(m, "by_branch")
	if len(byBranch) > 0 {
		_ = w.Write([]string{})
		_ = w.Write([]string{"Por sucursal"})
		_ = w.Write([]string{"Sucursal", "Devueltos", "Listos", "Total"})
		for _, key := range keysSorted(byBranch) {
			bm, ok := byBranch[key].(map[string]any)
			if !ok {
				continue
			}
			_ = w.Write([]string{
				key,
				strconv.Itoa(getInt(bm, "returned")),
				strconv.Itoa(getInt(bm, "ready_for_return")),
				strconv.Itoa(getInt(bm, "total")),
			})
		}
	}

	byDay := getMap(m, "by_day")
	if len(byDay) > 0 {
		_ = w.Write([]string{})
		_ = w.Write([]string{"Por día"})
		_ = w.Write([]string{"Fecha", "Devueltos"})
		for _, key := range keysSorted(byDay) {
			count := getIntFromAny(byDay[key])
			_ = w.Write([]string{key, strconv.Itoa(count)})
		}
	}
}

func writeResumen(w *csv.Writer, raw any) {
	m, ok := raw.(map[string]any)
	if !ok {
		writeGeneric(w, raw)
		return
	}
	_ = w.Write([]string{"Total de envíos", strconv.Itoa(getInt(m, "total_envios"))})

	if porTipo := getSlice(m, "por_tipo"); len(porTipo) > 0 {
		_ = w.Write([]string{})
		_ = w.Write([]string{"Por tipo"})
		_ = w.Write([]string{"Tipo", "Cantidad"})
		for _, b := range porTipo {
			bm, ok := b.(map[string]any)
			if !ok {
				continue
			}
			key := getString(bm, "shipment_type")
			name := tipoLabels[key]
			if name == "" {
				name = key
			}
			_ = w.Write([]string{name, strconv.Itoa(getInt(bm, "count"))})
		}
	}

	if porVentana := getSlice(m, "por_ventana"); len(porVentana) > 0 {
		_ = w.Write([]string{})
		_ = w.Write([]string{"Por ventana horaria"})
		_ = w.Write([]string{"Ventana", "Cantidad"})
		for _, b := range porVentana {
			bm, ok := b.(map[string]any)
			if !ok {
				continue
			}
			key := getString(bm, "time_window")
			name := ventanaLabels[key]
			if name == "" {
				name = key
			}
			_ = w.Write([]string{name, strconv.Itoa(getInt(bm, "count"))})
		}
	}
}

// writeGeneric es el fallback para snapshots con un shape desconocido —
// aplana recursivamente clave=valor para que nunca se filtre un "map[...]" crudo.
func writeGeneric(w *csv.Writer, raw any) {
	rows := [][]string{}
	flatten("", raw, &rows)
	for _, r := range rows {
		_ = w.Write(r)
	}
}

func flatten(prefix string, v any, rows *[][]string) {
	switch val := v.(type) {
	case map[string]any:
		for _, k := range keysSorted(val) {
			next := k
			if prefix != "" {
				next = prefix + "." + k
			}
			flatten(next, val[k], rows)
		}
	case []any:
		for i, item := range val {
			next := strconv.Itoa(i)
			if prefix != "" {
				next = prefix + "[" + next + "]"
			}
			flatten(next, item, rows)
		}
	default:
		*rows = append(*rows, []string{prefix, fmt.Sprintf("%v", val)})
	}
}

// -----------------------------------------------------------------------------
// Helpers de extracción para map[string]any deserializado de JSON.
// JSON numbers siempre llegan como float64 en Go default.
// -----------------------------------------------------------------------------

func getString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getFloat(m map[string]any, key string) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return 0
}

func getInt(m map[string]any, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

func getIntFromAny(v any) int {
	if f, ok := v.(float64); ok {
		return int(f)
	}
	return 0
}

func getMap(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return nil
}

func getSlice(m map[string]any, key string) []any {
	if v, ok := m[key].([]any); ok {
		return v
	}
	return nil
}

func formatPct(v float64) string {
	return strconv.FormatFloat(v, 'f', 1, 64) + "%"
}

func formatMoney(v float64) string {
	return strconv.FormatFloat(v, 'f', 2, 64)
}

func keysSorted(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func safeFilename(s string) string {
	out := []rune{}
	for _, r := range s {
		if r == ' ' {
			out = append(out, '_')
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return "reporte"
	}
	return string(out)
}
