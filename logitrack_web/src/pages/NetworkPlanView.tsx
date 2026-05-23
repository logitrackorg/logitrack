import { useEffect, useState } from "react";
import { ArrowRight, TrendingDown, Layers, AlertCircle, RefreshCw, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { routingApi, type GlobalRoutingPlan } from "../api/routing";
import { branchApi, type Branch } from "../api/branches";

function branchLabel(id: string, branches: Branch[]): string {
  return branches.find((b) => b.id === id)?.name ?? id;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

interface NetworkPlanViewProps {
  embedded?: boolean;
}

export function NetworkPlanView({ embedded = false }: NetworkPlanViewProps = {}) {
  const [plan, setPlan] = useState<GlobalRoutingPlan | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [p, b] = await Promise.all([routingApi.getTodayPlan(), branchApi.listActive()]);
      setPlan(p);
      setBranches(b);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setError("No hay plan generado para hoy. Hacé clic en Regenerar para crear uno.");
        setPlan(null);
      } else {
        setError("No se pudo cargar el plan de red.");
      }
    } finally {
      setLoading(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setError("");
    try {
      await routingApi.regenerateGlobal();
      await load();
    } catch {
      setError("Error al regenerar el plan global.");
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const insights = plan?.insights;

  const body = (<>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-slate-600">
            {plan?.plan_date && (
              <>Plan de <strong>{plan.plan_date}</strong> · estado: <strong>{plan.status}</strong></>
            )}
          </div>
          <button
            onClick={() => void regenerate()}
            disabled={regenerating}
            className="h-10 px-4 rounded-lg bg-[#2563eb] text-white text-sm font-medium hover:bg-[#1d4ed8] disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerando…" : "Regenerar plan global"}
          </button>
        </div>

        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Métricas de red */}
        {insights?.metrics && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Vehículos despachados" value={insights.metrics.total_vehicles_dispatched.toString()} />
            <KpiCard label="Envíos asignados" value={insights.metrics.total_shipments_assigned.toString()} tone="green" />
            <KpiCard label="Envíos sin asignar" value={insights.metrics.total_shipments_unassigned.toString()} tone="amber" />
            <KpiCard label="Utilización promedio" value={fmtPct(insights.metrics.avg_vehicle_utilization_pct)} />
            <KpiCard label="Vehículos ociosos" value={insights.metrics.idle_vehicles_count.toString()} tone="slate" />
            <KpiCard label="Sucursales con déficit" value={insights.metrics.branches_with_unserved_demand.toString()} tone="amber" />
          </div>
        )}

        {/* Empty moves */}
        {insights?.empty_moves && insights.empty_moves.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader className="bg-amber-50 rounded-t-xl">
              <CardTitle className="text-amber-900 flex items-center gap-2">
                <TrendingDown className="w-5 h-5" />
                Reposicionamiento sugerido ({insights.empty_moves.length})
              </CardTitle>
              <CardDescription>
                Vehículos ociosos en sucursales con baja demanda que podrían reubicarse a sucursales con
                envíos sin atender. <strong>El reposicionamiento es sin carga</strong> y debe accionarse
                manualmente desde Flota.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              {insights.empty_moves.map((m) => (
                <div key={m.vehicle_id} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-amber-200 bg-amber-50/40">
                  <div className="flex items-center gap-3 min-w-0">
                    <Truck className="w-5 h-5 text-amber-700 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-slate-900 flex items-center gap-2 flex-wrap">
                        <span>{m.license_plate}</span>
                        <span className="text-slate-500 font-normal">({m.capacity_kg} kg)</span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-1 flex-wrap">
                        <span className="font-medium">{branchLabel(m.from_branch_id, branches)}</span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span className="font-medium">{branchLabel(m.to_branch_id, branches)}</span>
                        <span className="text-slate-500">· {m.distance_km.toFixed(0)} km</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-amber-800 text-right whitespace-nowrap flex-shrink-0">
                    <div className="font-semibold tabular-nums">{m.unserved_shipments} envíos</div>
                    <div className="text-amber-600">sin atender</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Consolidation opportunities */}
        {insights?.consolidation_opportunities && insights.consolidation_opportunities.length > 0 && (
          <Card className="border-violet-200">
            <CardHeader className="bg-violet-50 rounded-t-xl">
              <CardTitle className="text-violet-900 flex items-center gap-2">
                <Layers className="w-5 h-5" />
                Oportunidades de consolidación ({insights.consolidation_opportunities.length})
              </CardTitle>
              <CardDescription>
                Destinos que reciben despachos desde múltiples sucursales el mismo día.
                Considerá consolidar via una sucursal intermedia para reducir kilómetros y vehículos.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              {insights.consolidation_opportunities.map((c) => (
                <div key={c.destination_branch_id} className="rounded-lg border border-violet-200 p-3 bg-violet-50/40">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <div className="font-semibold text-slate-900 text-sm">
                      Destino: {branchLabel(c.destination_branch_id, branches)}
                    </div>
                    <div className="text-xs text-violet-800 tabular-nums">
                      Total: {c.total_weight_kg.toFixed(0)} kg · Util prom: {fmtPct(c.avg_fill_rate_pct)}
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    {c.dispatches.map((d) => {
                      const fill = d.capacity_kg > 0 ? (d.total_weight_kg / d.capacity_kg) * 100 : 0;
                      return (
                        <div key={d.vehicle_id} className="text-xs text-slate-700 flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{branchLabel(d.from_branch_id, branches)}</span>
                          <span className="text-slate-400">→</span>
                          <span className="font-mono">{d.license_plate}</span>
                          <span className="text-slate-500 tabular-nums">
                            {d.total_weight_kg.toFixed(0)} / {d.capacity_kg} kg ({fmtPct(fill)})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Per-branch summary */}
        {plan?.branch_plans && plan.branch_plans.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Resumen por sucursal</CardTitle>
              <CardDescription>Conteos del plan para cada sucursal activa.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                      <th className="text-left py-2 px-3 font-medium">Sucursal</th>
                      <th className="text-right py-2 px-3 font-medium">Última milla</th>
                      <th className="text-right py-2 px-3 font-medium">Inter-sucursal</th>
                      <th className="text-right py-2 px-3 font-medium">Sin asignar</th>
                      <th className="text-right py-2 px-3 font-medium">Vehículos en pool</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.branch_plans.map((bp) => (
                      <tr key={bp.branch_id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium">{branchLabel(bp.branch_id, branches)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{bp.plan.last_mile?.length ?? 0}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{bp.plan.inter_branch?.length ?? 0}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {(bp.plan.unassigned?.length ?? 0) > 0 ? (
                            <span className="text-amber-600">{bp.plan.unassigned.length}</span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{bp.plan.vehicle_loads?.length ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

    {loading && !plan && (
      <div className="text-center py-10 text-slate-500 text-sm">Cargando plan…</div>
    )}
  </>);

  if (embedded) {
    return <div className="space-y-6">{body}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {body}
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "slate" }) {
  const toneClasses: Record<string, string> = {
    green: "text-emerald-600",
    amber: "text-amber-600",
    slate: "text-slate-500",
  };
  const valueClass = tone ? toneClasses[tone] : "";
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-[11px] text-slate-500 mb-1 uppercase tracking-wide">{label}</div>
        <div className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
