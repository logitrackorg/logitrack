import { useEffect, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { reportsApi, type ClaimStatsResponse } from "../../api/reports";
import { useAuth } from "../../context/AuthContext";
import {
  CLAIM_TYPE_LABELS,
  CLAIM_PRIORITY_LABELS,
} from "../../api/claims";
import { Card } from "../../components/ui/card";
import { StatCard } from "../../components/ui/stat-card";
import { ReportExport } from "../../components/ReportExport";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface ClaimsTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  operaciones:    "Operaciones",
  comercial:      "Comercial",
  rrhh:           "RRHH",
  legales:        "Legales",
  seguros:        "Seguros",
  administracion: "Administración",
};

const RESOLUTION_LABELS: Record<string, string> = {
  operativa:    "Operativa",
  comercial:    "Comercial",
  rrhh:         "RRHH",
  improcedente: "Improcedente",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgente: "#e11d48",
  alta:    "#f97316",
  media:   "#f59e0b",
  baja:    "#94a3b8",
};

function formatHours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} días`;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-5 rounded-full bg-gradient-to-b from-violet-500 to-blue-400" />
      <h2 className="text-base font-semibold text-slate-900 dark:text-gray-100 tracking-tight">{title}</h2>
    </div>
  );
}

function BreakdownTable({
  data,
  labels,
}: {
  data: Record<string, number>;
  labels: Record<string, string>;
}) {
  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) {
    return <p className="text-sm text-slate-400 py-4 text-center">Sin datos para el período.</p>;
  }
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-slate-50/50 dark:bg-gray-800/50 text-left border-b border-slate-100 dark:border-gray-700">
          <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider">Categoría</th>
          <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider text-right">Cantidad</th>
          <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider text-right">%</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(([key, count]) => (
          <tr key={key} className="border-b border-slate-100 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
            <td className="px-4 py-2.5 text-slate-700 dark:text-gray-200 font-medium">{labels[key] ?? key}</td>
            <td className="px-4 py-2.5 text-slate-900 dark:text-gray-100 tabular-nums text-right font-semibold">{count}</td>
            <td className="px-4 py-2.5 text-slate-500 dark:text-gray-400 tabular-nums text-right">
              {total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ClaimsTab({ dateFrom, dateTo, branchId }: ClaimsTabProps) {
  const { hasRole } = useAuth();
  const isManager = hasRole("manager", "admin");
  const [data, setData] = useState<ClaimStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError(false);
    const params: { date_from: string; date_to: string; branch_id?: string } = {
      date_from: dateFrom,
      date_to: dateTo,
    };
    if (branchId) params.branch_id = branchId;
    reportsApi
      .claimStats(params)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [dateFrom, dateTo, branchId]);

  const exportPDF = useCallback(async () => {
    await exportToPDF(reportRef, `reclamos_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportExcel = useCallback(() => {
    if (!data) return;
    exportToExcel(
      [
        {
          name: "Resumen",
          data: [
            { Métrica: "Total", Valor: data.total },
            { Métrica: "Abiertos", Valor: data.open },
            { Métrica: "Resueltos", Valor: data.resolved },
            { Métrica: "Escalados automáticamente", Valor: data.escalated },
            { Métrica: "Tiempo prom. resolución (h)", Valor: data.avg_resolution_hours ?? "—" },
          ],
        },
        {
          name: "Por prioridad",
          data: Object.entries(data.by_priority).map(([k, v]) => ({
            Prioridad: CLAIM_PRIORITY_LABELS[k as keyof typeof CLAIM_PRIORITY_LABELS] ?? k,
            Cantidad: v,
          })),
        },
        {
          name: "Por tipo",
          data: Object.entries(data.by_type).map(([k, v]) => ({
            Tipo: CLAIM_TYPE_LABELS[k as keyof typeof CLAIM_TYPE_LABELS] ?? k,
            Cantidad: v,
          })),
        },
        {
          name: "Por categoría",
          data: Object.entries(data.by_category).map(([k, v]) => ({
            Categoría: CATEGORY_LABELS[k] ?? k,
            Cantidad: v,
          })),
        },
        {
          name: "Por resolución",
          data: Object.entries(data.by_resolution).map(([k, v]) => ({
            Resolución: RESOLUTION_LABELS[k] ?? k,
            Cantidad: v,
          })),
        },
        {
          name: "Por sucursal",
          data: data.by_branch.map((b) => ({
            Sucursal: b.branch_name,
            Total: b.total,
            Abiertos: b.open,
            Resueltos: b.resolved,
          })),
        },
      ],
      `reclamos_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  }, [data]);

  const priorityChartData = data
    ? (["urgente", "alta", "media", "baja"] as const)
        .map((p) => ({ name: CLAIM_PRIORITY_LABELS[p], value: data.by_priority[p] ?? 0, key: p }))
        .filter((d) => d.value > 0)
    : [];

  const typeChartData = data
    ? Object.entries(data.by_type)
        .map(([k, v]) => ({ name: CLAIM_TYPE_LABELS[k as keyof typeof CLAIM_TYPE_LABELS] ?? k, value: v }))
        .sort((a, b) => b.value - a.value)
    : [];

  const branchChartData = data
    ? [...data.by_branch].sort((a, b) => b.total - a.total).slice(0, 10)
    : [];

  return (
    <div className="space-y-6" ref={reportRef}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-gray-100">Reclamos</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400">Métricas del sistema de reclamos formales (REC-)</p>
        </div>
        <ReportExport onExportPDF={exportPDF} onExportExcel={exportExcel} loading={loading} />
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : error ? (
        <Card className="p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
        </Card>
      ) : !data || data.total === 0 ? (
        <Card className="p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No hay reclamos para el período seleccionado.</p>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard
              label="Total reclamos"
              value={data.total}
              icon={<AlertCircle className="w-4 h-4" />}
              tone="default"
              hint={`${dateFrom} al ${dateTo}`}
            />
            <StatCard
              label="Abiertos"
              value={data.open}
              icon={<AlertTriangle className="w-4 h-4" />}
              tone="warning"
            />
            <StatCard
              label="Resueltos"
              value={data.resolved}
              icon={<CheckCircle2 className="w-4 h-4" />}
              tone="success"
            />
            <StatCard
              label="Escalados automáticamente"
              value={data.escalated}
              icon={<TrendingUp className="w-4 h-4" />}
              tone="danger"
              hint="Escalados por inactividad"
            />
            <StatCard
              label="Tiempo prom. resolución"
              value={formatHours(data.avg_resolution_hours)}
              icon={<Clock className="w-4 h-4" />}
              tone="info"
            />
          </div>

          {/* Prioridad + Tipo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Por prioridad */}
            <Card className="p-5">
              <SectionHeader title="Por prioridad" />
              {priorityChartData.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={priorityChartData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} width={72} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="value" name="Reclamos" radius={[0, 4, 4, 0]} maxBarSize={24}>
                      {priorityChartData.map((entry) => (
                        <Cell key={entry.key} fill={PRIORITY_COLORS[entry.key] ?? "#94a3b8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Por tipo */}
            <Card className="p-5">
              <SectionHeader title="Por tipo de reclamo" />
              {typeChartData.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={typeChartData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} width={110} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="value" name="Reclamos" fill="#6366f1" radius={[0, 4, 4, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* Categoría + Resolución */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="overflow-hidden">
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-gray-700">
                <SectionHeader title="Por categoría asignada" />
              </div>
              <div className="overflow-x-auto">
                <BreakdownTable data={data.by_category} labels={CATEGORY_LABELS} />
              </div>
            </Card>
            <Card className="overflow-hidden">
              <div className="px-5 pt-4 pb-3 border-b border-slate-100 dark:border-gray-700">
                <SectionHeader title="Por tipo de resolución" />
              </div>
              <div className="overflow-x-auto">
                {Object.keys(data.by_resolution).length === 0 ? (
                  <p className="text-sm text-slate-400 py-6 text-center px-4">No hay reclamos resueltos en el período.</p>
                ) : (
                  <BreakdownTable data={data.by_resolution} labels={RESOLUTION_LABELS} />
                )}
              </div>
            </Card>
          </div>

          {/* Por sucursal — solo gerentes */}
          {isManager && branchChartData.length > 0 && (
            <Card className="p-5">
              <SectionHeader title="Por sucursal" />
              <ResponsiveContainer width="100%" height={Math.max(240, branchChartData.length * 48)}>
                <BarChart
                  data={branchChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 56, bottom: 4, left: 10 }}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="branch_name"
                    tick={{ fontSize: 11, fill: "#475569" }}
                    axisLine={false}
                    tickLine={false}
                    width={120}
                  />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="open" name="Abiertos" stackId="a" fill="#f97316" maxBarSize={24} />
                  <Bar dataKey="resolved" name="Resueltos" stackId="a" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-5 mt-3 pt-3 border-t border-slate-100 dark:border-gray-700">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
                  <span className="inline-block w-2 h-2 rounded-sm bg-[#f97316]" />Abiertos
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <span className="inline-block w-2 h-2 rounded-sm bg-[#10b981]" />Resueltos
                </span>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
