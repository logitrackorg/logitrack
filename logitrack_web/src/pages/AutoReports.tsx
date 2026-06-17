import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileBarChart, Plus, Pencil, Trash2, Play, Download, FileText, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import { autoReportsApi, type AutoReportSchedule, type GeneratedReport, type ReportFrequency, type ReportMetric, type CreateAutoReportScheduleInput } from "../api/autoReports";
import { branchApi, type Branch } from "../api/branches";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";
import { SelectMenu } from "../components/ui/SelectMenu";
import { toast } from "../utils/toast";
import { fmtDateTime } from "../utils/date";

const FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
};

const METRIC_LABELS: Record<ReportMetric, string> = {
  resumen: "Resumen",
  tipo_envio: "Distribución por tipo de envío",
  metodo_entrega: "Distribución por método de entrega",
  volumen_ventana: "Volumen por ventana horaria",
  tasa_exito: "Tasa de éxito",
  choferes: "Performance de choferes",
  facturacion: "Facturación",
  ranking: "Ranking de sucursales",
  retorno: "Métricas de retorno",
};

const ALL_METRICS: ReportMetric[] = [
  "resumen",
  "tipo_envio",
  "metodo_entrega",
  "volumen_ventana",
  "tasa_exito",
  "choferes",
  "facturacion",
  "ranking",
  "retorno",
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

type Tab = "config" | "generados";

export function AutoReports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: Tab = tabParam === "config" ? "config" : "generados";
  const setTab = (t: Tab) => setSearchParams({ tab: t });

  const [schedules, setSchedules] = useState<AutoReportSchedule[]>([]);
  const [generated, setGenerated] = useState<GeneratedReport[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AutoReportSchedule | null>(null);
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, g, b] = await Promise.all([
        autoReportsApi.listSchedules(),
        autoReportsApi.listGenerated(100),
        branchApi.list("activo"),
      ]);
      setSchedules(s);
      setGenerated(g);
      setBranches(b);
    } catch {
      toast.error("No se pudo cargar la información");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este reporte automático?")) return;
    try {
      await autoReportsApi.deleteSchedule(id);
      toast.success("Reporte eliminado");
      loadAll();
    } catch {
      toast.error("No se pudo eliminar el reporte");
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      await autoReportsApi.runNow(id);
      toast.success("Reporte generado");
      loadAll();
    } catch {
      toast.error("No se pudo generar el reporte");
    }
  };

  const handleDownloadCSV = (g: GeneratedReport) => {
    const url = autoReportsApi.downloadCsvUrl(g.id);
    const token = localStorage.getItem("token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = `${g.schedule_name.replace(/\s+/g, "_")}_${g.generated_at.slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      })
      .catch(() => toast.error("Error al descargar CSV"));
  };

  const handleDownloadPDF = (g: GeneratedReport) => {
    const filename = `${g.schedule_name.replace(/\s+/g, "_")}_${g.generated_at.slice(0, 10)}.pdf`;
    exportReportToPDF(g, branches, filename);
  };

  return (
    <div className="min-h-screen dark:bg-gray-800/50 bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader
          icon={<FileBarChart className="h-6 w-6" />}
          title="Reportes automáticos"
          description="Configurá reportes periódicos que se generan y notifican automáticamente"
        />

        <div className="flex gap-1 border-b dark:border-gray-700 border-slate-200">
          <TabBtn active={activeTab === "generados"} onClick={() => setTab("generados")}>
            Reportes generados
          </TabBtn>
          <TabBtn active={activeTab === "config"} onClick={() => setTab("config")}>
            Configuración
          </TabBtn>
        </div>

        {activeTab === "config" && (
          <ConfigTab
            schedules={schedules}
            branches={branches}
            loading={loading}
            onCreate={() => setCreating(true)}
            onEdit={setEditing}
            onDelete={handleDelete}
            onRunNow={handleRunNow}
          />
        )}

        {activeTab === "generados" && (
          <GeneratedTab
            reports={generated}
            branches={branches}
            loading={loading}
            onDownloadCSV={handleDownloadCSV}
            onDownloadPDF={handleDownloadPDF}
          />
        )}

        {(creating || editing) && (
          <ScheduleModal
            existing={editing}
            branches={branches}
            onClose={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSaved={() => {
              setCreating(false);
              setEditing(null);
              loadAll();
            }}
          />
        )}
      </div>

    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 text-sm border-b-2 transition-colors cursor-pointer ${
        active ? "border-[var(--brand)] text-[var(--brand)] font-semibold" : "border-transparent dark:text-gray-400 text-slate-500 dark:hover:text-gray-100 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

interface ConfigTabProps {
  schedules: AutoReportSchedule[];
  branches: Branch[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (s: AutoReportSchedule) => void;
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
}

function ConfigTab({ schedules, branches, loading, onCreate, onEdit, onDelete, onRunNow }: ConfigTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 bg-[var(--brand)] text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-[var(--brand-strong)] transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Nuevo reporte
        </button>
      </div>

      {loading ? (
        <Card className="p-10 text-center dark:text-gray-400 text-slate-500 text-sm">Cargando…</Card>
      ) : schedules.length === 0 ? (
        <Card className="p-10 text-center">
          <FileBarChart className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm dark:text-gray-400 text-slate-500">No hay reportes automáticos configurados</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="dark:bg-gray-800/50 bg-slate-50 text-left border-b dark:border-gray-700 border-slate-100">
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Nombre</th>
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Frecuencia</th>
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Hora</th>
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Sucursal</th>
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Métricas</th>
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b dark:border-gray-700 border-slate-100 dark:hover:bg-gray-700 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium dark:text-gray-100 text-slate-900">{s.name}</td>
                    <td className="px-4 py-3 dark:text-gray-300 text-slate-700">{describeFrequency(s)}</td>
                    <td className="px-4 py-3 dark:text-gray-300 text-slate-700 tabular-nums">{s.time_of_day}</td>
                    <td className="px-4 py-3 dark:text-gray-300 text-slate-700">
                      {s.branch_id ? branches.find((b) => b.id === s.branch_id)?.name ?? s.branch_id : "Todas"}
                    </td>
                    <td className="px-4 py-3 dark:text-gray-400 text-slate-600 text-xs">{s.metrics.length} seleccionadas</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          s.active ? "bg-emerald-50 text-emerald-700" : "dark:bg-gray-700/50 bg-slate-100 dark:text-gray-400 text-slate-500"
                        }`}
                      >
                        {s.active ? "Activo" : "Pausado"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => onRunNow(s.id)}
                          title="Generar ahora"
                          className="p-1.5 dark:text-gray-400 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onEdit(s)}
                          title="Editar"
                          className="p-1.5 dark:text-gray-400 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDelete(s.id)}
                          title="Eliminar"
                          className="p-1.5 dark:text-gray-400 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function describeFrequency(s: AutoReportSchedule): string {
  switch (s.frequency) {
    case "daily":
      return "Diaria";
    case "weekly":
      return `Semanal (${DAYS_OF_WEEK.find((d) => d.value === s.day_of_week)?.label ?? "—"})`;
    case "monthly":
      return `Mensual (día ${s.day_of_month ?? "—"})`;
  }
}

interface GeneratedTabProps {
  reports: GeneratedReport[];
  branches: Branch[];
  loading: boolean;
  onDownloadCSV: (r: GeneratedReport) => void;
  onDownloadPDF: (r: GeneratedReport) => void;
}

function GeneratedTab({ reports, branches, loading, onDownloadCSV, onDownloadPDF }: GeneratedTabProps) {
  if (loading) return <Card className="p-10 text-center dark:text-gray-400 text-slate-500 text-sm">Cargando…</Card>;
  if (reports.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Download className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm dark:text-gray-400 text-slate-500">Todavía no hay reportes generados</p>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="dark:bg-gray-800/50 bg-slate-50 text-left border-b dark:border-gray-700 border-slate-100">
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Reporte</th>
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Frecuencia</th>
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Período</th>
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Sucursal</th>
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Generado</th>
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Datos</th>
              <th className="px-4 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider text-right">Descargar</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-b dark:border-gray-700 border-slate-100 dark:hover:bg-gray-700 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium dark:text-gray-100 text-slate-900">{r.schedule_name}</td>
                <td className="px-4 py-3 dark:text-gray-300 text-slate-700">{FREQUENCY_LABELS[r.frequency]}</td>
                <td className="px-4 py-3 dark:text-gray-400 text-slate-600 text-xs tabular-nums">
                  {r.period_from.slice(0, 10)} → {r.period_to.slice(0, 10)}
                </td>
                <td className="px-4 py-3 dark:text-gray-300 text-slate-700">
                  {r.branch_id ? branches.find((b) => b.id === r.branch_id)?.name ?? r.branch_id : "Todas"}
                </td>
                <td className="px-4 py-3 dark:text-gray-400 text-slate-600 text-xs">{fmtDateTime(r.generated_at)}</td>
                <td className="px-4 py-3">
                  {r.has_data ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                      Con datos
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold dark:bg-gray-700/50 bg-slate-100 dark:text-gray-400 text-slate-500">
                      Sin datos
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => onDownloadPDF(r)}
                      title="Descargar PDF"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" /> PDF
                    </button>
                    <button
                      onClick={() => onDownloadCSV(r)}
                      title="Descargar CSV"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface ModalProps {
  existing: AutoReportSchedule | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}

function ScheduleModal({ existing, branches, onClose, onSaved }: ModalProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [frequency, setFrequency] = useState<ReportFrequency>(existing?.frequency ?? "daily");
  const [timeOfDay, setTimeOfDay] = useState(existing?.time_of_day ?? "08:00");
  const [dayOfWeek, setDayOfWeek] = useState<number>(existing?.day_of_week ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(existing?.day_of_month ?? 1);
  const [metrics, setMetrics] = useState<ReportMetric[]>(existing?.metrics ?? ["resumen"]);
  const [branchId, setBranchId] = useState(existing?.branch_id ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [saving, setSaving] = useState(false);

  const toggleMetric = (m: ReportMetric) => {
    setMetrics((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const isValidEmail = useMemo(() => {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }, [email]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Ingresá un nombre");
      return;
    }
    if (metrics.length === 0) {
      toast.error("Seleccioná al menos una métrica");
      return;
    }
    if (!isValidEmail) {
      toast.error("El email no tiene un formato válido");
      return;
    }
    setSaving(true);
    try {
      const payload: CreateAutoReportScheduleInput = {
        name: name.trim(),
        frequency,
        time_of_day: timeOfDay,
        day_of_week: frequency === "weekly" ? dayOfWeek : undefined,
        day_of_month: frequency === "monthly" ? dayOfMonth : undefined,
        metrics,
        branch_id: branchId,
        email: email.trim(),
        active,
      };
      if (existing) {
        await autoReportsApi.updateSchedule(existing.id, payload);
        toast.success("Reporte actualizado");
      } else {
        await autoReportsApi.createSchedule(payload);
        toast.success("Reporte creado");
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? "No se pudo guardar el reporte");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="dark:bg-gray-800 bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b dark:border-gray-700 border-slate-200">
          <h2 className="text-lg font-semibold dark:text-gray-100 text-slate-900">
            {existing ? "Editar reporte automático" : "Nuevo reporte automático"}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border dark:border-gray-600 border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50 focus:border-[var(--brand)]"
              placeholder="Reporte ejecutivo semanal"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Frecuencia</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
                className="w-full border dark:border-gray-600 border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
              >
                <option value="daily">Diaria</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Hora (24h)</label>
              <input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-full border dark:border-gray-600 border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
              />
            </div>

            {frequency === "weekly" && (
              <div>
                <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Día de la semana</label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full border dark:border-gray-600 border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                >
                  {DAYS_OF_WEEK.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {frequency === "monthly" && (
              <div>
                <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Día del mes (1–28)</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value))))}
                  className="w-full border dark:border-gray-600 border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/50"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Sucursal</label>
              <SelectMenu
                value={branchId}
                onChange={setBranchId}
                placeholder="Todas las sucursales"
                ariaLabel="Sucursal"
                className="w-full"
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-1">Email destino (opcional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="gerencia@empresa.com"
                className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                  isValidEmail
                    ? "dark:border-gray-600 border-slate-300 focus:ring-[var(--brand)]/50 focus:border-[var(--brand)]"
                    : "border-red-400 focus:ring-red-500/50"
                }`}
              />
              <p className="text-xs dark:text-gray-500 text-slate-400 mt-1">
                Solo se guarda como referencia. Las notificaciones llegan in-app.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium dark:text-gray-300 text-slate-700 mb-2">Métricas a incluir</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_METRICS.map((m) => (
                <label
                  key={m}
                  className="flex items-center gap-2 px-3 py-2 border dark:border-gray-700 border-slate-200 rounded-md dark:hover:bg-gray-700 hover:bg-slate-50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={metrics.includes(m)}
                    onChange={() => toggleMetric(m)}
                    className="rounded dark:border-gray-600 border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]/50"
                  />
                  <span>{METRIC_LABELS[m]}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded dark:border-gray-600 border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]/50"
            />
            <span>Activo (el scheduler lo va a ejecutar)</span>
          </label>
        </div>

        <div className="p-5 border-t dark:border-gray-700 border-slate-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700 hover:bg-slate-100 rounded-md cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[var(--brand)] text-white text-sm font-semibold rounded-md hover:bg-[var(--brand-strong)] cursor-pointer disabled:opacity-50"
          >
            {saving ? "Guardando…" : existing ? "Guardar cambios" : "Crear reporte"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// PDF nativo con jsPDF — renderiza texto/líneas/rects directamente, sin
// capturar imágenes. Esto permite repetir títulos de sección + encabezado de
// tabla en cada página de continuación y cortar siempre entre filas.
// ============================================================================

const TIPO_LABELS: Record<string, string> = { express: "Expreso", normal: "Normal" };
const METODO_LABELS: Record<string, string> = {
  ultima_milla: "Última milla",
  retiro_sucursal: "Retiro en sucursal",
};
const VENTANA_LABELS: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  flexible: "Flexible",
};
const METRIC_LABELS_PDF: Record<string, string> = {
  resumen: "Resumen",
  tipo_envio: "Distribución por tipo de envío",
  metodo_entrega: "Distribución por método de entrega",
  volumen_ventana: "Volumen por ventana horaria",
  tasa_exito: "Tasa de éxito por sucursal",
  choferes: "Performance de choferes",
  facturacion: "Facturación",
  ranking: "Ranking de sucursales",
  retorno: "Métricas de retorno",
};
const METRIC_ACCENT_RGB: Record<string, [number, number, number]> = {
  resumen: [30, 58, 95],
  tipo_envio: [245, 158, 11],
  metodo_entrega: [37, 99, 235],
  volumen_ventana: [139, 92, 246],
  tasa_exito: [16, 185, 129],
  choferes: [6, 182, 212],
  facturacion: [22, 163, 74],
  ranking: [234, 179, 8],
  retorno: [239, 68, 68],
};

const FREQUENCY_LABELS_PDF: Record<ReportFrequency, string> = {
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
};

const PAGE_MARGIN = 12;
const SECTION_GAP = 4;
const TABLE_ROW_H = 6;
const TABLE_HEADER_H = 7;
const TITLE_BAR_H = 9;
const KPI_CARD_H = 14;

function exportReportToPDF(report: GeneratedReport, branches: Branch[], filename: string) {
  try {
    toast.success("Generando PDF…");
    const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? id;

    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const usableW = pageW - PAGE_MARGIN * 2;

    let y = drawHeader(pdf, report, branches, pageW);

    if (!report.has_data) {
      pdf.setFontSize(11);
      pdf.setTextColor(100, 116, 139);
      pdf.text("No hay datos disponibles para el período seleccionado", pageW / 2, y + 30, { align: "center" });
      drawFooter(pdf, pageW, pageH);
      pdf.save(filename);
      return;
    }

    const skip = new Set(["period_from", "period_to", "branch_id"]);
    const entries = Object.entries(report.snapshot).filter(([k]) => !skip.has(k));

    for (const [key, value] of entries) {
      y = ensureSpace(pdf, y, TITLE_BAR_H + 10, pageH);
      y = drawMetricSection(pdf, key, value, branchName, y, PAGE_MARGIN, usableW, pageH);
      y += SECTION_GAP;
    }

    drawFooter(pdf, pageW, pageH);
    pdf.save(filename);
  } catch (e) {
    console.error("Error exporting PDF:", e);
    toast.error("Error al exportar PDF. Revisá la consola para más detalles.");
  }
}

function drawHeader(pdf: jsPDF, report: GeneratedReport, branches: Branch[], pageW: number): number {
  const headerH = 36;
  pdf.setFillColor(30, 58, 95);
  pdf.rect(0, 0, pageW, headerH, "F");
  pdf.setFillColor(37, 99, 235);
  pdf.rect(0, headerH - 4, pageW, 4, "F");

  pdf.setFontSize(8);
  pdf.setTextColor(200, 215, 240);
  pdf.text("REPORTE AUTOMÁTICO · LOGITRACK", PAGE_MARGIN, 10);

  pdf.setFontSize(18);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(255, 255, 255);
  pdf.text(report.schedule_name, PAGE_MARGIN, 19);

  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(200, 215, 240);
  pdf.text("Generado", pageW - PAGE_MARGIN, 10, { align: "right" });
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(255, 255, 255);
  pdf.text(fmtDateTime(report.generated_at), pageW - PAGE_MARGIN, 14.5, { align: "right" });

  const branchName = report.branch_id
    ? branches.find((b) => b.id === report.branch_id)?.name ?? report.branch_id
    : "Todas las sucursales";
  const period = `${report.period_from.slice(0, 10)} → ${report.period_to.slice(0, 10)}`;
  const meta = [
    `Período: ${period}`,
    `Sucursal: ${branchName}`,
    `Frecuencia: ${FREQUENCY_LABELS_PDF[report.frequency]}`,
  ];
  pdf.setFontSize(8.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(220, 230, 250);
  let cx = PAGE_MARGIN;
  for (const m of meta) {
    pdf.text(m, cx, 28);
    cx += pdf.getTextWidth(m) + 8;
  }

  return headerH + 6;
}

function drawFooter(pdf: jsPDF, pageW: number, pageH: number) {
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(226, 232, 240);
    pdf.line(PAGE_MARGIN, pageH - 8, pageW - PAGE_MARGIN, pageH - 8);
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184);
    pdf.text("LogiTrack · Reporte generado automáticamente", PAGE_MARGIN, pageH - 4);
    pdf.text(`Página ${i} / ${total}`, pageW - PAGE_MARGIN, pageH - 4, { align: "right" });
  }
}

function ensureSpace(pdf: jsPDF, y: number, needed: number, pageH: number): number {
  if (y + needed > pageH - PAGE_MARGIN - 10) {
    pdf.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

function drawSectionTitle(
  pdf: jsPDF,
  title: string,
  y: number,
  x: number,
  width: number,
  accent: [number, number, number],
  continuation = false,
): number {
  pdf.setFillColor(250, 251, 252);
  pdf.rect(x, y, width, TITLE_BAR_H, "F");
  pdf.setFillColor(accent[0], accent[1], accent[2]);
  pdf.rect(x, y, 1.6, TITLE_BAR_H, "F");
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(15, 23, 42);
  pdf.text(continuation ? `${title} (cont.)` : title, x + 4, y + 6);
  return y + TITLE_BAR_H + 2;
}

function drawMetricSection(
  pdf: jsPDF,
  key: string,
  value: unknown,
  branchName: (id: string) => string,
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const title = METRIC_LABELS_PDF[key] ?? key;
  const accent = METRIC_ACCENT_RGB[key] ?? [37, 99, 235];

  y = drawSectionTitle(pdf, title, y, x, width, accent);

  if (value == null || typeof value !== "object") {
    pdf.setFontSize(9);
    pdf.setTextColor(148, 163, 184);
    pdf.text("Sin datos para esta métrica", x, y + 4);
    return y + 8;
  }

  switch (key) {
    case "tipo_envio":
      return drawBuckets(pdf, value, "shipment_type", "Tipo", TIPO_LABELS, title, accent, y, x, width, pageH);
    case "metodo_entrega":
      return drawBuckets(pdf, value, "delivery_method", "Método", METODO_LABELS, title, accent, y, x, width, pageH);
    case "volumen_ventana":
      return drawBuckets(pdf, value, "time_window", "Ventana horaria", VENTANA_LABELS, title, accent, y, x, width, pageH);
    case "tasa_exito":
      return drawTasaExito(pdf, value, title, accent, y, x, width, pageH);
    case "choferes":
      return drawChoferes(pdf, value, title, accent, y, x, width, pageH);
    case "facturacion":
      return drawFacturacion(pdf, value, branchName, title, accent, y, x, width, pageH);
    case "ranking":
      return drawRanking(pdf, value, title, accent, y, x, width, pageH);
    case "retorno":
      return drawRetorno(pdf, value, branchName, title, accent, y, x, width, pageH);
    case "resumen":
      return drawResumen(pdf, value, title, accent, y, x, width, pageH);
    default:
      return drawGenericKV(pdf, value, title, accent, y, x, width, pageH);
  }
}

function drawTable(
  pdf: jsPDF,
  headers: string[],
  rows: string[][],
  opts: {
    x: number;
    y: number;
    width: number;
    pageH: number;
    aligns?: ("left" | "right" | "center")[];
    columnWidths?: number[];
    sectionTitle: string;
    accent: [number, number, number];
  },
): number {
  const { x, width, pageH, sectionTitle, accent } = opts;
  let y = opts.y;
  const numCols = headers.length;
  const colW = opts.columnWidths ?? new Array(numCols).fill(width / numCols);
  const aligns = opts.aligns ?? new Array<"left" | "right" | "center">(numCols).fill("left");

  const drawHeaderRow = (atY: number): number => {
    pdf.setFillColor(241, 245, 249);
    pdf.rect(x, atY, width, TABLE_HEADER_H, "F");
    pdf.setDrawColor(226, 232, 240);
    pdf.line(x, atY + TABLE_HEADER_H, x + width, atY + TABLE_HEADER_H);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    let cx = x;
    for (let i = 0; i < numCols; i++) {
      const padX = 2;
      let tx = cx + padX;
      let align: "left" | "right" | "center" = "left";
      if (aligns[i] === "right") {
        tx = cx + colW[i] - padX;
        align = "right";
      } else if (aligns[i] === "center") {
        tx = cx + colW[i] / 2;
        align = "center";
      }
      pdf.text(headers[i], tx, atY + TABLE_HEADER_H - 2.5, { align });
      cx += colW[i];
    }
    return atY + TABLE_HEADER_H;
  };

  y = drawHeaderRow(y);

  for (let i = 0; i < rows.length; i++) {
    if (y + TABLE_ROW_H > pageH - PAGE_MARGIN - 10) {
      pdf.addPage();
      y = PAGE_MARGIN;
      y = drawSectionTitle(pdf, sectionTitle, y, x, width, accent, true);
      y = drawHeaderRow(y);
    }
    const row = rows[i];
    if (i % 2 === 1) {
      pdf.setFillColor(250, 251, 252);
      pdf.rect(x, y, width, TABLE_ROW_H, "F");
    }
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(15, 23, 42);
    let cx = x;
    for (let j = 0; j < numCols; j++) {
      const padX = 2;
      let tx = cx + padX;
      let align: "left" | "right" | "center" = "left";
      if (aligns[j] === "right") {
        tx = cx + colW[j] - padX;
        align = "right";
      } else if (aligns[j] === "center") {
        tx = cx + colW[j] / 2;
        align = "center";
      }
      const txt = truncate(pdf, String(row[j] ?? ""), colW[j] - padX * 2);
      pdf.text(txt, tx, y + TABLE_ROW_H - 2, { align });
      cx += colW[j];
    }
    y += TABLE_ROW_H;
  }

  pdf.setDrawColor(226, 232, 240);
  pdf.line(x, y, x + width, y);

  return y;
}

function truncate(pdf: jsPDF, text: string, maxWidth: number): string {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && pdf.getTextWidth(out + "…") > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
}

function drawKpiRow(
  pdf: jsPDF,
  items: { label: string; value: string; color: [number, number, number] }[],
  y: number,
  x: number,
  width: number,
): number {
  const gap = 3;
  const cardW = (width - gap * (items.length - 1)) / items.length;
  for (let i = 0; i < items.length; i++) {
    const cx = x + i * (cardW + gap);
    const it = items[i];
    pdf.setFillColor(248, 250, 252);
    pdf.rect(cx, y, cardW, KPI_CARD_H, "F");
    pdf.setFillColor(it.color[0], it.color[1], it.color[2]);
    pdf.rect(cx, y, 1.6, KPI_CARD_H, "F");
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(cx, y, cardW, KPI_CARD_H, "S");
    pdf.setFontSize(7.5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100, 116, 139);
    pdf.text(it.label.toUpperCase(), cx + 4, y + 4.5);
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(15, 23, 42);
    pdf.text(truncate(pdf, it.value, cardW - 5), cx + 4, y + 11);
  }
  return y + KPI_CARD_H + 2;
}

function drawBuckets(
  pdf: jsPDF,
  raw: unknown,
  fieldKey: string,
  label: string,
  labels: Record<string, string>,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  const total = numeric(m["total"]);
  const buckets = (m["buckets"] as unknown[]) ?? [];

  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Total: ${total}`, x, y + 4);
  y += 8;

  const rows = buckets.map((b) => {
    const bm = b as Record<string, unknown>;
    const key = String(bm[fieldKey] ?? "");
    const name = labels[key] ?? key;
    const count = numeric(bm["count"]);
    const pct = total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—";
    return [name, String(count), pct];
  });

  return drawTable(pdf, [label, "Cantidad", "Porcentaje"], rows, {
    x, y, width, pageH,
    aligns: ["left", "right", "right"],
    columnWidths: [width * 0.55, width * 0.2, width * 0.25],
    sectionTitle: title,
    accent,
  });
}

function drawTasaExito(
  pdf: jsPDF,
  raw: unknown,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  const branches = ((m["branches"] as unknown[]) ?? []).map((b) => b as Record<string, unknown>);
  const rows = branches.map((b) => [
    String(b["branch_name"] ?? ""),
    String(numeric(b["total"])),
    String(numeric(b["delivered"])),
    String(numeric(b["failed"])),
    `${numeric(b["success_rate"]).toFixed(1)}%`,
  ]);
  return drawTable(pdf, ["Sucursal", "Total", "Entregadas", "Fallidas", "Éxito"], rows, {
    x, y, width, pageH,
    aligns: ["left", "right", "right", "right", "right"],
    columnWidths: [width * 0.4, width * 0.12, width * 0.18, width * 0.15, width * 0.15],
    sectionTitle: title,
    accent,
  });
}

function drawChoferes(
  pdf: jsPDF,
  raw: unknown,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  const drivers = ((m["drivers"] as unknown[]) ?? []).map((d) => d as Record<string, unknown>);
  const rows = drivers.map((d) => {
    const sr = d["success_rate"];
    const srStr = typeof sr === "number" ? `${sr.toFixed(1)}%` : "—";
    const avg = d["avg_delivery_hours"];
    const avgStr = typeof avg === "number" ? `${avg.toFixed(1)} h` : "—";
    return [
      String(d["driver_name"] ?? ""),
      String(d["branch_name"] ?? ""),
      String(numeric(d["total_assigned"])),
      String(numeric(d["delivered"])),
      String(numeric(d["delivery_failed"])),
      srStr,
      avgStr,
    ];
  });
  return drawTable(pdf, ["Chofer", "Sucursal", "Asign.", "Entreg.", "Fall.", "Éxito", "Prom."], rows, {
    x, y, width, pageH,
    aligns: ["left", "left", "right", "right", "right", "right", "right"],
    columnWidths: [
      width * 0.22, width * 0.22, width * 0.1, width * 0.1, width * 0.1, width * 0.13, width * 0.13,
    ],
    sectionTitle: title,
    accent,
  });
}

function drawFacturacion(
  pdf: jsPDF,
  raw: unknown,
  _branchName: (id: string) => string,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  const currency = (m["currency"] as string) || "ARS";
  const totalRev = numeric(m["total_revenue"]);
  const count = numeric(m["count"]);
  const avg = m["avg_ticket"];

  y = ensureSpace(pdf, y, KPI_CARD_H + 6, pageH);
  y = drawKpiRow(pdf, [
    { label: "Facturación total", value: `${currency} ${formatMoney(totalRev)}`, color: [22, 163, 74] },
    { label: "Envíos facturados", value: String(count), color: [37, 99, 235] },
    { label: "Ticket promedio", value: typeof avg === "number" ? `${currency} ${formatMoney(avg)}` : "—", color: [245, 158, 11] },
  ], y, x, width);

  const byBranch = (m["by_branch"] as Record<string, unknown>) ?? {};
  const branchKeys = Object.keys(byBranch).sort();
  if (branchKeys.length > 0) {
    y = ensureSpace(pdf, y + 2, TABLE_HEADER_H + TABLE_ROW_H, pageH);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Por sucursal", x, y);
    y += 3;
    const rows = branchKeys.map((k) => {
      const br = byBranch[k] as Record<string, unknown>;
      return [
        k,
        `${currency} ${formatMoney(numeric(br["revenue"]))}`,
        String(numeric(br["count"])),
        `${currency} ${formatMoney(numeric(br["avg_ticket"]))}`,
      ];
    });
    y = drawTable(pdf, ["Sucursal", "Facturación", "Envíos", "Ticket promedio"], rows, {
      x, y, width, pageH,
      aligns: ["left", "right", "right", "right"],
      columnWidths: [width * 0.28, width * 0.27, width * 0.15, width * 0.3],
      sectionTitle: title,
      accent,
    });
  }

  const byPeriod = (m["by_period"] as Record<string, unknown>) ?? {};
  const periodKeys = Object.keys(byPeriod).sort();
  if (periodKeys.length > 0) {
    y = ensureSpace(pdf, y + 2, TABLE_HEADER_H + TABLE_ROW_H, pageH);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Por período", x, y);
    y += 3;
    const rows = periodKeys.map((k) => [k, `${currency} ${formatMoney(numeric(byPeriod[k]))}`]);
    y = drawTable(pdf, ["Período", "Facturación"], rows, {
      x, y, width, pageH,
      aligns: ["left", "right"],
      columnWidths: [width * 0.5, width * 0.5],
      sectionTitle: title,
      accent,
    });
  }

  return y;
}

function drawRanking(
  pdf: jsPDF,
  raw: unknown,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  const ranking = ((m["ranking"] as unknown[]) ?? []).map((r) => r as Record<string, unknown>);
  const rows = ranking.map((r) => {
    const sr = r["success_rate"];
    return [
      String(numeric(r["rank"])),
      String(r["branch_name"] ?? ""),
      String(numeric(r["volume_confirmed"])),
      String(numeric(r["delivered"])),
      typeof sr === "number" ? `${sr.toFixed(1)}%` : "—",
    ];
  });
  return drawTable(pdf, ["#", "Sucursal", "Volumen", "Entregadas", "Éxito"], rows, {
    x, y, width, pageH,
    aligns: ["center", "left", "right", "right", "right"],
    columnWidths: [width * 0.08, width * 0.42, width * 0.17, width * 0.18, width * 0.15],
    sectionTitle: title,
    accent,
  });
}

function drawRetorno(
  pdf: jsPDF,
  raw: unknown,
  _branchName: (id: string) => string,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  const rate = m["return_rate"];
  y = ensureSpace(pdf, y, KPI_CARD_H + 6, pageH);
  y = drawKpiRow(pdf, [
    { label: "Devueltos", value: String(numeric(m["total_returned"])), color: [239, 68, 68] },
    { label: "Listos", value: String(numeric(m["total_ready_for_return"])), color: [245, 158, 11] },
    { label: "Elegibles", value: String(numeric(m["total_return_eligible"])), color: [100, 116, 139] },
    { label: "Tasa devolución", value: typeof rate === "number" ? `${rate.toFixed(1)}%` : "—", color: [37, 99, 235] },
  ], y, x, width);

  const byBranch = (m["by_branch"] as Record<string, unknown>) ?? {};
  const branchKeys = Object.keys(byBranch).sort();
  if (branchKeys.length > 0) {
    y = ensureSpace(pdf, y + 2, TABLE_HEADER_H + TABLE_ROW_H, pageH);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Por sucursal", x, y);
    y += 3;
    const rows = branchKeys.map((k) => {
      const br = byBranch[k] as Record<string, unknown>;
      return [
        k,
        String(numeric(br["returned"])),
        String(numeric(br["ready_for_return"])),
        String(numeric(br["total"])),
      ];
    });
    y = drawTable(pdf, ["Sucursal", "Devueltos", "Listos", "Total"], rows, {
      x, y, width, pageH,
      aligns: ["left", "right", "right", "right"],
      columnWidths: [width * 0.4, width * 0.2, width * 0.2, width * 0.2],
      sectionTitle: title,
      accent,
    });
  }

  const byDay = (m["by_day"] as Record<string, unknown>) ?? {};
  const dayKeys = Object.keys(byDay).sort();
  if (dayKeys.length > 0) {
    y = ensureSpace(pdf, y + 2, TABLE_HEADER_H + TABLE_ROW_H, pageH);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Por día", x, y);
    y += 3;
    const rows = dayKeys.map((k) => [k, String(numeric(byDay[k]))]);
    y = drawTable(pdf, ["Fecha", "Devueltos"], rows, {
      x, y, width, pageH,
      aligns: ["left", "right"],
      columnWidths: [width * 0.5, width * 0.5],
      sectionTitle: title,
      accent,
    });
  }

  return y;
}

function drawResumen(
  pdf: jsPDF,
  raw: unknown,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const m = (raw as Record<string, unknown>) ?? {};
  y = ensureSpace(pdf, y, KPI_CARD_H + 6, pageH);
  y = drawKpiRow(pdf, [
    { label: "Total de envíos", value: String(numeric(m["total_envios"])), color: [30, 58, 95] },
  ], y, x, width);

  const porTipo = (m["por_tipo"] as unknown[]) ?? [];
  if (porTipo.length > 0) {
    y = ensureSpace(pdf, y + 2, TABLE_HEADER_H + TABLE_ROW_H, pageH);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Por tipo", x, y);
    y += 3;
    const rows = porTipo.map((b) => {
      const bm = b as Record<string, unknown>;
      const key = String(bm["shipment_type"] ?? "");
      return [TIPO_LABELS[key] ?? key, String(numeric(bm["count"]))];
    });
    y = drawTable(pdf, ["Tipo", "Cantidad"], rows, {
      x, y, width, pageH,
      aligns: ["left", "right"],
      columnWidths: [width * 0.6, width * 0.4],
      sectionTitle: title,
      accent,
    });
  }

  const porVentana = (m["por_ventana"] as unknown[]) ?? [];
  if (porVentana.length > 0) {
    y = ensureSpace(pdf, y + 2, TABLE_HEADER_H + TABLE_ROW_H, pageH);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(71, 85, 105);
    pdf.text("Por ventana horaria", x, y);
    y += 3;
    const rows = porVentana.map((b) => {
      const bm = b as Record<string, unknown>;
      const key = String(bm["time_window"] ?? "");
      return [VENTANA_LABELS[key] ?? key, String(numeric(bm["count"]))];
    });
    y = drawTable(pdf, ["Ventana", "Cantidad"], rows, {
      x, y, width, pageH,
      aligns: ["left", "right"],
      columnWidths: [width * 0.6, width * 0.4],
      sectionTitle: title,
      accent,
    });
  }

  return y;
}

function drawGenericKV(
  pdf: jsPDF,
  raw: unknown,
  title: string,
  accent: [number, number, number],
  y: number,
  x: number,
  width: number,
  pageH: number,
): number {
  const rows: string[][] = [];
  flatten("", raw, rows);
  return drawTable(pdf, ["Campo", "Valor"], rows, {
    x, y, width, pageH,
    aligns: ["left", "left"],
    columnWidths: [width * 0.45, width * 0.55],
    sectionTitle: title,
    accent,
  });
}

function flatten(prefix: string, v: unknown, rows: string[][]) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}.${k}` : k, val, rows);
    }
  } else if (Array.isArray(v)) {
    v.forEach((item, i) => flatten(`${prefix}[${i}]`, item, rows));
  } else {
    rows.push([prefix, String(v)]);
  }
}

function numeric(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
}
