import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, MapPin, ArrowRight, Package, Truck, CheckCircle2, AlertCircle, AlertTriangle, Box, Download, Eye, Clock } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import domtoimage from "dom-to-image-more";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { shipmentApi, type Stats, type ShipmentStatus } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { fmtDateTime } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { toast } from "../utils/toast";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../components/ui/gradient-card";
import { StatCard } from "../components/ui/stat-card";

const statusConfig: Record<ShipmentStatus, { label: string; tone: "default" | "success" | "warning" | "danger" | "info" }> = {
  draft:                { label: "Borradores",                  tone: "default" },
  at_origin_hub:        { label: "En sucursal de origen",       tone: "warning" },
  loaded:               { label: "Cargado en vehículo",          tone: "info" },
  in_transit:           { label: "En tránsito",                 tone: "info" },
  at_hub:               { label: "En sucursal",                 tone: "info" },
  out_for_delivery:     { label: "Última milla",                tone: "warning" },
  delivery_failed:      { label: "Entrega fallida",             tone: "danger" },
  redelivery_scheduled: { label: "Reentrega programada",        tone: "warning" },
  no_entregado:         { label: "No entregados",               tone: "danger" },
  rechazado:            { label: "Rechazados",                  tone: "danger" },
  delivered:            { label: "Entregados",                  tone: "success" },
  ready_for_pickup:     { label: "Listos para retiro",          tone: "info" },
  ready_for_return:     { label: "Listos para devolución",      tone: "warning" },
  returned:             { label: "Devueltos",                   tone: "default" },
  cancelled:            { label: "Cancelados",                  tone: "danger" },
  lost:                 { label: "Extraviados",                 tone: "danger" },
  destroyed:            { label: "Daño total",                  tone: "danger" },
  expired:              { label: "Borrador expirado",           tone: "default" },
  pending_payment:      { label: "Pago pendiente",              tone: "warning" },
};

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toDateInput(from), to: toDateInput(to) };
}

const inputClass =
  "h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded-lg ${className ?? ""}`} />;
}

