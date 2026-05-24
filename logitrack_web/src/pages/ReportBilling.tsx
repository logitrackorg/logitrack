import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { DollarSign, TrendingUp, TrendingDown, Receipt, Inbox } from "lucide-react";
import { reportsApi, type BillingMetricsResponse } from "../api/reports";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/page-header";
import { Breadcrumb } from "../components/Breadcrumb";
import { Card } from "../components/ui/card";
import { GradientCard, GradientCardLabel, GradientCardValue, GradientCardIcon } from "../components/ui/gradient-card";
import { StatCard } from "../components/ui/stat-card";
import { Sparkline, type SparklineDataPoint } from "../components/charts/Sparkline";
import { ReportFilters } from "../components/ReportFilters";
import { ReportExport } from "../components/ReportExport";
import { defaultRange, Skeleton } from "../utils/dashboard";
import { exportToPDF, exportToExcel } from "../utils/exportHelpers";

function formatARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ReportBilling() {
  const { user, hasRole } = useAuth();
  const contentRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<BillingMetricsResponse | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const range = defaultRange();
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [selectedBranch, setSelectedBranch] = useState("");

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
    setError(false);
    const params: { date_from?: string; date_to?: string; branch_id?: string } = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (effectiveBranch) params.branch_id = effectiveBranch;

    reportsApi
      .billingMetrics(params)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [dateFrom, dateTo, effectiveBranch]);

  const sparklineData = useMemo<SparklineDataPoint[]>(() => {
    if (!data?.by_period) return [];
    return Object.entries(data.by_period)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, revenue]) => ({ x: period, y: revenue }));
  }, [data]);

  const variationPct = useMemo(() => {
    if (!data?.by_period) return null;
    const sorted = Object.entries(data.by_period).sort(([a], [b]) => a.localeCompare(b));
    if (sorted.length < 2) return null;
    const prev = sorted[sorted.length - 2][1];
    const curr = sorted[sorted.length - 1][1];
    if (prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  }, [data]);

  const branchRows = useMemo(() => {
    if (!data?.by_branch) return [];
    return Object.entries(data.by_branch).map(([branchId, billing]) => {
      const branch = branches.find((b) => b.id === branchId);
      return {
        branchId,
        branchName: branch ? branch.name : branchId,
        ...billing,
      };
    });
  }, [data, branches]);

  const exportPDF = useCallback(async () => {
    setExporting(true);
    await exportToPDF(contentRef, `facturacion_${new Date().toISOString().slice(0, 10)}.pdf`);
    setExporting(false);
  }, []);

  const exportExcel = useCallback(() => {
    if (!data) return;
    const rows = branchRows.map((r) => ({
      Sucursal: r.branchName,
      "Total Facturado": r.revenue,
      "Ticket Promedio": r.avg_ticket,
      "Cantidad Envíos": r.count,
    }));
    exportToExcel([{ name: "Facturación por Sucursal", data: rows }], `facturacion_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [data, branchRows]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto" ref={contentRef}>
      <Breadcrumb
        items={[
          { label: "Dashboard", to: "/dashboard" },
          { label: "Métricas de Facturación" },
        ]}
      />

      <PageHeader
        title="Métricas de Facturación"
        description="Ingresos y ticket promedio por sucursal"
        icon={<DollarSign className="w-5 h-5" />}
        actions={
          <div className="flex items-center gap-2">
            <ReportFilters
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              selectedBranch={selectedBranch}
              onBranchChange={setSelectedBranch}
              branches={branches}
              isSupervisor={isSupervisor}
            />
            <ReportExport
              onExportPDF={exportPDF}
              onExportExcel={exportExcel}
              loading={exporting}
            />
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
        </Card>
      ) : !data ? (
        <Card className="p-10 text-center">
          <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Sin datos en este período</p>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <GradientCard tone="brand" className="flex items-center gap-4">
              <GradientCardIcon>
                <DollarSign className="w-5 h-5" />
              </GradientCardIcon>
              <div className="flex-1 min-w-0">
                <GradientCardLabel>Total Facturado</GradientCardLabel>
                <GradientCardValue>{formatARS(data.total_revenue)}</GradientCardValue>
              </div>
              {sparklineData.length > 1 && (
                <Sparkline data={sparklineData} width={100} height={36} color="rgba(255,255,255,0.7)" strokeWidth={2.5} />
              )}
            </GradientCard>

            <GradientCard tone="emerald" className="flex items-center gap-4">
              <GradientCardIcon>
                <Receipt className="w-5 h-5" />
              </GradientCardIcon>
              <div className="flex-1 min-w-0">
                <GradientCardLabel>Ticket Promedio</GradientCardLabel>
                <GradientCardValue>{data.avg_ticket !== null ? formatARS(data.avg_ticket) : "—"}</GradientCardValue>
              </div>
              {sparklineData.length > 1 && (
                <Sparkline data={sparklineData} width={100} height={36} color="rgba(255,255,255,0.7)" strokeWidth={2.5} />
              )}
            </GradientCard>

            <StatCard
              label="Variación período"
              value={
                variationPct !== null ? (
                  <span className="inline-flex items-center gap-1">
                    {variationPct >= 0 ? (
                      <TrendingUp className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-rose-600" />
                    )}
                    {variationPct >= 0 ? "+" : ""}
                    {variationPct.toFixed(1)}%
                  </span>
                ) : (
                  "—"
                )
              }
              hint={variationPct !== null ? "vs. período anterior" : undefined}
              icon={<TrendingUp className="w-4 h-4" />}
              tone={variationPct !== null && variationPct >= 0 ? "success" : variationPct !== null ? "danger" : "default"}
            />
          </div>

          {/* Revenue by Branch Table */}
          {branchRows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">Facturación por Sucursal</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Sucursal</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Total Facturado</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Ticket Promedio</th>
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Cantidad Envíos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchRows.map((row) => (
                      <tr
                        key={row.branchId}
                        className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3 text-slate-700 font-medium">{row.branchName}</td>
                        <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{formatARS(row.revenue)}</td>
                        <td className="px-5 py-3 text-slate-900 text-right tabular-nums">{formatARS(row.avg_ticket)}</td>
                        <td className="px-5 py-3 text-slate-900 text-right tabular-nums">{row.count}</td>
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