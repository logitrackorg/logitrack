import { useEffect, useState, useCallback, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { reportsApi, type IncidentsByBranchResponse } from "../../api/reports";
import { Card } from "../../components/ui/card";
import { StatCard } from "../../components/ui/stat-card";
import { ReportExport } from "../../components/ReportExport";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface ReclamosTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

function getBarColor(count: number): string {
  if (count >= 6) return "#ef4444";
  if (count >= 3) return "#f59e0b";
  return "#3b82f6";
}

const TYPE_LABELS: Record<string, string> = {
  extraviado: "Extraviado",
  danio_total: "Daño total",
  demora: "Demora",
  paquete_abierto: "Paquete abierto",
  perdida: "Pérdida",
  otro: "Otro",
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { branch_name: string; total: number; by_type: Record<string, number> } }> }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  const types = Object.entries(data.by_type);
  return (
    <div className="bg-white/97 border border-slate-200 rounded-lg shadow-lg p-3 text-sm min-w-[160px]">
      <p className="font-semibold text-slate-900 mb-1.5">{data.branch_name}</p>
      <p className="text-slate-700 mb-1">
        Total: <strong className="tabular-nums">{data.total}</strong>
      </p>
      {types.length > 0 && (
        <div className="border-t border-slate-100 pt-1.5 mt-1.5 space-y-0.5">
          {types.map(([type, count]) => (
            <div key={type} className="flex justify-between gap-4 text-xs text-slate-600">
              <span>{TYPE_LABELS[type] ?? type}</span>
              <span className="tabular-nums font-medium">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReclamosTab({ dateFrom, dateTo, branchId }: ReclamosTabProps) {
  const [data, setData] = useState<IncidentsByBranchResponse | null>(null);
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
    reportsApi.incidentsByBranch(params)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [dateFrom, dateTo, branchId]);

  const chartData = (data?.branches ?? [])
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((b) => ({
      branch_name: b.branch_name,
      total: b.total,
      by_type: b.by_type,
    }));

  const totalIncidents = data?.total ?? 0;
  const worstBranch = (data?.branches ?? []).length > 0
    ? [...(data?.branches ?? [])].sort((a, b) => b.total - a.total)[0]
    : null;

  const exportPDF = useCallback(async () => {
    await exportToPDF(reportRef, `incidentes_sucursal_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportExcel = useCallback(() => {
    if (!data) return;
    const branchRows = data.branches.map((b) => {
      const row: Record<string, string | number> = {
        Sucursal: b.branch_name,
        Total: b.total,
      };
      for (const [type, count] of Object.entries(b.by_type)) {
        row[TYPE_LABELS[type] ?? type] = count;
      }
      return row;
    });
    const typeRows = Object.entries(data.grand_total_by_type).map(([type, count]) => ({
      Tipo: TYPE_LABELS[type] ?? type,
      Cantidad: count,
    }));
    exportToExcel([
      { name: "Incidentes por sucursal", data: branchRows },
      { name: "Total por tipo", data: typeRows },
    ], `incidentes_sucursal_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [data]);

  return (
    <div className="space-y-6" ref={reportRef}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Incidentes por Sucursal</h2>
          <p className="text-sm text-slate-500">Incidentes reportados por sucursal con desglose por tipo</p>
        </div>
        <ReportExport
          onExportPDF={exportPDF}
          onExportExcel={exportExcel}
          loading={loading}
        />
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : error ? (
        <Card className="p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
        </Card>
      ) : !data || data.branches.length === 0 ? (
        <Card className="p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No hay datos de incidentes para el período seleccionado.</p>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <StatCard
              label="Total incidentes"
              value={totalIncidents}
              icon={<AlertTriangle className="w-4 h-4" />}
              tone="danger"
              hint={dateFrom && dateTo ? `${dateFrom} al ${dateTo}` : undefined}
            />
            <StatCard
              label="Sucursal con más incidentes"
              value={worstBranch ? worstBranch.branch_name : "—"}
              icon={<AlertTriangle className="w-4 h-4" />}
              tone="warning"
              hint={worstBranch ? `${worstBranch.total} incidentes` : undefined}
            />
          </div>

          {/* Bar chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-5 rounded-full bg-gradient-to-b from-orange-500 to-red-400" />
              <h2 className="text-base font-semibold text-slate-900 tracking-tight">Incidentes por sucursal</h2>
            </div>

            {chartData.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Sin incidentes en el período seleccionado</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 48)}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 4, right: 48, bottom: 4, left: 10 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="branch_name"
                      tick={{ fontSize: 11, fill: "#475569", fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                      width={120}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar
                      dataKey="total"
                      name="Incidentes"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={28}
                    >
                      {chartData.map((entry) => (
                        <Cell key={entry.branch_name} fill={getBarColor(entry.total)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* Legend */}
                <div className="flex items-center justify-center gap-5 mt-3 pt-3 border-t border-slate-100">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#3b82f6]" />
                    0–2
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#f59e0b]" />
                    3–5
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                    <span className="inline-block w-2 h-2 rounded-sm bg-[#ef4444]" />
                    6+
                  </span>
                </div>
              </>
            )}
          </Card>

          {/* Type breakdown table */}
          {Object.keys(data.grand_total_by_type).length > 0 && (
            <Card className="mt-4 overflow-hidden">
              <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-slate-100">
                <div className="w-1 h-5 rounded-full bg-gradient-to-b from-slate-400 to-slate-300" />
                <h2 className="text-base font-semibold text-slate-900 tracking-tight">Desglose por tipo</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Tipo</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.grand_total_by_type)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, count]) => (
                        <tr key={type} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3 text-slate-700 font-medium">{TYPE_LABELS[type] ?? type}</td>
                          <td className="px-5 py-3 text-slate-900 font-semibold tabular-nums text-right">{count}</td>
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
  );
}
