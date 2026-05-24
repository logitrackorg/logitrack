import { useEffect, useRef, useState, useCallback } from "react";
import { Inbox } from "lucide-react";
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
import { reportsApi, type SuccessRateByBranchItem } from "../../api/reports";
import { Card } from "../../components/ui/card";
import { ReportExport } from "../../components/ReportExport";
import { toast } from "../../utils/toast";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface ExitoTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function ExitoTab({ dateFrom, dateTo, branchId }: ExitoTabProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<SuccessRateByBranchItem[]>([]);
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
      .successRateByBranch(params)
      .then((res) => {
        setData(res.branches);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
        toast.error("No se pudieron cargar los datos. Intentá más tarde.");
      });
  }, [dateFrom, dateTo, branchId]);

  const chartData = data.map((b) => ({
    name: b.branch_name,
    success: b.success_rate,
    failure: 100 - b.success_rate,
    successRate: b.success_rate,
    total: b.total,
    delivered: b.delivered,
    failed: b.failed,
  }));

  const exportPDF = useCallback(async () => {
    await exportToPDF(contentRef, `tasa_exito_sucursal_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportExcel = useCallback(() => {
    const rows = data.map((b) => ({
      Sucursal: b.branch_name,
      Total: b.total,
      Entregados: b.delivered,
      Fallidos: b.failed,
      "Tasa de \u00c9xito (%)": b.success_rate,
    }));
    exportToExcel([{ name: "Tasa de \u00c9xito", data: rows }], `tasa_exito_sucursal_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tasa de Éxito por Sucursal</h2>
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
        ) : data.length === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Sin datos en este período</p>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Distribución por Sucursal
              </h2>
              <ResponsiveContainer width="100%" height={chartData.length * 48 + 32}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 60, left: 8, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 12 }}
                    stroke="#94a3b8"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fontSize: 13 }}
                    stroke="#64748b"
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      const v = Number(value);
                      if (name === "success") return [`${v.toFixed(1)}%`, "Entregados"];
                      return [`${v.toFixed(1)}%`, "Fallidos"];
                    }}
                  />
                  <Bar
                    dataKey="success"
                    stackId="rate"
                    radius={[4, 0, 0, 4]}
                  >
                    {chartData.map((_entry) => (
                      <Cell key={_entry.name} fill="#22c55e" />
                    ))}
                    <LabelList
                      dataKey="successRate"
                      position="center"
                      formatter={(v) => `${Number(v).toFixed(1)}%`}
                      style={{ fill: "#fff", fontSize: 12, fontWeight: 600 }}
                    />
                  </Bar>
                  <Bar
                    dataKey="failure"
                    stackId="rate"
                    radius={[0, 4, 4, 0]}
                  >
                    {chartData.map((_entry) => (
                      <Cell key={`${_entry.name}-failure`} fill="#ef4444" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        Sucursal
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">
                        Total
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">
                        Entregados
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">
                        Fallidos
                      </th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">
                        % Éxito
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((b) => (
                      <tr
                        key={b.branch_id}
                        className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3 text-slate-700 font-medium">
                          {b.branch_name}
                        </td>
                        <td className="px-5 py-3 text-slate-900 text-right font-semibold">
                          {b.total}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="text-green-600 font-medium">{b.delivered}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="text-red-600 font-medium">{b.failed}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                              b.success_rate >= 90
                                ? "bg-green-50 text-green-700"
                                : b.success_rate >= 70
                                  ? "bg-yellow-50 text-yellow-700"
                                  : "bg-red-50 text-red-700"
                            }`}
                          >
                            {b.success_rate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
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
