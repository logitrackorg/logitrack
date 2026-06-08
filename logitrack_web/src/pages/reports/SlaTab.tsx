import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  AlertCircle, RefreshCw, ShieldCheck, ShieldAlert,
  TrendingDown, TrendingUp, CheckCircle2, Zap, Brain,
  ChevronDown, ChevronUp, UserPlus, UserMinus, Info, MapPin,
} from "lucide-react";
import type { FleetStatus, FleetDiagnosis, BranchFleetDiagnosis } from "../../api/slaMetrics";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { slaMetricsApi, type SLAMetrics } from "../../api/slaMetrics";
import { branchApi, branchLabelById, type Branch } from "../../api/branches";
import { useAuth } from "../../context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { SelectMenu } from "../../components/ui/SelectMenu";
import { Skeleton } from "../../utils/dashboard";
import { ReportExport } from "../../components/ReportExport";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

// ── Palette ──────────────────────────────────────────────────────────────────
const COLOR_OK   = "#22c55e";
const COLOR_WARN = "#f59e0b";
const COLOR_BAD  = "#ef4444";
const COLOR_LINE = "#2563eb";

function healthColor(rate: number): string {
  if (rate >= 90) return COLOR_OK;
  if (rate >= 75) return COLOR_WARN;
  return COLOR_BAD;
}

// ── Custom tooltips ───────────────────────────────────────────────────────────
function BarTooltip({ active, payload, label }: {
  active?: boolean; payload?: { dataKey?: string; value: number }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const atRisk = payload.find((p) => p.dataKey === "at_risk_count")?.value ?? 0;
  const delayed = payload.find((p) => p.dataKey === "delayed_count")?.value ?? 0;
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
      <p className="font-semibold text-[var(--text-primary)] mb-1">{label}</p>
      <p className="font-bold" style={{ color: COLOR_WARN }}>{atRisk} comprometido{atRisk !== 1 ? "s" : ""} (en riesgo)</p>
      <p className="font-bold" style={{ color: COLOR_BAD }}>{delayed} demorado{delayed !== 1 ? "s" : ""} (SLA roto)</p>
    </div>
  );
}

function LineTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  const [, mm, dd] = (label ?? "").split("-");
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-[var(--text-primary)] mb-1">{dd}/{mm}</p>
      <p className="text-[#2563eb] font-bold">{payload[0].value} escalado{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

interface SlaTabProps {
  /** Sucursal del filtro global del Dashboard ("" = todas). Acota únicamente
   *  las tarjetas/gráficos de SLA (tasa de cumplimiento, comprometidos,
   *  demorados, cuellos de botella) — el "Diagnóstico de flota" mantiene su
   *  propio selector de sucursal, independiente de este filtro. */
  branchId: string;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SlaTab({ branchId }: SlaTabProps) {
  const { user, hasRole } = useAuth();
  const [metrics, setMetrics] = useState<SLAMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  const isSupervisor = hasRole("supervisor") && !hasRole("manager", "admin");

  const load = () => {
    setLoading(true);
    setError(false);
    const params: { branch_id?: string } = {};
    if (branchId) params.branch_id = branchId;
    slaMetricsApi
      .get(params)
      .then((data) => { setMetrics(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  };

  useEffect(() => { load(); }, [branchId]);
  useEffect(() => { branchApi.listActive().then(setBranches).catch(() => {}); }, []);

  // Sucursal por defecto: la propia para supervisores, la primera del plan para managers/admins.
  useEffect(() => {
    if (selectedBranchId || !metrics?.fleet_diagnoses.length) return;
    if (isSupervisor && user?.branch_id) {
      setSelectedBranchId(user.branch_id);
    } else {
      setSelectedBranchId(metrics.fleet_diagnoses[0].branch_id);
    }
  }, [metrics, isSupervisor, user, selectedBranchId]);

  const branchDiag: BranchFleetDiagnosis | null = useMemo(() => {
    if (!metrics?.fleet_diagnoses.length) return null;
    return metrics.fleet_diagnoses.find((d) => d.branch_id === selectedBranchId)
        ?? metrics.fleet_diagnoses[0];
  }, [metrics, selectedBranchId]);

  const contentRef = useRef<HTMLDivElement>(null);

  const exportPDF = useCallback(async () => {
    await exportToPDF(contentRef, `metricas_sla_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, []);

  const exportExcel = useCallback(() => {
    if (!metrics || !branchDiag) return;
    const date = new Date().toISOString().slice(0, 10);
    const heurM = branchDiag.heuristic_diagnosis.raw_metrics;
    exportToExcel(
      [
        {
          name: "Diagnóstico",
          data: [
            {
              Sucursal: branchDiag.branch_name,
              Modelo:   "Heurística",
              Estado:   branchDiag.heuristic_diagnosis.status,
              Mensaje:  branchDiag.heuristic_diagnosis.message,
            },
            ...(branchDiag.ml_prediction
              ? [{
                  Sucursal:        branchDiag.branch_name,
                  Modelo:          "Random Forest",
                  Estado:          branchDiag.ml_prediction.status,
                  Mensaje:         branchDiag.ml_prediction.message,
                  "Confianza (%)": Math.round((branchDiag.ml_prediction.confidence ?? 0) * 100),
                }]
              : []),
          ],
        },
        {
          name: "KPIs SLA",
          data: [{
            Sucursal:                    branchDiag.branch_name,
            "Tasa cumplimiento SLA (%)": metrics.sla_health_rate.toFixed(1),
            "Envíos demorados":          metrics.delayed_total,
            "Envíos activos":            metrics.active_total,
            ...(heurM
              ? {
                  "Tasa demora sucursal (%)": heurM.sla_delay_pct.toFixed(1),
                  "Choferes activos":         heurM.active_drivers,
                  "Choferes sin ruta":        heurM.idle_drivers,
                  "Envíos huérfanos":         heurM.orphan_shipments,
                }
              : {}),
          }],
        },
        {
          name: "Cuellos de botella",
          data: metrics.bottlenecks.map((b) => ({
            Estado: b.status,
            "Cant. comprometidos (en riesgo)": b.at_risk_count,
            "Cant. demorados (SLA roto)":      b.delayed_count,
          })),
        },
        {
          name: "Tendencia 7 días",
          data: metrics.delay_trend.map((d) => ({ Fecha: d.date, Escalados: d.count })),
        },
        ...(metrics.current_averages?.some((a) => a.has_data)
          ? [{
              name: "Prom. por estado",
              data: metrics.current_averages.filter((a) => a.has_data).map((a) => ({
                Estado:           a.status,
                "Horas promedio": a.avg_hours.toFixed(1),
              })),
            }]
          : []),
      ],
      `metricas_sla_${date}.xlsx`,
    );
  }, [metrics, branchDiag]);

  const branchesByProvince = branches.reduce<Record<string, Branch[]>>((acc, b) => {
    const prov = b.address.province;
    if (!acc[prov]) acc[prov] = [];
    acc[prov].push(b);
    return acc;
  }, {});
  const sortedProvinces = Object.keys(branchesByProvince).sort((a, b) => a.localeCompare(b));
  for (const prov of sortedProvinces) {
    branchesByProvince[prov].sort((a, b) => a.name.localeCompare(b.name));
  }
  const selectedBranchLabel = (() => {
    const b = branches.find((br) => br.id === selectedBranchId);
    return b ? b.name : "Tu sucursal";
  })();

  if (loading) return <Skeleton className="h-96" />;

  if (error || !metrics) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
        <AlertCircle className="w-8 h-8 text-rose-400" />
        <p className="text-sm">No se pudieron cargar las métricas SLA.</p>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reintentar
        </button>
      </div>
    );
  }

  const rate      = metrics.sla_health_rate;
  const hue       = healthColor(rate);
  const ShieldIcon = rate >= 90 ? ShieldCheck : ShieldAlert;

  // Tasa de envíos en riesgo: % de los activos que están "comprometidos"
  // (superaron el 100% del promedio base pero no el 150% de tolerancia).
  // Solo informativa — no penaliza sla_health_rate (eso es exclusivo de "demorados").
  const riskRate = metrics.active_total > 0
    ? Math.round((metrics.at_risk_total / metrics.active_total) * 1000) / 10
    : 0;

  const trendData = metrics.delay_trend.map((d) => {
    const [, mm, dd] = d.date.split("-");
    return { ...d, label: `${dd}/${mm}` };
  });

  return (
    <div className="space-y-6">
      {/* ── Export ───────────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <ReportExport onExportPDF={exportPDF} onExportExcel={exportExcel} />
      </div>

      {/* ── Capturable content ───────────────────────────────────────────────── */}
      <div ref={contentRef} className="space-y-6">

      {/* ── Selector de sucursal: el diagnóstico de flota es por sucursal ─────── */}
      {metrics.fleet_diagnoses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Diagnóstico de flota — Sucursal:</span>
          {isSupervisor ? (
            <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 border border-blue-200 text-sm font-semibold text-[#1e3a5f] shadow-sm">
              <MapPin className="w-3.5 h-3.5" />
              {selectedBranchLabel}
            </span>
          ) : (
            <SelectMenu
              value={selectedBranchId}
              onChange={setSelectedBranchId}
              placeholder="Seleccionar sucursal"
              ariaLabel="Filtrar diagnóstico de flota por sucursal"
              size="sm"
              className="w-[230px]"
              groups={sortedProvinces
                .map((prov) => ({
                  label: prov,
                  options: branchesByProvince[prov]
                    .filter((b) => metrics.fleet_diagnoses.some((d) => d.branch_id === b.id))
                    .map((b) => ({ value: b.id, label: `${b.name} — ${b.address.city}` })),
                }))
                .filter((g) => g.options.length > 0)}
            />
          )}
        </div>
      )}

      {/* ── Comparison panel: heuristic vs ML (exclusivo de la sucursal elegida) ─ */}
      {branchDiag && (
        <FleetComparisonPanel
          key={branchDiag.branch_id}
          heuristic={branchDiag.heuristic_diagnosis}
          ml={branchDiag.ml_prediction}
        />
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      <div className="block mb-6 text-sm text-gray-400">
        <p className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          Métricas de SLA — {branchId ? branchLabelById(branchId, branches) : "Todas las sucursales"}
          <span className="text-slate-300">· según el filtro de sucursal del Dashboard</span>
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="sm:col-span-1">
          <CardContent className="pt-6 pb-6 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `${hue}22` }}>
              <ShieldIcon className="w-7 h-7" style={{ color: hue }} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Tasa de Cumplimiento SLA
              </p>
              <p className="text-5xl font-black tabular-nums" style={{ color: hue }}>
                {rate.toFixed(1)}<span className="text-2xl font-bold">%</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {metrics.delayed_total} demorado{metrics.delayed_total !== 1 ? "s" : ""} (SLA roto) de {metrics.active_total} activos
              </p>
              <p className="text-[10px] text-slate-400">
                Penaliza solo a los demorados — los comprometidos aún no rompen el acuerdo
              </p>
            </div>
            <div className="w-full h-2 rounded-full mt-1" style={{ background: `${hue}33` }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${rate}%`, background: hue }} />
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-1">
          <CardContent className="pt-6 pb-6 flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-yellow-500/15">
              <ShieldAlert className="w-7 h-7 text-yellow-500" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Tasa de Envíos en Riesgo
              </p>
              <p className="text-5xl font-black tabular-nums text-yellow-500">
                {riskRate.toFixed(1)}<span className="text-2xl font-bold">%</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {metrics.at_risk_total} comprometido{metrics.at_risk_total !== 1 ? "s" : ""} (en riesgo) de {metrics.active_total} activos
              </p>
              <p className="text-[10px] text-slate-400">
                Aún recuperables — todavía no rompieron el acuerdo de SLA
              </p>
            </div>
            <div className="w-full h-2 rounded-full mt-1 bg-yellow-500/20">
              <div className="h-full rounded-full transition-all duration-500 bg-yellow-500" style={{ width: `${riskRate}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-1">
          <CardContent className="p-5 grid grid-cols-1 gap-4 h-full content-center">
            <KpiChip
              label="Envíos comprometidos (en riesgo)"
              value={metrics.at_risk_total}
              color={metrics.at_risk_total === 0 ? COLOR_OK : COLOR_WARN}
              icon={<ShieldAlert className="w-4 h-4" />}
            />
            <KpiChip
              label="Envíos demorados (SLA roto)"
              value={metrics.delayed_total}
              color={metrics.delayed_total === 0 ? COLOR_OK : COLOR_BAD}
              icon={<AlertCircle className="w-4 h-4" />}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Envíos en Riesgo y Demorados por Estado</CardTitle>
            <p className="text-[11px] text-slate-400">Comprometidos (en riesgo) vs. demorados (SLA roto) por estado actual</p>
          </CardHeader>
          <CardContent>
            {metrics.bottlenecks.length === 0 ? (
              <EmptyState text="Sin cuellos de botella detectados" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={metrics.bottlenecks} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="status" width={140} tick={{ fontSize: 10 }}
                    tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 18) + "…" : v} />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="at_risk_count" stackId="sla" fill={COLOR_WARN} radius={[0, 0, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="delayed_count" stackId="sla" fill={COLOR_BAD} radius={[0, 4, 4, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Tendencia de Demoras (últimos 7 días)</CardTitle>
            <p className="text-[11px] text-slate-400">Escalados automáticos por día según el log de auditoría</p>
          </CardHeader>
          <CardContent>
            {trendData.every((d) => d.count === 0) ? (
              <EmptyState text="Sin escalados en los últimos 7 días" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip content={<LineTooltip />} />
                  <Line type="monotone" dataKey="count" stroke={COLOR_LINE} strokeWidth={2.5}
                    dot={{ r: 4, fill: COLOR_LINE, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Current averages ─────────────────────────────────────────────────── */}
      {(() => {
        // Mostramos una fila por cada estado monitoreado por el motor de SLA
        // (el backend ya envía la lista completa, dinámica — sin hardcodear
        // estados acá). Los que todavía no tienen suficiente historial llegan
        // con has_data: false y muestran un globo explicativo en vez de "0h".
        const averages = metrics.current_averages ?? [];
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Promedio Histórico Actual por Estado (Horas)
              </CardTitle>
              <p className="text-[11px] text-slate-400">
                Tiempo promedio que los envíos permanecen en cada estado, según el último ciclo del Collector
              </p>
            </CardHeader>
            <CardContent>
              {averages.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] text-slate-400 text-sm text-center px-6">
                  Los promedios aún no han sido calculados en este ciclo
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {averages.map((a) => (
                    <div
                      key={a.status}
                      className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-100 bg-slate-50/60"
                    >
                      <span className="text-xs font-semibold text-slate-600 leading-snug inline-flex items-center gap-1">
                        {a.status}
                        {!a.has_data && (
                          <InfoTooltip text="Todavía no hay suficientes transiciones históricas registradas para este estado — el promedio se calculará automáticamente a medida que los envíos completen su recorrido." />
                        )}
                      </span>
                      {a.has_data ? (
                        <span className="text-lg font-black tabular-nums shrink-0" style={{ color: COLOR_LINE }}>
                          {a.avg_hours.toFixed(1)}<span className="text-xs font-bold ml-0.5">h</span>
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-slate-400 shrink-0">Sin datos</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}
      </div>{/* end contentRef */}
    </div>
  );
}

// ── Fleet status theme ────────────────────────────────────────────────────────

type FleetTheme = {
  border: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
  iconColor: string;
  icon: React.ReactNode;
};

const FLEET_THEME: Record<FleetStatus, FleetTheme> = {
  CRÍTICO: {
    border:    "border-rose-300",
    bg:        "bg-rose-50/70",
    badgeBg:   "bg-rose-100",
    badgeText: "text-rose-700",
    iconColor: "text-rose-600",
    icon:      <TrendingDown className="w-4 h-4" />,
  },
  ADVERTENCIA: {
    border:    "border-amber-300",
    bg:        "bg-amber-50/70",
    badgeBg:   "bg-amber-100",
    badgeText: "text-amber-700",
    iconColor: "text-amber-600",
    icon:      <AlertCircle className="w-4 h-4" />,
  },
  PREVENTIVO: {
    border:    "border-orange-300",
    bg:        "bg-orange-50/60",
    badgeBg:   "bg-orange-100",
    badgeText: "text-orange-700",
    iconColor: "text-orange-600",
    icon:      <Zap className="w-4 h-4" />,
  },
  OCIOSO: {
    border:    "border-blue-200",
    bg:        "bg-blue-50/60",
    badgeBg:   "bg-blue-100",
    badgeText: "text-blue-700",
    iconColor: "text-blue-600",
    icon:      <TrendingUp className="w-4 h-4" />,
  },
  ESTABLE: {
    border:    "border-emerald-200",
    bg:        "bg-emerald-50/40",
    badgeBg:   "bg-emerald-100",
    badgeText: "text-emerald-700",
    iconColor: "text-emerald-600",
    icon:      <CheckCircle2 className="w-4 h-4" />,
  },
};

// Canonical display order for vote-distribution bars
const FLEET_STATUS_ORDER: FleetStatus[] = ["CRÍTICO", "ADVERTENCIA", "PREVENTIVO", "OCIOSO", "ESTABLE"];

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const [bg, text, ring] =
    pct >= 80 ? ["bg-emerald-50", "text-emerald-700", "ring-emerald-300"] :
    pct >= 60 ? ["bg-amber-50",   "text-amber-700",   "ring-amber-300"]   :
                ["bg-rose-50",    "text-rose-700",     "ring-rose-300"];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ${bg} ${text} ${ring}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      Confianza: {pct}%
    </span>
  );
}

// ── Info tooltip ──────────────────────────────────────────────────────────────
// Tooltip simple basado en Tailwind (group/group-hover), sin dependencias extra.
// Fondo oscuro fijo + texto claro para mantener buen contraste tanto en modo
// claro como oscuro, con z-index alto para no quedar tapado por cards/charts.

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group/tooltip align-middle">
      <Info className="w-3.5 h-3.5 text-slate-400 hover:text-slate-300 transition-colors cursor-help" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-2 w-56 -translate-x-1/2 scale-95
                   rounded-lg bg-slate-900 px-2.5 py-2 text-[11px] leading-snug text-slate-100 shadow-lg ring-1 ring-black/10
                   opacity-0 transition-all duration-150 group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100"
      >
        {text}
      </span>
    </span>
  );
}

// ── Column sub-components (sin estado — solo contenido) ──────────────────────

function HeuristicColumn({ diag }: { diag: FleetDiagnosis }) {
  const theme = FLEET_THEME[diag.status] ?? FLEET_THEME["ESTABLE"];
  const m = diag.raw_metrics;
  return (
    <>
      <div
        className="absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-[0.07] pointer-events-none"
        style={{ background: statusAccentColor(diag.status) }}
      />
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={theme.iconColor}>{theme.icon}</span>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Diagnóstico Operativo
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${theme.badgeBg} ${theme.badgeText}`}>
          {diag.status}
        </span>
      </div>
      <p className="text-sm font-semibold text-slate-800 leading-snug mb-3">
        {diag.message}
      </p>
      {m && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-black/5">
          <MetricPill label="Demora"           value={`${m.sla_delay_pct.toFixed(1)}%`} />
          <MetricPill label="Choferes activos" value={String(m.active_drivers)} />
          <MetricPill label="Choferes sin ruta" value={String(m.idle_drivers)} />
          <MetricPill
            label="Huérfanos"
            value={String(m.orphan_shipments)}
            tooltip="Envíos en última milla (estado 'En reparto') que no figuran en ninguna ruta activa de chofer para hoy. Es una alerta de integridad de datos: en operación normal debería ser siempre 0."
          />
        </div>
      )}
    </>
  );
}

function MLColumn({ diag }: { diag: FleetDiagnosis }) {
  const theme = FLEET_THEME[diag.status] ?? FLEET_THEME["ESTABLE"];
  return (
    <>
      <div
        className="absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-[0.07] pointer-events-none"
        style={{ background: statusAccentColor(diag.status) }}
      />
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-500 shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Predicción Inteligente · Random Forest
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${theme.badgeBg} ${theme.badgeText}`}>
          {diag.status}
        </span>
      </div>
      <p className="text-sm font-semibold text-slate-800 leading-snug mb-3">
        {diag.message}
      </p>
      {diag.confidence !== undefined && (
        <div className="pt-2 border-t border-black/5">
          <ConfidenceBadge confidence={diag.confidence} />
        </div>
      )}
    </>
  );
}

// ── Unified comparison card ───────────────────────────────────────────────────

function FleetComparisonPanel({
  heuristic,
  ml,
}: {
  heuristic: FleetDiagnosis;
  ml: FleetDiagnosis | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const agree    = ml !== null && ml.status === heuristic.status;
  const disagree = ml !== null && ml.status !== heuristic.status;
  const heurM    = heuristic.raw_metrics;
  const mlM      = ml?.raw_metrics;
  const votes    = ml?.vote_distribution;

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--bg-card)]">

      {/* ── Banner full-width ──────────────────────────────────────────────────── */}
      {agree && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-green-500/10 border-b border-green-500/20 text-xs text-green-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Heurística e IA coinciden en el diagnóstico: <strong>{heuristic.status}</strong>.</span>
        </div>
      )}
      {disagree && (
        <div className="flex items-start gap-2 px-5 py-2.5 bg-yellow-500/10 border-b border-yellow-500/20 text-xs text-yellow-400">
          <Brain className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>Discrepancia detectada:</strong> la heurística clasifica como <strong>{heuristic.status}</strong> y
            el modelo de IA como <strong>{ml!.status}</strong>. Revisá ambas perspectivas antes de decidir.
          </span>
        </div>
      )}

      {/* ── Grid de dos columnas (resumen) ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700/10">

        <div className="p-5 relative overflow-hidden">
          <HeuristicColumn diag={heuristic} />
        </div>

        <div className="p-5 relative overflow-hidden">
          {ml ? (
            <MLColumn diag={ml} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-center h-full min-h-[100px]">
              <Brain className="w-6 h-6 text-slate-300" />
              <p className="text-xs font-semibold text-slate-400">Modelo ML no disponible</p>
              <p className="text-[10px] text-slate-400">
                Se está entrenando en el primer arranque.<br />Recargá en unos segundos.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Botón único full-width ──────────────────────────────────────────────── */}
      {(heurM || mlM || votes) && (
        <div className="border-t border-[var(--border)]">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold text-slate-400 hover:text-slate-600 hover:bg-slate-50/60 transition-colors cursor-pointer"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            Ver analítica comparativa detallada
          </button>
        </div>
      )}

      {/* ── Panel analítico unificado (dos columnas) ────────────────────────────── */}
      {expanded && (
        <div className="border-t border-[var(--border)] grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700/10">

          {/* Izquierda: analítica heurística */}
          <div className="p-5 space-y-4 bg-black/[0.015]">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Analítica · Heurística
            </p>
            {heurM ? (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                  <AnalyticRow label="Envíos totales de sucursal" value={String(heurM.total_shipments)} />
                  <AnalyticRow label="Demora SLA"                 value={`${heurM.sla_delay_pct.toFixed(1)}%`} />
                  <AnalyticRow label="Huérfanos"                  value={String(heurM.orphan_shipments)} />
                  <AnalyticRow label="Choferes sin ruta"          value={String(heurM.idle_drivers)} />
                </div>
                <DriverDeltaBadge delta={heurM.suggested_driver_delta} />
              </>
            ) : (
              <p className="text-sm text-slate-400">Sin datos disponibles.</p>
            )}
          </div>

          {/* Derecha: analítica ML */}
          <div className="p-5 space-y-4 bg-black/[0.015]">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Analítica · Random Forest
            </p>
            {mlM && (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                  <AnalyticRow label="Envíos totales de sucursal" value={String(mlM.total_shipments)} />
                  <AnalyticRow label="Demora SLA"                 value={`${mlM.sla_delay_pct.toFixed(1)}%`} />
                  <AnalyticRow label="Huérfanos"                  value={String(mlM.orphan_shipments)} />
                  <AnalyticRow label="Choferes sin ruta"          value={String(mlM.idle_drivers)} />
                </div>
                <DriverDeltaBadge delta={mlM.suggested_driver_delta} />
              </>
            )}
            {votes ? (
              <div className="space-y-2.5">
                <p className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Distribución de votos (estado mas probable)
                  <InfoTooltip text="El modelo de IA evalúa múltiples escenarios históricos simultáneamente mediante 'árboles de decisión'. Cada árbol emite un voto basado en patrones pasados. El estado con el mayor porcentaje de votos determina la predicción final." />
                </p>
                {FLEET_STATUS_ORDER.map((st) => {
                  const pct = votes[st] ?? 0;
                  const t   = FLEET_THEME[st];
                  return (
                    <div key={st} className="flex items-center gap-2.5">
                      <span className="text-sm text-gray-400 w-28 shrink-0">{st}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-black/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: statusAccentColor(st) }}
                        />
                      </div>
                      <span className={`text-sm font-semibold w-10 text-right tabular-nums ${t.badgeText}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              !mlM && <p className="text-sm text-slate-400">Sin datos de ML disponibles.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Driver delta badge ────────────────────────────────────────────────────────

function DriverDeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
        <UserPlus className="w-4 h-4 text-orange-400 shrink-0" />
        <span className="text-sm font-semibold text-orange-400 leading-snug">
          Acción recomendada: Contratar / Asignar {delta} chofer{delta !== 1 ? "es" : ""} extra.
        </span>
      </div>
    );
  }
  if (delta < 0) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <UserMinus className="w-4 h-4 text-blue-400 shrink-0" />
        <span className="text-sm font-semibold text-blue-400 leading-snug">
          Acción recomendada: Posible desafectación temporal de {Math.abs(delta)} chofer{Math.abs(delta) !== 1 ? "es" : ""}.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      <span className="text-sm text-emerald-400 leading-snug">
        Acción recomendada: No es necesario realizar acciones de contratación ni deshabilitación.
      </span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusAccentColor(status: FleetStatus): string {
  switch (status) {
    case "CRÍTICO":    return "#ef4444";
    case "ADVERTENCIA":return "#f59e0b";
    case "PREVENTIVO": return "#f97316";
    case "OCIOSO":     return "#3b82f6";
    default:           return "#22c55e";
  }
}

function MetricPill({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
      {label}{tooltip && <InfoTooltip text={tooltip} />}: <span className="font-bold text-slate-700">{value}</span>
    </span>
  );
}

function AnalyticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-100 tabular-nums">{value}</span>
    </div>
  );
}

function KpiChip({
  label, value, color, icon, small = false,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 p-5 rounded-xl border border-slate-100 bg-slate-50/60 h-full">
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <p className="text-xs font-bold uppercase tracking-wider leading-snug">{label}</p>
      </div>
      <p className={`font-black leading-none text-slate-800 ${small ? "text-xl break-words" : "text-5xl tabular-nums"}`}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-[220px] text-slate-400 text-sm">
      {text}
    </div>
  );
}
