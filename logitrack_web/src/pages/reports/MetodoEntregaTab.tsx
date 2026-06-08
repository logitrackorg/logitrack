import { useEffect, useRef, useState, useCallback } from "react";
import { Truck, Inbox } from "lucide-react";
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
import { reportsApi, type DeliveryMethodBucket } from "../../api/reports";
import { Card } from "../../components/ui/card";
import { Doughnut, type DoughnutDataItem } from "../../components/charts/Doughnut";
import { ReportExport } from "../../components/ReportExport";
import { toast } from "../../utils/toast";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface MetodoEntregaTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

const METHOD_LABELS: Record<string, string> = {
  ultima_milla: "Última milla",
  retiro_sucursal: "Retiro en sucursal",
};

const METHOD_COLORS: Record<string, string> = {
  ultima_milla: "var(--brand)",
  retiro_sucursal: "#22c55e",
};

const METHOD_BG: Record<string, string> = {
  ultima_milla: "bg-blue-600",
  retiro_sucursal: "bg-green-500",
};

const METHOD_ORDER = ["ultima_milla", "retiro_sucursal"];

export default function MetodoEntregaTab({ dateFrom, dateTo, branchId }: MetodoEntregaTabProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const [total, setTotal] = useState(0);
  const [buckets, setBuckets] = useState<DeliveryMethodBucket[]>([]);
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
      .volumeByDeliveryMethod(params)
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

  const chartData = METHOD_ORDER.map((m) => {
    const bucket = buckets.find((b) => b.delivery_method === m);
    const count = bucket?.count ?? 0;
    const pct = total > 0 ? (count / total) * 100 : 0;
    return {
      key: m,
      label: METHOD_LABELS[m] ?? m,
      count,
      pct,
      fill: METHOD_COLORS[m] ?? "#94a3b8",
      bgClass: METHOD_BG[m] ?? "bg-slate-400",
    };
  });

  const doughnutData: DoughnutDataItem[] = chartData
    .filter((d) => d.count > 0)
    .map((d) => ({ name: d.label, value: d.count, color: d.fill }));

  const exportPDF = useCallback(async () => {
    await exportToPDF(contentRef, `metodo_entrega_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportExcel = useCallback(() => {
    const rows = chartData.map((d) => ({
      "Método de entrega": d.label,
      Cantidad: d.count,
      Porcentaje: total > 0 ? `${d.pct.toFixed(1)}%` : "0%",
    }));
    exportToExcel(
      [{ name: "Distribución por método", data: rows }],
      `metodo_entrega_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }, [chartData, total]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Distribución por método de entrega</h2>
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
            <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá más tarde.</p>
          </Card>
        ) : total === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No hay datos disponibles para el período seleccionado</p>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {chartData.map((d) => (
                <Card key={d.key} className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${d.bgClass}`} />
                    <span className="text-sm font-medium text-slate-600">{d.label}</span>
                  </div>
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{d.count}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {total > 0 ? `${d.pct.toFixed(1)}% del total` : "—"}
                  </p>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="text-base font-semibold text-slate-900 mb-4">Composición</h3>
                <div className="flex items-center justify-center">
                  <Doughnut data={doughnutData} centerLabel="Total" centerValue={total} />
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="text-base font-semibold text-slate-900 mb-4">Cantidades</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
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
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={80}>
                      {chartData.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="top"
                        className="fill-slate-700 text-[13px] font-semibold"
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Método de entrega
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
                      <tr key={d.key} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 text-slate-700 font-medium">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${d.bgClass}`}
                            />
                            {d.label}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-slate-900 text-right font-semibold tabular-nums">{d.count}</td>
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
