import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { branchApi, type Branch } from "../api/branches";
import { routingMetricsApi, type RoutingMetricsSummary } from "../api/routingMetrics";

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
  return {
    from: thirtyDaysAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function branchLabel(id: string, branches: Branch[]): string {
  return branches.find((b) => b.id === id)?.name ?? id;
}

export function RoutingMetrics({ embedded = false }: { embedded?: boolean } = {}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [{ from, to }, setRange] = useState(defaultRange);
  const [summary, setSummary] = useState<RoutingMetricsSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    branchApi.listActive().then(setBranches).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await routingMetricsApi.getSummary({
        branchId: branchFilter || undefined,
        from,
        to,
      });
      setSummary(resp.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudieron cargar las métricas.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter, from, to]);

  // KPIs agregados sobre el rango filtrado
  const kpis = useMemo(() => {
    if (summary.length === 0) {
      return { plans: 0, applied: 0, failed: 0, drift: 0, avgGenMs: 0, avgUnassignedPct: 0, avgWindowCov: 0, avgOverride: 0 };
    }
    const plans = summary.reduce((s, r) => s + r.plan_count, 0);
    const applied = summary.reduce((s, r) => s + r.total_applied, 0);
    const failed = summary.reduce((s, r) => s + r.total_failed, 0);
    const drift = summary.reduce((s, r) => s + r.total_drift, 0);
    const rowsWithGen = summary.filter((r) => r.plan_count > 0);
    const avgGenMs =
      rowsWithGen.length === 0
        ? 0
        : rowsWithGen.reduce((s, r) => s + r.avg_gen_time_ms * r.plan_count, 0) /
          rowsWithGen.reduce((s, r) => s + r.plan_count, 0);
    const avgUnassignedPct =
      rowsWithGen.length === 0
        ? 0
        : rowsWithGen.reduce((s, r) => s + r.avg_unassigned_pct * r.plan_count, 0) /
          rowsWithGen.reduce((s, r) => s + r.plan_count, 0);
    const rowsWithCov = summary.filter((r) => r.avg_window_coverage_pct > 0);
    const avgWindowCov =
      rowsWithCov.length === 0
        ? 0
        : rowsWithCov.reduce((s, r) => s + r.avg_window_coverage_pct, 0) / rowsWithCov.length;
    const rowsWithApply = summary.filter((r) => r.total_applied > 0 || r.total_failed > 0);
    const avgOverride =
      rowsWithApply.length === 0
        ? 0
        : rowsWithApply.reduce((s, r) => s + r.avg_override_count, 0) / rowsWithApply.length;
    return { plans, applied, failed, drift, avgGenMs, avgUnassignedPct, avgWindowCov, avgOverride };
  }, [summary]);

  const body = (<>
        {/* Filtros */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Sucursal</label>
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] min-w-[200px]"
                >
                  <option value="">Todas</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Desde</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Hasta</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm tabular-nums"
                />
              </div>
              <button
                onClick={() => void load()}
                disabled={loading}
                className="h-10 px-4 rounded-lg bg-[#2563eb] text-white text-sm font-medium hover:bg-[#1d4ed8] disabled:opacity-50 flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refrescar
              </button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-slate-500 mb-1">Planes generados</div>
              <div className="text-2xl font-bold tabular-nums">{kpis.plans}</div>
              <div className="text-xs text-slate-500 mt-2">Tiempo prom: {fmtMs(kpis.avgGenMs)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-slate-500 mb-1">Envíos aplicados</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-600">{kpis.applied}</div>
              <div className="text-xs text-slate-500 mt-2">Fallidos: {kpis.failed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-slate-500 mb-1">Drift (cambios entre Generate y Apply)</div>
              <div className="text-2xl font-bold tabular-nums text-amber-600">{kpis.drift}</div>
              <div className="text-xs text-slate-500 mt-2">
                Override prom: {kpis.avgOverride.toFixed(1)} envíos
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-xs text-slate-500 mb-1">Calidad última milla (VRP)</div>
              <div className="text-2xl font-bold tabular-nums">{fmtPct(kpis.avgWindowCov)}</div>
              <div className="text-xs text-slate-500 mt-2">Cobertura ventana horaria</div>
            </CardContent>
          </Card>
        </div>

        {/* Tabla por día/sucursal */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Resumen diario
            </CardTitle>
            <CardDescription>
              Una fila por día y sucursal. Muestra calidad del plan y resultado del apply.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">
                {loading ? "Cargando..." : "Sin datos en el rango seleccionado."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                      <th className="text-left py-2 px-3 font-medium">Fecha</th>
                      <th className="text-left py-2 px-3 font-medium">Sucursal</th>
                      <th className="text-right py-2 px-3 font-medium">Planes</th>
                      <th className="text-right py-2 px-3 font-medium">Tiempo gen.</th>
                      <th className="text-right py-2 px-3 font-medium">% sin asignar</th>
                      <th className="text-right py-2 px-3 font-medium">Cobertura ventana</th>
                      <th className="text-right py-2 px-3 font-medium">Aplicados</th>
                      <th className="text-right py-2 px-3 font-medium">Fallidos</th>
                      <th className="text-right py-2 px-3 font-medium">Drift</th>
                      <th className="text-right py-2 px-3 font-medium">Override prom.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row, i) => (
                      <tr key={`${row.date}-${row.branch_id}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 tabular-nums">{row.date}</td>
                        <td className="py-2 px-3">{branchLabel(row.branch_id, branches)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{row.plan_count}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{fmtMs(row.avg_gen_time_ms)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {row.plan_count > 0 ? fmtPct(row.avg_unassigned_pct) : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {row.avg_window_coverage_pct > 0 ? fmtPct(row.avg_window_coverage_pct) : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{row.total_applied}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {row.total_failed > 0 ? <span className="text-red-600">{row.total_failed}</span> : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {row.total_drift > 0 ? <span className="text-amber-600">{row.total_drift}</span> : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {row.avg_override_count > 0 ? row.avg_override_count.toFixed(1) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
  </>);

  if (embedded) {
    return <div className="space-y-6">{body}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">{body}</div>
    </div>
  );
}
