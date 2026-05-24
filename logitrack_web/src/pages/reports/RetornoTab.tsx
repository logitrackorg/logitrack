import { useEffect, useState, useCallback, useRef } from "react";
import { Undo2, Percent, AlertTriangle } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { reportsApi, type ReturnMetricsResponse } from "../../api/reports";
import { Card } from "../../components/ui/card";
import { StatCard } from "../../components/ui/stat-card";
import { ReportExport } from "../../components/ReportExport";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface RetornoTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  padding: "8px 12px",
  background: "rgba(255,255,255,0.97)",
};

export default function RetornoTab({ dateFrom, dateTo, branchId }: RetornoTabProps) {
  const [data, setData] = useState<ReturnMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: { date_from?: string; date_to?: string; branch_id?: string } = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (branchId) params.branch_id = branchId;

    reportsApi
      .returnMetrics(params)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [dateFrom, dateTo, branchId]);

  // Derived data
  const totalReturns = data?.total_returned ?? 0;
  const returnRate = data?.return_rate ?? null;
  const readyForReturn = data?.total_ready_for_return ?? 0;

  // Most common return reason — from by_branch, find branch with most returns
  const byBranchEntries = data ? Object.entries(data.by_branch) : [];
  const topBranch = byBranchEntries.length > 0
    ? byBranchEntries.reduce((best, [, v]) => v.returned > best.returned ? v : best, byBranchEntries[0][1])
    : null;

  // Chart data from by_day
  const lineData = data
    ? Object.entries(data.by_day)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, retornos: count }))
    : [];

  const maxVal = lineData.length > 0 ? Math.max(...lineData.map((d) => d.retornos), 1) : 1;

  const exportPDF = useCallback(async () => {
    setExporting(true);
    await exportToPDF(contentRef, `metricas_retorno_${new Date().toISOString().slice(0, 10)}.pdf`);
    setExporting(false);
  }, []);

  const exportExcel = useCallback(() => {
    if (!data) return;
    const sheets: { name: string; data: Record<string, unknown>[] }[] = [];

    const summaryRows = [
      { M\u00e9trica: "Total retornados", Valor: data.total_returned },
      { M\u00e9trica: "Listos para retorno", Valor: data.total_ready_for_return },
      { M\u00e9trica: "Elegibles", Valor: data.total_return_eligible },
      { M\u00e9trica: "Tasa de retorno %", Valor: data.return_rate !== null ? data.return_rate.toFixed(1) : "\u2014" },
    ];
    sheets.push({ name: "Resumen", data: summaryRows });

    if (byBranchEntries.length > 0) {
      const branchRows = byBranchEntries.map(([id, v]) => ({
        Sucursal: id,
        Retornados: v.returned,
        "Listos para retorno": v.ready_for_return,
        Total: v.total,
      }));
      sheets.push({ name: "Por sucursal", data: branchRows });
    }

    if (lineData.length > 0) {
      const dailyRows = lineData.map((d) => ({
        Fecha: d.date,
        Retornos: d.retornos,
      }));
      sheets.push({ name: "Tendencia diaria", data: dailyRows });
    }

    exportToExcel(sheets, `metricas_retorno_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [data, byBranchEntries, lineData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Undo2 className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Métricas de Retorno</h2>
        </div>
        <ReportExport
          onExportPDF={exportPDF}
          onExportExcel={exportExcel}
          loading={exporting}
        />
      </div>

      <div ref={contentRef}>
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : error ? (
          <Card className="p-10 text-center">
            <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
          </Card>
        ) : !data || (totalReturns === 0 && readyForReturn === 0 && data.total_return_eligible === 0) ? (
          <Card className="p-10 text-center">
            <p className="text-sm text-slate-500">No hay datos de retorno para el período seleccionado.</p>
          </Card>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <StatCard
                label="Total retornos"
                value={totalReturns}
                icon={<Undo2 className="w-4 h-4" />}
                tone="default"
              />
              <StatCard
                label="Tasa de retorno"
                value={returnRate !== null ? `${returnRate.toFixed(1)}%` : "—"}
                hint={returnRate !== null ? `de ${data!.total_return_eligible} envíos elegibles` : undefined}
                icon={<Percent className="w-4 h-4" />}
                tone={returnRate !== null && returnRate > 10 ? "danger" : returnRate !== null && returnRate > 5 ? "warning" : "success"}
              />
              <StatCard
                label="Sucursal con más retornos"
                value={topBranch ? byBranchEntries.find(([, v]) => v === topBranch)?.[0] ?? "—" : "—"}
                hint={topBranch ? `${topBranch.returned} envíos devueltos` : undefined}
                icon={<AlertTriangle className="w-4 h-4" />}
                tone="warning"
              />
            </div>

            {/* Trend chart */}
            {lineData.length > 0 && lineData.some((d) => d.retornos > 0) ? (
              <Card>
                <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 rounded-full bg-gradient-to-b from-amber-500 to-amber-300" />
                    <h2 className="text-base font-semibold text-slate-900 tracking-tight">Tendencia diaria de retornos</h2>
                  </div>
                  <span className="text-xs text-slate-500">
                    Total: <strong className="text-amber-700 tabular-nums">{totalReturns}</strong>
                  </span>
                </div>
                <div className="px-5 pb-5">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={lineData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="returnGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "#94a3b8" }}
                          tickFormatter={(v: string) => v.slice(5)}
                          interval={Math.max(0, Math.floor(lineData.length / 8))}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, maxVal + 1]}
                          allowDecimals={false}
                          tick={{ fontSize: 10, fill: "#94a3b8" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(value: any) => [value, "Retornos"]}
                          labelFormatter={(v: any) =>
                            new Date(v + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="retornos"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          fill="url(#returnGrad)"
                          activeDot={{ r: 5, fill: "#f59e0b" }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-10 text-center">
                <p className="text-xs text-slate-400">Sin retornos en el período seleccionado</p>
              </Card>
            )}

            {/* By branch breakdown */}
            {byBranchEntries.length > 0 && (
              <Card className="mt-4 overflow-hidden">
                <div className="px-5 pt-5 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-5 rounded-full bg-gradient-to-b from-slate-500 to-slate-300" />
                    <h2 className="text-base font-semibold text-slate-900 tracking-tight">Desglose por sucursal</h2>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                        <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Sucursal</th>
                        <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Retornados</th>
                        <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Listos para retorno</th>
                        <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byBranchEntries.map(([id, v]) => (
                        <tr key={id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3 text-slate-700 font-medium">{id}</td>
                          <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{v.returned}</td>
                          <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{v.ready_for_return}</td>
                          <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{v.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
