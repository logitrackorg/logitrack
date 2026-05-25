import { useEffect, useRef, useState, useCallback } from "react";
import { Clock, Inbox } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { reportsApi, type TimeWindowBucket } from "../../api/reports";
import { Card } from "../../components/ui/card";
import { ReportExport } from "../../components/ReportExport";
import { toast } from "../../utils/toast";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface VolumenTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

const WINDOW_LABELS: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  flexible: "Flexible",
};

const WINDOW_COLORS: Record<string, string> = {
  morning: "#2563eb",
  afternoon: "#f59e0b",
  flexible: "#22c55e",
};

const WINDOW_ORDER = ["morning", "afternoon", "flexible"];

export default function VolumenTab({ dateFrom, dateTo, branchId }: VolumenTabProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const [total, setTotal] = useState(0);
  const [buckets, setBuckets] = useState<TimeWindowBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: { date_from?: string; date_to?: string; branch_id?: string } = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (branchId) params.branch_id = branchId;

    reportsApi
      .volumeByTimeWindow(params)
      .then((res) => {
        setTotal(res.total);
        setBuckets(res.buckets);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
        toast.error("No se pudieron cargar los datos. Intentá más tarde.");
      });
  }, [dateFrom, dateTo, branchId]);

  const chartData = WINDOW_ORDER.map((w) => {
    const bucket = buckets.find((b) => b.time_window === w);
    const count = bucket?.count ?? 0;
    const pct = total > 0 ? (count / total) * 100 : 0;
    return {
      key: w,
      label: WINDOW_LABELS[w] ?? w,
      count,
      pct,
      fill: WINDOW_COLORS[w] ?? "#94a3b8",
    };
  });

  const exportPDF = useCallback(async () => {
    await exportToPDF(contentRef, `volumen_ventana_horaria_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportExcel = useCallback(() => {
    const rows = chartData.map((d) => ({
      "Ventana Horaria": d.label,
      Cantidad: d.count,
      Porcentaje: total > 0 ? `${d.pct.toFixed(1)}%` : "0%",
    }));
    exportToExcel([{ name: "Volumen por Ventana", data: rows }], `volumen_ventana_horaria_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [chartData, total]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Volumen por Ventana Horaria</h2>
        </div>
        <ReportExport onExportPDF={exportPDF} onExportExcel={exportExcel} loading={loading} />
      </div>

      <div ref={contentRef}>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : error ? (
          <Card className="p-10 text-center">
            <p className="text-sm text-red-600">
              No se pudieron cargar los datos. Intentá más tarde.
            </p>
          </Card>
        ) : total === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Sin datos en este período</p>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {chartData.map((d) => (
                <Card key={d.key} className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: d.fill }}
                    />
                    <span className="text-sm font-medium text-slate-600">{d.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{d.count}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {total > 0 ? `${d.pct.toFixed(1)}% del total` : "—"}
                  </p>
                </Card>
              ))}
            </div>

            {/* Bar chart */}
            <Card className="p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Distribución por Ventana Horaria
              </h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 13, fill: "#475569" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === "count") return [Number(value), "Envíos"];
                      return [Number(value), String(name)];
                    }}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={80}>
                    {chartData.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} />
                    ))}
                    <LabelList
                      dataKey="count"
                      position="top"
                      style={{ fill: "#334155", fontSize: 13, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Detail table */}
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Ventana Horaria
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">
                        Cantidad
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">
                        Porcentaje
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((d) => (
                      <tr
                        key={d.key}
                        className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3 text-slate-700 font-medium">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: d.fill }}
                            />
                            {d.label}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-slate-900 text-right font-semibold tabular-nums">
                          {d.count}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                            {total > 0 ? `${d.pct.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/50 font-semibold">
                      <td className="px-5 py-3 text-slate-900">Total</td>
                      <td className="px-5 py-3 text-slate-900 text-right tabular-nums">{total}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                          100%
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