export function Dashboard() {
  const { user, hasRole } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [exportOpen, setExportOpen] = useState(false);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const range = defaultRange();
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const navigate = useNavigate();
  const dashboardRef = useRef<HTMLDivElement>(null);

  const isSupervisor = hasRole("supervisor") && !hasRole("manager", "admin");
  const supervisorBranch = isSupervisor ? (user?.branch_id ?? "") : "";
  const effectiveBranch = isSupervisor ? supervisorBranch : selectedBranch;

  useEffect(() => {
    if (!isSupervisor) {
      branchApi.list("activo").then(setBranches);
    }
  }, [isSupervisor]);

  useEffect(() => {
    setLoading(true);
    const params: { date_from: string; date_to: string; branch_id?: string } = {
      date_from: dateFrom,
      date_to: dateTo,
    };
    if (effectiveBranch) params.branch_id = effectiveBranch;
    shipmentApi.stats(params).then((s) => {
      setStats(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [dateFrom, dateTo, effectiveBranch]);

  const branchesByProvince = branches.reduce<Record<string, Branch[]>>((acc, b) => {
    const prov = b.address.province;
    if (!acc[prov]) acc[prov] = [];
    acc[prov].push(b);
    return acc;
  }, {});
  const sortedProvinces = Object.keys(branchesByProvince).sort((a, b) => a.localeCompare(b));
  for (const prov of sortedProvinces) {
    branchesByProvince[prov].sort((a, b) => a.name.localeCompare(b.name));
  }

  const branchLabel = (() => {
    if (isSupervisor) {
      const b = branches.find((br) => br.id === supervisorBranch);
      return b ? b.name : supervisorBranch || "Tu sucursal";
    }
    if (!effectiveBranch) return "Todas las sucursales";
    const b = branches.find((br) => br.id === effectiveBranch);
    return b ? b.name : effectiveBranch;
  })();

  const totalShipments = stats?.total ?? 0;
  const inProgress = (stats?.by_status?.in_transit ?? 0) + (stats?.by_status?.out_for_delivery ?? 0) + (stats?.by_status?.loaded ?? 0);
  const delivered = stats?.by_status?.delivered ?? 0;
  const issues = (stats?.by_status?.delivery_failed ?? 0) + (stats?.by_status?.lost ?? 0) + (stats?.by_status?.destroyed ?? 0);

  const chartData: { date: string; creados: number; entregados: number }[] = [];
  if (dateFrom && dateTo) {
    const cur = new Date(dateFrom + "T00:00:00");
    const end = new Date(dateTo + "T00:00:00");
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      chartData.push({ date: key, creados: stats?.by_day?.[key] ?? 0, entregados: stats?.by_day_delivered?.[key] ?? 0 });
      cur.setDate(cur.getDate() + 1);
    }
  }

  const exportPDF = useCallback(async () => {
    setExportOpen(false);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const el = dashboardRef.current;
      if (!el) return;
      toast.success("Generando PDF…");
      const imgData = await domtoimage.toPng(el, { quality: 1, bgcolor: "#ffffff" });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = imgData;
      });
      const pdf = new jsPDF({ orientation: "l", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const pageAspect = pageW / pageH;
      let imgW: number, imgH: number;
      if (imgAspect > pageAspect) {
        imgW = pageW;
        imgH = pageW / imgAspect;
      } else {
        imgH = pageH;
        imgW = pageH * imgAspect;
      }
      pdf.addImage(imgData, "PNG", 0, 0, imgW, imgH);
      pdf.save(`dashboard_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      console.error("Error exporting PDF:", e);
      toast.error("Error al exportar PDF. Revisá la consola para más detalles.");
    }
  }, []);

  const exportExcel = useCallback(() => {
    setExportOpen(false);
    try {
      toast.success("Generando Excel…");
      const wb = XLSX.utils.book_new();
      const statusRows = Object.entries(stats?.by_status ?? {}).map(([status, count]) => ({
        Estado: statusConfig[status as ShipmentStatus]?.label ?? status,
        Cantidad: count,
      }));
      const ws1 = XLSX.utils.json_to_sheet(statusRows);
      XLSX.utils.book_append_sheet(wb, ws1, "Distribucion por estado");

      const trendRows = chartData.map((d) => ({
        Fecha: d.date,
        Creados: d.creados,
        Entregados: d.entregados,
      }));
      const ws2 = XLSX.utils.json_to_sheet(trendRows);
      XLSX.utils.book_append_sheet(wb, ws2, "Tendencia diaria");

      XLSX.writeFile(wb, `dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      console.error("Error exporting Excel:", e);
      toast.error("Error al exportar Excel. Revisá la consola para más detalles.");
    }
  }, [stats, chartData]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto" ref={dashboardRef}>
      <PageHeader
        title="Dashboard"
        description="Vista consolidada de la operación logística"
        icon={<LayoutDashboard className="w-5 h-5" />}
        actions={
          <div className="flex items-center gap-2">
            {isSupervisor ? (
              <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 border border-blue-200 text-sm font-semibold text-[#1e3a5f] shadow-sm">
                <MapPin className="w-3.5 h-3.5" />
                {branchLabel}
              </span>
            ) : (
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className={inputClass}
                aria-label="Filtrar por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {sortedProvinces.map((prov) => (
                  <optgroup key={prov} label={prov}>
                    {branchesByProvince[prov].map((b) => (
                      <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            <div className="relative">
              <button
                onClick={() => setExportOpen(!exportOpen)}
                aria-label="Exportar dashboard"
                aria-expanded={exportOpen}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-36 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden origin-top-right transition-all duration-150">
                    <button onClick={exportPDF}
                      className="w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-blue-50"
                      aria-label="Exportar como PDF">
                      PDF
                    </button>
                    <button onClick={exportExcel}
                      className="w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-blue-50"
                      aria-label="Exportar como Excel">
                      Excel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Highlighted KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            <>
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </>
          ) : (
            <>
              <GradientCard tone="brand">
                <div className="flex items-start gap-3">
                  <GradientCardIcon><Box className="w-5 h-5" /></GradientCardIcon>
                  <div className="flex-1 min-w-0">
                    <GradientCardLabel>Total de envíos</GradientCardLabel>
                    <GradientCardValue className="mt-1">{totalShipments}</GradientCardValue>
                  </div>
                </div>
              </GradientCard>

              <StatCard
                label="En curso"
                value={inProgress}
                hint="Cargado en vehículo + en tránsito + última milla"
                icon={<Truck className="w-4 h-4" />}
                tone="info"
              />
              <StatCard
                label="Entregados"
                value={delivered}
                hint="Completados con éxito"
                icon={<CheckCircle2 className="w-4 h-4" />}
                tone="success"
                onClick={() => navigate(`/kpi-detail?kpi=delivered&date_from=${dateFrom}&date_to=${dateTo}${effectiveBranch ? `&branch_id=${effectiveBranch}` : ""}`)}
              />
              <StatCard
                label="Problemas"
                value={issues}
                hint="Fallidos + extraviados + dañados"
                icon={<AlertCircle className="w-4 h-4" />}
                tone="danger"
                onClick={() => navigate(`/kpi-detail?kpi=issues&date_from=${dateFrom}&date_to=${dateTo}${effectiveBranch ? `&branch_id=${effectiveBranch}` : ""}`)}
              />
            </>
          )}
        </div>

        {/* Success rate & avg cycle time — grouped card when there's data */}
        {!loading && stats && (stats.success_rate != null || stats.avg_cycle_time_hours != null) && (
          <Card variant="muted" className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 shrink-0">Métricas de operación</span>
              {stats.success_rate != null && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Tasa de éxito: <strong className="tab-nums">{stats.success_rate.toFixed(1)}%</strong>
                </span>
              )}
              {stats.avg_cycle_time_hours != null && (
                <span className="inline-flex items-center gap-1.5 text-sm text-blue-700">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  Ciclo promedio: <strong className="tab-nums">{stats.avg_cycle_time_hours.toFixed(1)} h</strong>
                </span>
              )}
              {stats.open_incidents > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm text-rose-700">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Incidentes abiertos: <strong className="tab-nums">{stats.open_incidents}</strong>
                </span>
              )}
            </div>
          </Card>
        )}

        {/* Status breakdown */}
        <Card>
          <div className="px-5 pt-5 pb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-900 tracking-tight">Distribución por estado</h2>
            <div className="flex items-center gap-3">
              <p className="text-xs text-slate-500 hidden sm:block">Click en una tarjeta para filtrar</p>
              <button
                onClick={() => setShowAllStatuses(!showAllStatuses)}
                className="text-xs font-semibold text-[#2563eb] hover:text-[#1d4ed8] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50 rounded"
              >
                {showAllStatuses ? "Solo con datos" : "Mostrar todos"}
              </button>
            </div>
          </div>
          <div className="px-5 pb-5">
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
                {(Object.keys(statusConfig) as ShipmentStatus[]).filter(s => showAllStatuses || (stats?.by_status?.[s] ?? 0) > 0).map((s) => {
                  const cfg = statusConfig[s];
                  const value = stats?.by_status?.[s] ?? 0;
                  const iconMap: Record<string, React.ReactNode> = {
                    success: <CheckCircle2 className="w-3.5 h-3.5" />,
                    danger: <AlertCircle className="w-3.5 h-3.5" />,
                    warning: <AlertTriangle className="w-3.5 h-3.5" />,
                    info: <Eye className="w-3.5 h-3.5" />,
                  };
                  return (
                    <StatCard
                      key={s}
                      label={cfg.label}
                      value={value}
                      tone={cfg.tone}
                      icon={iconMap[cfg.tone] ?? <Package className="w-3.5 h-3.5" />}
                      onClick={() => navigate(`/?status=${s}`)}
                      className="!p-3"
                    />
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {/* Chart */}
        <Card>
          <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900 tracking-tight">Envíos creados vs entregados por día</h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Desde</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateFrom(e.target.value)}
                className={inputClass}
                aria-label="Fecha desde"
              />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Hasta</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateTo(e.target.value)}
                className={inputClass}
                aria-label="Fecha hasta"
              />
            </div>
          </div>
          <div className="p-5">
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <LayoutDashboard className="w-10 h-10 text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 mb-1">No hay datos en este rango</p>
                <p className="text-xs text-slate-400">Ajustá las fechas para ver el gráfico</p>
              </div>
            ) : (
              <div className="rounded-xl bg-white border border-slate-100 p-4">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} barCategoryGap="18%" margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#94a3b8", fontWeight: 500 }}
                      tickFormatter={(v) => String(v).slice(5)}
                      interval={Math.max(0, Math.floor(chartData.length / 12))}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 10,
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                        padding: "10px 14px",
                        background: "rgba(255,255,255,0.97)",
                      }}
                      labelFormatter={(label) => `${String(label)}`}
                      formatter={(value: number, name: string) => [value, name === "creados" ? "Creados" : "Entregados"]}
                    />
                    <Bar dataKey="creados" fill="#2563eb" radius={[3, 3, 0, 0]} name="Creados" maxBarSize={32} />
                    <Bar dataKey="entregados" fill="#10b981" radius={[3, 3, 0, 0]} name="Entregados" maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-5 mt-3 pt-3 border-t border-slate-100">
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-[#2563eb]" />
                    Creados
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block w-2.5 h-2.5 rounded bg-emerald-500" />
                    Entregados
                  </span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Recent shipments */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900 tracking-tight">Envíos recientes</h2>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#2563eb] hover:text-[#1d4ed8] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50 rounded"
            >
              Ver todos <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (stats?.recent_shipments?.length ?? 0) === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                <Package className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-600 mb-1">Sin envíos recientes</p>
              <p className="text-xs text-slate-400">Los envíos aparecerán acá a medida que se creen.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="bg-slate-50 text-left border-b border-slate-100">
                    <th className={thClass}>ID de seguimiento</th>
                    <th className={thClass}>Destinatario</th>
                    <th className={thClass}>Destino</th>
                    <th className={thClass}>Estado</th>
                    <th className={thClass}>Creado</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.recent_shipments ?? []).map((s, i) => (
                    <tr
                      key={s.tracking_id}
                      onClick={() => navigate(`/shipments/${s.tracking_id}`)}
                      className={`border-b border-slate-100 cursor-pointer transition-colors ${
                        i % 2 === 0 ? "bg-white" : "bg-slate-50/20"
                      } hover:bg-blue-50/60`}
                    >
                      <td className={tdClass}>
                        <code className="text-xs font-mono text-[#1e3a5f] font-semibold bg-slate-50 px-1.5 py-0.5 rounded">{s.tracking_id}</code>
                      </td>
                      <td className={tdClass}>{s.recipient.name}</td>
                      <td className={`${tdClass} text-slate-500`}>{s.recipient.address.city}</td>
                      <td className={tdClass}><StatusBadge status={s.status} label={shipmentStatusLabelOverride(s)} /></td>
                      <td className={`${tdClass} text-slate-400`}>{fmtDateTime(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const thClass = "px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider";
const tdClass = "px-4 py-3 text-slate-700";
