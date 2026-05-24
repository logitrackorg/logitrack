import { useEffect, useState, useCallback, useRef } from "react";
import { Users, Trophy, Percent } from "lucide-react";
import { reportsApi, type DriverPerformanceItem } from "../api/reports";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/page-header";
import { Breadcrumb } from "../components/Breadcrumb";
import { Card } from "../components/ui/card";
import { StatCard } from "../components/ui/stat-card";
import { ReportFilters } from "../components/ReportFilters";
import { ReportExport } from "../components/ReportExport";
import { defaultRange, Skeleton } from "../utils/dashboard";
import { exportToPDF, exportToExcel } from "../utils/exportHelpers";

function successBadge(rate: number | null): { bg: string; text: string; label: string } {
  if (rate === null) return { bg: "bg-slate-100", text: "text-slate-600", label: "—" };
  if (rate > 90) return { bg: "bg-emerald-100", text: "text-emerald-700", label: `${rate.toFixed(1)}%` };
  if (rate >= 70) return { bg: "bg-amber-100", text: "text-amber-700", label: `${rate.toFixed(1)}%` };
  return { bg: "bg-rose-100", text: "text-rose-700", label: `${rate.toFixed(1)}%` };
}

export function ReportDrivers() {
  const { user, hasRole } = useAuth();
  const [drivers, setDrivers] = useState<DriverPerformanceItem[]>([]);
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

  const contentRef = useRef<HTMLDivElement>(null);

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
      .driverPerformance(params)
      .then((data) => {
        setDrivers(data.drivers);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [dateFrom, dateTo, effectiveBranch]);

  const bestDriver = drivers.length > 0
    ? drivers.reduce((best, d) => {
        if (d.success_rate === null) return best;
        if (best.success_rate === null) return d;
        return d.success_rate > best.success_rate ? d : best;
      })
    : null;

  const avgSuccessRate = drivers.length > 0
    ? drivers.reduce((sum, d) => sum + (d.success_rate ?? 0), 0) / drivers.length
    : null;

  const exportPDF = useCallback(async () => {
    setExporting(true);
    await exportToPDF(contentRef, `rendimiento_choferes_${new Date().toISOString().slice(0, 10)}.pdf`);
    setExporting(false);
  }, []);

  const exportExcel = useCallback(() => {
    const rows = drivers.map((d) => ({
      Chofer: d.driver_name,
      Sucursal: d.branch_name,
      Asignados: d.total_assigned,
      Entregados: d.delivered,
      Fallidos: d.delivery_failed,
      "Éxito %": d.success_rate !== null ? d.success_rate.toFixed(1) : "\u2014",
      "Promedio horas": d.avg_delivery_hours !== null ? d.avg_delivery_hours.toFixed(1) : "\u2014",
    }));
    exportToExcel([{ name: "Rendimiento Choferes", data: rows }], `rendimiento_choferes_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [drivers]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto" ref={contentRef}>
      <Breadcrumb
        items={[
          { label: "Dashboard", to: "/dashboard" },
          { label: "Rendimiento de Choferes" },
        ]}
      />

      <PageHeader
        title="Rendimiento de Choferes"
        description="Métricas operativas por chofer"
        icon={<Users className="w-5 h-5" />}
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
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
        </Card>
      ) : drivers.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">No hay datos para el período seleccionado.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard
              label="Total choferes"
              value={drivers.length}
              icon={<Users className="w-4 h-4" />}
              tone="default"
            />
            <StatCard
              label="Éxito promedio"
              value={avgSuccessRate !== null ? `${avgSuccessRate.toFixed(1)}%` : "—"}
              icon={<Percent className="w-4 h-4" />}
              tone={avgSuccessRate !== null && avgSuccessRate > 90 ? "success" : avgSuccessRate !== null && avgSuccessRate >= 70 ? "warning" : "danger"}
            />
            <StatCard
              label="Mejor chofer"
              value={bestDriver?.driver_name ?? "—"}
              hint={bestDriver?.success_rate !== null && bestDriver?.success_rate !== undefined ? `${bestDriver.success_rate.toFixed(1)}% de éxito` : undefined}
              icon={<Trophy className="w-4 h-4" />}
              tone="success"
            />
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Chofer</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Sucursal</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Asignados</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Entregados</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">Fallidos</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider text-right">% Éxito</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => {
                    const badge = successBadge(d.success_rate);
                    const isBest = bestDriver?.driver_id === d.driver_id;
                    return (
                      <tr
                        key={d.driver_id}
                        className={`border-b border-slate-100 transition-colors ${
                          isBest ? "bg-blue-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-5 py-3 text-slate-700 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {isBest && <Trophy className="w-4 h-4 text-amber-500 shrink-0" />}
                            {d.driver_name}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{d.branch_name}</td>
                        <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{d.total_assigned}</td>
                        <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{d.delivered}</td>
                        <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">{d.delivery_failed}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
