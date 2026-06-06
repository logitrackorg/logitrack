import { useEffect, useMemo, useState } from "react";
import { TrendingUp, AlertCircle, RefreshCw, Lock, Eye } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { routingForecastApi, type RollingHorizonPlan, type ForecastQuality } from "../api/routingForecast";
import { branchApi, type Branch } from "../api/branches";

function branchLabel(id: string, branches: Branch[]): string {
  return branches.find((b) => b.id === id)?.name ?? id;
}

const SPANISH_WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function fmtDateLabel(iso: string): { day: string; weekday: string } {
  // iso = YYYY-MM-DD. Construir Date sin shift de zona.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayMonth = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  return { day: dayMonth, weekday: SPANISH_WEEKDAYS[dt.getDay()] };
}

const confColors: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
  none: "bg-slate-100 text-slate-400",
};

export function RollingPlanView({ embedded = false }: { embedded?: boolean } = {}) {
  const [plan, setPlan] = useState<RollingHorizonPlan | null>(null);
  const [quality, setQuality] = useState<ForecastQuality | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [horizon, setHorizon] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [p, q, b] = await Promise.all([
        routingForecastApi.getRollingPlan(horizon),
        routingForecastApi.getQuality(),
        branchApi.listActive(),
      ]);
      setPlan(p);
      setQuality(q);
      setBranches(b);
    } catch {
      setError("No se pudo cargar el rolling horizon plan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon]);

  const maxShipments = useMemo(() => {
    if (!plan?.days) return 1;
    return Math.max(1, ...plan.days.map((d) => d.summary.total_expected_shipments));
  }, [plan]);

  const body = (<>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600">Horizonte:</label>
            <select
              value={horizon}
              onChange={(e) => setHorizon(parseInt(e.target.value, 10))}
              className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm"
            >
              <option value={3}>3 días</option>
              <option value={5}>5 días</option>
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
            </select>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refrescar
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Forecast quality */}
        {quality && quality.sample_size > 0 && (
          <Card className="border-slate-200">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-slate-500" />
                  <div>
                    <div className="text-xs text-slate-500">Calidad del forecast (backtest 14 días)</div>
                    <div className="text-sm">
                      MAPE: <strong className={quality.mape <= 30 ? "text-emerald-700" : quality.mape <= 50 ? "text-amber-700" : "text-red-700"}>{quality.mape.toFixed(1)}%</strong>
                      <span className="text-slate-500 ml-2">({quality.sample_size} observaciones, {quality.od_pairs_covered} pares O-D)</span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {quality.mape <= 30 ? "✓ Usable" : quality.mape <= 50 ? "⚠ Margen alto" : "⚠ Modelo no usable"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Gantt-style days */}
        {plan?.days && plan.days.length > 0 && (
          <div className="grid gap-3">
            {plan.days.map((day) => {
              const { day: dayLabel, weekday } = fmtDateLabel(day.date);
              const barWidth = Math.min(100, (day.summary.total_expected_shipments / maxShipments) * 100);
              return (
                <Card
                  key={day.date}
                  className={day.is_firm ? "border-emerald-300" : "border-slate-200"}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="grid grid-cols-[120px_1fr_auto] gap-4 items-center">
                      {/* Fecha */}
                      <div className="flex flex-col">
                        <div className="text-xs text-slate-500 uppercase">{weekday}</div>
                        <div className="text-lg font-bold tabular-nums">{dayLabel}</div>
                        <div className="mt-1">
                          {day.is_firm ? (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                              <Lock className="w-3 h-3" />
                              Firm
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                              <Eye className="w-3 h-3" />
                              Forecast
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Barra + detalle */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              ref={el => { if (el) el.style.width = `${barWidth}%`; }}
                              className={`h-full ${day.is_firm ? "bg-emerald-500" : "bg-slate-400"}`}
                            />
                          </div>
                          <div className="text-sm tabular-nums whitespace-nowrap">
                            <strong>{day.summary.total_expected_shipments}</strong> envíos
                          </div>
                        </div>
                        {day.expected_by_od_pair.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {day.expected_by_od_pair.slice(0, 6).map((b, i) => (
                              <span
                                key={i}
                                className={`text-[11px] px-2 py-0.5 rounded ${confColors[b.confidence] || "bg-slate-100"}`}
                                title={`${b.expected_shipments.toFixed(1)} envíos · ${b.expected_weight_kg.toFixed(0)} kg · confianza: ${b.confidence}`}
                              >
                                {branchLabel(b.origin_branch_id, branches)} → {branchLabel(b.destination_branch_id, branches)}
                                <span className="ml-1 font-medium">{Math.round(b.expected_shipments)}</span>
                              </span>
                            ))}
                            {day.expected_by_od_pair.length > 6 && (
                              <span className="text-[11px] px-2 py-0.5 text-slate-500">
                                +{day.expected_by_od_pair.length - 6} más
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Métricas del día */}
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Peso esperado</div>
                        <div className="text-sm tabular-nums font-medium">{day.summary.total_expected_weight_kg.toFixed(0)} kg</div>
                        <div className="text-xs text-slate-500 mt-2">Vehículos estim.</div>
                        <div className="text-sm tabular-nums font-medium">{day.summary.estimated_vehicles_needed}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {loading && !plan && (
          <div className="text-center py-10 text-slate-500 text-sm">Cargando rolling plan…</div>
        )}

    <div className="text-xs text-slate-500 mt-6 px-2">
      <strong>Modelo:</strong> promedio por día de semana sobre últimos 90 días. Sin ML — estadística pura.{" "}
      Banda de confianza = ± 1σ. Predicciones marcadas "high" cuando hay ≥12 observaciones del mismo día de semana.
    </div>
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
