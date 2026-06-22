import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from "react";
import {
  AlertCircle, RefreshCw, ShieldCheck, ShieldAlert,
  TrendingDown, TrendingUp, CheckCircle2, Zap, Brain,
  ChevronDown, ChevronUp, UserPlus, UserMinus, Info, MapPin,
  Eye, EyeOff, X, AlertTriangle, Gauge, Maximize2, Minimize2, Target, Trash2, ExternalLink,
  Power, RotateCcw, Building2, Settings,
} from "lucide-react";
import type { FleetStatus, FleetDiagnosis, BranchFleetDiagnosis } from "../../api/slaMetrics";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { slaMetricsApi, type SLAMetrics } from "../../api/slaMetrics";
import { branchApi, branchLabelById, type Branch, statusLabel as branchStatusLabel } from "../../api/branches";
import { useAuth } from "../../context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { SelectMenu } from "../../components/ui/SelectMenu";
import { Skeleton } from "../../utils/dashboard";
import { ReportExport } from "../../components/ReportExport";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";
import {
  coverageApi,
  type CoverageDiagram,
  type CoverageCell,
  type SimulationResult,
  type SnappedCity,
  type SuggestedLocation,
  type BranchProjection,
  type RejectedLocation,
  GAP_STYLE,
} from "../../api/coverage";
import { regionsApi, type Region as CoverageRegion } from "../../api/regions";
import { VoronoiCoverageMap, type VoronoiCoverageMapHandle } from "../../components/VoronoiCoverageMap";
import { CoverageSimulatorPanel, SIM_AREA_DEFAULT, SIM_AREA_MIN, SIM_AREA_MAX, type DiagnosisMode } from "../../components/CoverageSimulatorPanel";
import { CollapsiblePanel } from "../../components/CollapsiblePanel";
import { SkeletonCard } from "../../components/ui/skeleton";
// ── Palette ──────────────────────────────────────────────────────────────────
const COLOR_OK   = "#22c55e";
const COLOR_WARN = "#f59e0b";
const COLOR_BAD  = "#ef4444";
const COLOR_LINE = "var(--brand)";

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
      <p className="font-bold" style={{ color: COLOR_WARN }}>{atRisk} en riesgo</p>
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
      <p className="text-[var(--brand)] font-bold">{payload[0].value} escalado{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

interface SlaTabProps {
  /** Sucursal del filtro global del Dashboard ("" = todas). Acota únicamente
   *  las tarjetas/gráficos de SLA (tasa de cumplimiento, en riesgo,
   *  demorados, cuellos de botella) — el "Diagnóstico de flota" mantiene su
   *  propio selector de sucursal, independiente de este filtro. */
  branchId: string;
}

/** Severidad más alta primero, para ordenar la lista de zonas. */
const SEVERITY_RANK: Record<string, number> = { critico: 3, moderado: 2, leve: 1, "": 0 };

function formatKm2(v: number): string {
  return `${Math.round(v).toLocaleString("es-AR")} km²`;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SlaTab({ branchId }: SlaTabProps) {
  const { user, hasRole } = useAuth();
  const [metrics, setMetrics] = useState<SLAMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState<{ title: string; data: Record<string, number> } | null>(null);

  const isSupervisor = hasRole("supervisor") && !hasRole("manager", "admin");

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    const params: { branch_id?: string } = {};
    if (branchId) params.branch_id = branchId;
    slaMetricsApi
      .get(params)
      .then((data) => { setMetrics(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [branchId]);

  useEffect(() => { load(); }, [load]);
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
            "Cant. en riesgo": b.at_risk_count,
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

  // Tasa de envíos en riesgo: % de los activos que están "en riesgo"
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
                Penaliza solo a los demorados — los envíos en riesgo aún no rompen el acuerdo
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
                {metrics.at_risk_total} en riesgo de {metrics.active_total} activos
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
              label="Envíos en riesgo"
              value={metrics.at_risk_total}
              color={metrics.at_risk_total === 0 ? COLOR_OK : COLOR_WARN}
              icon={<ShieldAlert className="w-4 h-4" />}
              onViewDetail={metrics.at_risk_total > 0 ? () => {
                setModalContent({ title: "Detalle de Envíos en Riesgo", data: metrics.at_risk_by_branch });
                setIsDetailsModalOpen(true);
              } : undefined}
            />
            <KpiChip
              label="Envíos demorados (SLA roto)"
              value={metrics.delayed_total}
              color={metrics.delayed_total === 0 ? COLOR_OK : COLOR_BAD}
              icon={<AlertCircle className="w-4 h-4" />}
              subtitle="Demorados en este momento"
              onViewDetail={metrics.delayed_total > 0 ? () => {
                setModalContent({ title: "Detalle de Demorados", data: metrics.delayed_by_branch });
                setIsDetailsModalOpen(true);
              } : undefined}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Envíos en Riesgo y Demorados por Estado</CardTitle>
            <p className="text-[11px] text-slate-400">En riesgo vs. demorados (SLA roto) por estado actual</p>
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
            <CardTitle className="text-sm font-semibold text-slate-700">Historial de Repriorizaciones Automáticas</CardTitle>
            <p className="text-[11px] text-slate-400">Acumulado diario de eventos disparados (incluye paquetes ya resueltos/despachados)</p>
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

      {/* ── Cobertura territorial (detector de falta de sucursal) ─────────────── */}
      <div className="pt-2">
        <CoberturaTab />
      </div>

      <BranchDetailsModal
        open={isDetailsModalOpen}
        content={modalContent}
        onClose={() => setIsDetailsModalOpen(false)}
      />
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
  label, value, color, icon, small = false, subtitle, onViewDetail,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
  small?: boolean;
  subtitle?: string;
  onViewDetail?: () => void;
}) {
  return (
    <div className="relative flex flex-col justify-between gap-3 p-5 rounded-xl border border-slate-100 bg-slate-50/60 h-full">
      {onViewDetail && (
        <button
          type="button"
          onClick={onViewDetail}
          className="absolute top-4 right-4 flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          title="Ver detalle por sucursal"
        >
          <Eye className="w-3.5 h-3.5" />
          Ver detalle
        </button>
      )}
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <p className="text-xs font-bold uppercase tracking-wider leading-snug">{label}</p>
      </div>
      <div>
        <p className={`font-black leading-none text-slate-800 ${small ? "text-xl break-words" : "text-5xl tabular-nums"}`}>
          {value}
        </p>
        {subtitle && <p className="text-[11px] text-slate-400 mt-1.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function BranchDetailsModal({
  open, content, onClose,
}: {
  open: boolean;
  content: { title: string; data: Record<string, number> } | null;
  onClose: () => void;
}) {
  if (!open || !content) return null;
  const entries = Object.entries(content.data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">{content.title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No hay paquetes en este estado</p>
          ) : (
            <ul className="space-y-2">
              {entries.map(([branchName, count]) => (
                <li key={branchName} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 font-medium">{branchName}</span>
                  <span className="text-slate-800 font-bold tabular-nums">{count} paquetes</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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

export function CoberturaTab() {
  const [diagram, setDiagram] = useState<CoverageDiagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Pesos del Índice de Viabilidad (configurables por el usuario desde el ícono ⚙️).
  const [scoreWeights, setScoreWeights] = useState<ScoreWeightsConfig>(DEFAULT_SCORE_WEIGHTS);
  const [showScoreSettings, setShowScoreSettings] = useState(false);

  // Simulador de cobertura: visualArea sigue al slider al instante (sin
  // llamar al servidor); simResult refleja el último diagnóstico confirmado.
  const [visualArea, setVisualArea] = useState(SIM_AREA_DEFAULT);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Modo pantalla completa: superpone el mapa + panel lateral sobre toda la
  // ventana (incluyendo el topbar) para aprovechar el espacio al analizar el mapa.
  const [isFullscreen, setIsFullscreen] = useState(false);

  // "Aterrizar sugerencias en ciudades reales": ciudades reales (dataset oficial
  // INDEC/Georef) resueltas para simResult.suggested_locations, en el mismo
  // orden. Se resetea cada vez que cambia el diagnóstico simulado.
  const [snappedCities, setSnappedCities] = useState<SnappedCity[] | null>(null);
  // Bloquea el slider del simulador y el botón "Confirmar y Diagnosticar"
  // mientras se geocodifican las sugerencias ("Aterrizar sugerencias en
  // ciudades reales"), para que el usuario no pueda disparar un nuevo
  // diagnóstico mientras eso está en curso.
  const [isFetchingCities, setIsFetchingCities] = useState(false);
  const [snappingProgress, setSnappingProgress] = useState<{ current: number; total: number } | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isFindingMore, setIsFindingMore] = useState(false);
  const [excludedCitiesForMore, setExcludedCitiesForMore] = useState<string[]>([]);
  const [findMoreSummary, setFindMoreSummary] = useState<{ found: number; error: boolean } | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [snapMinPopulation, setSnapMinPopulation] = useState(0);

  // Feature: Blacklist de ciudades — nombres descartados por el usuario en
  // reintentos anteriores; se envían al backend para que no sean seleccionados.
  const [blacklistedCities, setBlacklistedCities] = useState<string[]>([]);

  // Feature: Control de sucursales en la simulación.
  // closedBranchIds → excluidas del cálculo Voronoi (backend-side) y del mapa.
  // hiddenBranchIds → solo ocultas del mapa; el Voronoi las sigue usando.
  // includeInactive → incluye sucursales Inactivas/FDS en la base del cálculo.
  const [closedBranchIds, setClosedBranchIds] = useState<string[]>([]);
  const [hiddenBranchIds, setHiddenBranchIds] = useState<string[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);

  // Refs para diagnoseCore (evita stale closures en toggleClosedBranch / handleToggleIncludeInactive).
  const [maxSuggestions, setMaxSuggestions] = useState(40);
  const maxSuggestionsRef = useRef(40);

  const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>("area");
  const diagnosisModeRef = useRef<DiagnosisMode>("area");
  const snapMinPopulationRef = useRef(0);
  const [minDensity, setMinDensity] = useState(0);
  const minDensityRef = useRef(0);
  const [prioritizeIndustrial, setPrioritizeIndustrial] = useState(false);
  const prioritizeIndustrialRef = useRef(false);
  const [applyTerrainFriction, setApplyTerrainFriction] = useState(false);
  const applyTerrainFrictionRef = useRef(false);
  // Cuando "Penalizar terreno" está apagado, la penalización se fuerza a 0.
  const effectiveWeights = useMemo(
    () => ({ ...scoreWeights, terrain: applyTerrainFriction ? scoreWeights.terrain : 0 }),
    [scoreWeights, applyTerrainFriction],
  );
  const [minSeparation, setMinSeparation] = useState(20);
  const minSeparationRef = useRef(20);
  const [minScore, setMinScore] = useState(0);
  const minScoreRef = useRef(0);
  const [showRejectedOnMap, setShowRejectedOnMap] = useState(true);

  const simResultRef = useRef<SimulationResult | null>(null);
  const visualAreaRef = useRef(SIM_AREA_DEFAULT);
  const customBoundaryRef = useRef<[number, number][] | null>(null);
  const territoryModeRef = useRef<"national" | "custom">("national");
  const includeInactiveRef = useRef(false);
  const closedBranchIdsRef = useRef<string[]>([]);
  const coverageMapRef = useRef<VoronoiCoverageMapHandle>(null);
  const highlightedCellPolygonRef = useRef<[number, number][] | null>(null);
  const highlightedRef = useRef<string | null>(null);
  // Guarda el estado de zona anterior a la selección de celda para restaurarlo al deseleccionar.
  const preCellSelectionStateRef = useRef<{ boundary: [number, number][] | null; mode: "national" | "custom" } | null>(null);

  const handleFlyToLocation = useCallback((lat: number, lng: number, zoom = 8) => {
    coverageMapRef.current?.flyTo(lat, lng, zoom);
  }, []);

  // Feature: Área de simulación personalizada — el usuario dibuja un polígono
  // en el mapa para restringir el diagnóstico a esa zona (ej. AMBA, Patagonia).
  const [territoryMode, setTerritoryMode] = useState<"national" | "custom">("national");
  const [customBoundary, setCustomBoundary] = useState<[number, number][] | null>(null);
  const [isDrawingBoundary, setIsDrawingBoundary] = useState(false);
  const [isEditingBoundary, setIsEditingBoundary] = useState(false);
  const [showIndustrialHeatmap, setShowIndustrialHeatmap] = useState(false);
  const [industrialHeatmapLoading, setIndustrialHeatmapLoading] = useState(false);
  const [industrialZoneResult, setIndustrialZoneResult] = useState<{ count: number; error: boolean } | null>(null);
  const [rejectedLocations, setRejectedLocations] = useState<RejectedLocation[]>([]);

  // Zonas guardadas (predefinidas + zonas del usuario).
  const [regions, setRegions] = useState<CoverageRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string>("national");
  // Modal para guardar una zona dibujada nueva o editada.
  const [showSaveRegionModal, setShowSaveRegionModal] = useState(false);
  const [pendingRegionBoundary, setPendingRegionBoundary] = useState<[number, number][] | null>(null);
  const [savingRegionName, setSavingRegionName] = useState("");
  const [savingRegion, setSavingRegion] = useState(false);
  const [regionSaveError, setRegionSaveError] = useState<string | null>(null);
  // Edición de zona: id de la zona que se está editando (null = creando una
  // nueva). `redrawReference` es la forma original que se dibuja de fondo en
  // tono claro mientras el usuario la re-dibuja, como referencia.
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [redrawReference, setRedrawReference] = useState<[number, number][] | null>(null);

  // Sync refs used by diagnoseCore (stable callback, reads values without closures).
  useEffect(() => { simResultRef.current = simResult; }, [simResult]);
  useEffect(() => { visualAreaRef.current = visualArea; }, [visualArea]);
  useEffect(() => { maxSuggestionsRef.current = maxSuggestions; }, [maxSuggestions]);
  useEffect(() => { customBoundaryRef.current = customBoundary; }, [customBoundary]);
  useEffect(() => { territoryModeRef.current = territoryMode; }, [territoryMode]);
  useEffect(() => { includeInactiveRef.current = includeInactive; }, [includeInactive]);
  useEffect(() => { closedBranchIdsRef.current = closedBranchIds; }, [closedBranchIds]);
  useEffect(() => { highlightedRef.current = highlighted; }, [highlighted]);
  useEffect(() => { diagnosisModeRef.current = diagnosisMode; }, [diagnosisMode]);
  useEffect(() => { minDensityRef.current = minDensity; }, [minDensity]);
  useEffect(() => { prioritizeIndustrialRef.current = prioritizeIndustrial; }, [prioritizeIndustrial]);
  useEffect(() => { applyTerrainFrictionRef.current = applyTerrainFriction; }, [applyTerrainFriction]);
  useEffect(() => { minSeparationRef.current = minSeparation; }, [minSeparation]);
  useEffect(() => { minScoreRef.current = minScore; }, [minScore]);

  // Fetch all branches (including inactive) for the simulation panel.
  useEffect(() => { branchApi.list().then(setAllBranches).catch(() => {}); }, []);

  // Fetch saved regions (predefined + custom) for the zone selector.
  useEffect(() => { regionsApi.list().then(setRegions).catch(() => {}); }, []);

  // Limpia el último diagnóstico confirmado (sugerencias, ciudades aterrizadas,
  // errores, proyección). Se llama al cambiar de zona para que el resultado de
  // la zona anterior no quede dibujado en el mapa/panel hasta el próximo
  // "Diagnosticar" — apenas cambia la zona, el diagnóstico viejo desaparece.
  // La proyección se limpia sola: su efecto la setea en null cuando simResult lo es.
  const resetDiagnosis = useCallback(() => {
    setSimResult(null);
    setSnappedCities(null);
    setSnapError(null);
    setSimError(null);
    setBlacklistedCities([]);
    setRejectedLocations([]);
  }, []);

  const handleRegionChange = useCallback((id: string) => {
    resetDiagnosis();
    setEditingRegionId(null);
    setRedrawReference(null);
    setIsDrawingBoundary(false);
    setSelectedRegionId(id);
    if (id === "national") {
      setCustomBoundary(null);
      setTerritoryMode("national");
      return;
    }
    const region = regions.find((r) => r.id === id);
    if (!region) return;
    const coords: [number, number][] = region.coordinates.map((c) => [c.lat, c.lng]);
    setCustomBoundary(coords);
    setTerritoryMode("custom");
    coverageMapRef.current?.fitBoundsToPolygon(coords);
  }, [regions, resetDiagnosis]);

  const handleStartDrawNewRegion = useCallback(() => {
    resetDiagnosis();
    setEditingRegionId(null);
    setRedrawReference(null);
    setSelectedRegionId("national");
    setCustomBoundary(null);
    setTerritoryMode("custom");
    setIsDrawingBoundary(true);
  }, [resetDiagnosis]);

  // Editar una zona personalizada existente: entra en modo re-dibujo mostrando
  // la forma original de fondo (tono claro) como referencia. Al cerrar el nuevo
  // polígono (Enter) se abre el modal con el nombre precargado para confirmar
  // nombre + nueva geometría. Solo aplica a zonas propias (type "custom").
  const handleStartEditRegion = useCallback(() => {
    const region = regions.find((r) => r.id === selectedRegionId);
    if (!region || region.type !== "custom") return;
    resetDiagnosis();
    setEditingRegionId(region.id);
    setRedrawReference(customBoundary ?? region.coordinates.map((c) => [c.lat, c.lng]));
    setCustomBoundary(null);
    setTerritoryMode("custom");
    setIsDrawingBoundary(true);
  }, [regions, selectedRegionId, customBoundary, resetDiagnosis]);

  const handleBoundaryComplete = useCallback((pts: [number, number][]) => {
    setCustomBoundary(pts);
    setIsDrawingBoundary(false);
    setRedrawReference(null);
    setRegionSaveError(null);
    setPendingRegionBoundary(pts);
    // Al editar, precargamos el nombre actual para que el usuario pueda
    // mantenerlo o cambiarlo en el mismo paso de confirmación.
    if (editingRegionId) {
      const region = regions.find((r) => r.id === editingRegionId);
      setSavingRegionName(region?.name ?? "");
    }
    setShowSaveRegionModal(true);
  }, [editingRegionId, regions]);

  // Restaura la zona original (descarta el re-dibujo en curso). Reutilizado por
  // Esc durante el dibujo y por "Cancelar" en el modal.
  const restoreEditedRegion = useCallback((): boolean => {
    if (!editingRegionId) return false;
    const region = regions.find((r) => r.id === editingRegionId);
    setEditingRegionId(null);
    setRedrawReference(null);
    if (!region) return false;
    const coords = region.coordinates.map((c) => [c.lat, c.lng]) as [number, number][];
    setSelectedRegionId(region.id);
    setCustomBoundary(coords);
    setTerritoryMode("custom");
    return true;
  }, [editingRegionId, regions]);

  const handleBoundaryCancel = useCallback(() => {
    setIsDrawingBoundary(false);
    setRedrawReference(null);
    if (restoreEditedRegion()) return;
    if (!customBoundary) {
      setTerritoryMode("national");
      setSelectedRegionId("national");
    }
  }, [customBoundary, restoreEditedRegion]);

  const handleClearBoundary = useCallback(() => {
    setCustomBoundary(null);
    setSelectedRegionId("national");
    setIsDrawingBoundary(true);
  }, []);

  const handleStartEditBoundary = useCallback(() => {
    setRegionSaveError(null);
    setIsEditingBoundary(true);
  }, []);

  const handleBoundaryEdited = useCallback(async (pts: [number, number][]) => {
    setCustomBoundary(pts);
    setIsEditingBoundary(false);
    resetDiagnosis();
    // If the active boundary belongs to a saved custom region, persist the new
    // shape immediately so it survives a page refresh.
    if (selectedRegionId !== "national") {
      const region = regions.find((r) => r.id === selectedRegionId && r.type === "custom");
      if (region) {
        try {
          setRegionSaveError(null);
          await regionsApi.update(region.id, {
            name: region.name,
            coordinates: pts.map(([lat, lng]) => ({ lat, lng })),
          });
          const updated = await regionsApi.list();
          setRegions(updated);
        } catch {
          setRegionSaveError("No se pudieron guardar los cambios de la zona. Verificá tu conexión e intentá de nuevo.");
        }
      }
    }
  }, [resetDiagnosis, selectedRegionId, regions]);

  const handleBoundaryEditCancel = useCallback(() => {
    setIsEditingBoundary(false);
  }, []);

  const handleSaveNewRegion = useCallback(async () => {
    if (!pendingRegionBoundary || !savingRegionName.trim()) return;
    setSavingRegion(true);
    setRegionSaveError(null);
    try {
      const coordinates = pendingRegionBoundary.map(([lat, lng]) => ({ lat, lng }));
      const name = savingRegionName.trim();
      const saved = editingRegionId
        ? await regionsApi.update(editingRegionId, { name, coordinates })
        : await regionsApi.create({ name, coordinates });
      const updated = await regionsApi.list();
      setRegions(updated);
      setSelectedRegionId(saved.id);
      setCustomBoundary(pendingRegionBoundary);
      setTerritoryMode("custom");
      // Close and clean up only on success.
      setShowSaveRegionModal(false);
      setSavingRegionName("");
      setPendingRegionBoundary(null);
      setEditingRegionId(null);
    } catch {
      // Keep the modal open so the user can retry — don't silently discard.
      setRegionSaveError("No se pudo guardar la zona. Verificá tu conexión e intentá de nuevo.");
    } finally {
      setSavingRegion(false);
    }
  }, [pendingRegionBoundary, savingRegionName, editingRegionId]);

  const handleCancelSaveRegion = useCallback(() => {
    setShowSaveRegionModal(false);
    setSavingRegionName("");
    setPendingRegionBoundary(null);
    // Al cancelar una edición, restauramos la zona original; al cancelar una
    // creación, volvemos a Nacional.
    if (restoreEditedRegion()) return;
    setCustomBoundary(null);
    setTerritoryMode("national");
    setSelectedRegionId("national");
  }, [restoreEditedRegion]);

  // "Proyección de Impacto": cobertura actual vs. proyectada de cada sucursal
  // si la red incluyera también las sugerencias activas. Se recalcula cada
  // vez que cambia simResult (nuevo diagnóstico o sugerencia descartada).
  const [projection, setProjection] = useState<BranchProjection[] | null>(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);

  // diagnoseCore: stable callback (reads from refs) — safe to call from state
  // updaters (e.g. toggleClosedBranch / handleToggleIncludeInactive) without
  // stale-closure issues. Declared before `load` so `load` can close over it.
  const diagnoseCore = useCallback((area: number, closed: string[]) => {
    const territoryMode = territoryModeRef.current;
    const boundary = customBoundaryRef.current;
    const inactive = includeInactiveRef.current;
    const dMode = diagnosisModeRef.current;
    const minPop = snapMinPopulationRef.current;
    const highlightedPoly = highlightedCellPolygonRef.current;
    const boundingArea =
      highlightedPoly && highlightedPoly.length >= 3
        ? highlightedPoly.map(([lat, lng]) => ({ lat, lng }))
        : territoryMode === "custom" && boundary && boundary.length >= 3
        ? boundary.map(([lat, lng]) => ({ lat, lng }))
        : undefined;
    setSimError(null);
    setSnappedCities(null);
    setSnapError(null);
    setBlacklistedCities([]);
    setExcludedCitiesForMore([]);
    setFindMoreSummary(null);
    setIsDiagnosing(true);
    coverageApi
      .diagnose(
        area,
        closed.length > 0 ? closed : undefined,
        boundingArea,
        inactive || undefined,
        maxSuggestionsRef.current > 0 ? maxSuggestionsRef.current : undefined,
        undefined,
        dMode !== "area" ? dMode : undefined,
        dMode === "density"
          ? {
              minPopulation: minPop > 0 ? minPop : undefined,
              minDensity: minDensityRef.current > 0 ? minDensityRef.current : undefined,
              prioritizeIndustrial: prioritizeIndustrialRef.current || undefined,
              applyTerrainFriction: applyTerrainFrictionRef.current || undefined,
              minSeparation: minSeparationRef.current > 0 ? minSeparationRef.current : undefined,
              minScore: minScoreRef.current > 0 ? minScoreRef.current : undefined,
            }
          : undefined,
      )
      .then((result) => {
        const mathSuggs = result.mathematical_suggestions ?? [];
        const merged = [...result.suggested_locations, ...mathSuggs];
        // Pre-populate snappedCities para cualquier sugerencia que el servidor
        // ya aterrizó (density mode: todas; area mode: solo las matemáticas).
        if (merged.some((s) => s.is_snapped)) {
          setSnappedCities(
            merged.map((loc) =>
              loc.is_snapped
                ? {
                    lat: loc.lat,
                    lng: loc.lng,
                    city_name: loc.city_name ?? "",
                    is_snapped: true,
                    population: loc.population,
                  }
                : { lat: loc.lat, lng: loc.lng, city_name: "", is_snapped: false },
            ),
          );
        }
        setRejectedLocations(result.rejected_locations ?? []);
        setSimResult({ ...result, suggested_locations: merged });
      })
      .catch(() => setSimError("No se pudo calcular el diagnóstico en este momento."))
      .finally(() => setIsDiagnosing(false));
  }, []); // intentionally empty deps — reads from refs only

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    coverageApi
      .getDiagram()
      .then((d) => setDiagram(d))
      .catch(() => setError("No se pudo calcular la cobertura en este momento."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  // Diagnóstico: compara el área simulada contra el área Voronoi real (post-recorte) de cada sucursal.
  const handleConfirmSimulation = useCallback((area: number, minPopulation: number) => {
    snapMinPopulationRef.current = minPopulation; // sync immediately so diagnoseCore reads it
    setSnapMinPopulation(minPopulation);
    diagnoseCore(area, closedBranchIds);
  }, [diagnoseCore, closedBranchIds]);

  // Selección de celda Voronoi: restringe el diagnóstico al polígono real de la
  // celda (ya recortado a la Argentina por el backend) y lo muestra visualmente
  // como la zona activa. Al deseleccionar restaura la zona previa.
  const handleSelectBranch = useCallback((id: string | null) => {
    if (id === highlightedRef.current) return; // sin cambio, no re-diagnosticar

    if (id !== null) {
      // Guardar estado de zona previo a la selección.
      preCellSelectionStateRef.current = {
        boundary: customBoundaryRef.current,
        mode: territoryModeRef.current,
      };

      // Elegir el anillo más grande del polígono de la celda (cada anillo es un
      // fragmento desconectado ya recortado a Argentina — sin Chile, sin océano).
      const cell = diagram?.cells.find((c) => c.branch_id === id);
      const rings = cell?.polygon ?? [];
      let largestRing: { lat: number; lng: number }[] | null = null;
      let maxArea = 0;
      for (const ring of rings) {
        let area = 0;
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          area += ring[i].lat * ring[j].lng - ring[j].lat * ring[i].lng;
        }
        area = Math.abs(area / 2);
        if (area > maxArea) { maxArea = area; largestRing = ring; }
      }
      const cellRing = largestRing
        ? largestRing.map((p) => [p.lat, p.lng] as [number, number])
        : null;

      // Actualizar refs (síncronamente, para diagnoseCore) y estados (para UI).
      customBoundaryRef.current = cellRing;
      territoryModeRef.current = "custom";
      highlightedCellPolygonRef.current = null; // la boundary maneja el scope
      setCustomBoundary(cellRing);
      setTerritoryMode("custom");
    } else {
      // Restaurar zona previa a la selección de celda.
      const saved = preCellSelectionStateRef.current;
      const prevBoundary = saved?.boundary ?? null;
      const prevMode = saved?.mode ?? "national";
      customBoundaryRef.current = prevBoundary;
      territoryModeRef.current = prevMode;
      highlightedCellPolygonRef.current = null;
      setCustomBoundary(prevBoundary);
      setTerritoryMode(prevMode);
      preCellSelectionStateRef.current = null;
    }

    setHighlighted(id);
    diagnoseCore(visualAreaRef.current, closedBranchIdsRef.current);
  }, [diagram, diagnoseCore]);

  // "Buscar más sugerencias": llama al backend con las ciudades ya mostradas
  // como blacklist, y ACUMULA (en lugar de reemplazar) los resultados nuevos.
  const handleFindMore = useCallback(() => {
    if (!simResultRef.current || isFindingMore || isDiagnosing) return;
    const currentCityNames = snappedCities
      ?.filter((c) => c.is_snapped && c.city_name)
      .map((c) => c.city_name) ?? [];
    // Also exclude cities that were evaluated and rejected in previous rounds
    // (they would be rejected again by the same filters — no point re-querying).
    // Names starting with "(" are coordinate placeholders, not real city names.
    const rejectedCityNames = rejectedLocations
      .map((r) => r.city_name)
      .filter((n) => n && !n.startsWith("("));
    const seen = new Set(excludedCitiesForMore);
    const newExcluded = [
      ...excludedCitiesForMore,
      ...currentCityNames.filter((n) => !seen.has(n)),
      ...rejectedCityNames.filter((n) => !seen.has(n)),
    ];
    setExcludedCitiesForMore(newExcluded);
    setIsFindingMore(true);
    setFindMoreSummary(null);
    setProjection(null); // clear projection so the user sees it recalculate after results arrive
    const area = visualAreaRef.current;
    const boundary = customBoundaryRef.current;
    const territoryMode = territoryModeRef.current;
    const inactive = includeInactiveRef.current;
    const dMode = diagnosisModeRef.current;
    const minPop = snapMinPopulationRef.current;
    const closed = closedBranchIdsRef.current;
    const boundingArea =
      territoryMode === "custom" && boundary && boundary.length >= 3
        ? boundary.map(([lat, lng]) => ({ lat, lng }))
        : undefined;
    // Pass currently active suggestion coordinates as additionalSites so the
    // backend treats those cities as already covered — Buscar-más rounds find
    // different cities in genuinely uncovered areas.
    const currentSuggestionSites = simResultRef.current?.suggested_locations.map(
      (s) => ({ lat: s.lat, lng: s.lng }),
    ) ?? [];
    coverageApi
      .diagnose(
        area,
        closed.length > 0 ? closed : undefined,
        boundingArea,
        inactive || undefined,
        maxSuggestionsRef.current > 0 ? maxSuggestionsRef.current : undefined,
        undefined,
        dMode !== "area" ? dMode : undefined,
        dMode === "density"
          ? {
              minPopulation: minPop > 0 ? minPop : undefined,
              minDensity: minDensityRef.current > 0 ? minDensityRef.current : undefined,
              excludedCities: newExcluded.length > 0 ? newExcluded : undefined,
              additionalSites: currentSuggestionSites.length > 0 ? currentSuggestionSites : undefined,
              prioritizeIndustrial: prioritizeIndustrialRef.current || undefined,
              applyTerrainFriction: applyTerrainFrictionRef.current || undefined,
              minSeparation: minSeparationRef.current > 0 ? minSeparationRef.current : undefined,
              minScore: minScoreRef.current > 0 ? minScoreRef.current : undefined,
            }
          : undefined,
      )
      .then((result) => {
        const mathSuggs = result.mathematical_suggestions ?? [];
        const newSuggs = [...result.suggested_locations, ...mathSuggs];
        setFindMoreSummary({ found: newSuggs.length, error: false });
        setRejectedLocations((prev) => [...prev, ...(result.rejected_locations ?? [])]);
        if (newSuggs.length === 0) return;
        setSimResult((prev) => {
          if (!prev) return prev;
          return { ...prev, suggested_locations: [...prev.suggested_locations, ...newSuggs] };
        });
        setSnappedCities((prev) => {
          const existing = prev ?? [];
          const newEntries = newSuggs.map((loc) =>
            loc.is_snapped
              ? { lat: loc.lat, lng: loc.lng, city_name: loc.city_name ?? "", is_snapped: true as const, population: loc.population }
              : { lat: loc.lat, lng: loc.lng, city_name: "", is_snapped: false as const },
          );
          return [...existing, ...newEntries];
        });
      })
      .catch(() => {
        setFindMoreSummary({ found: 0, error: true });
        setSimError("No se pudo buscar más sugerencias en este momento.");
      })
      .finally(() => setIsFindingMore(false));
  }, [isFindingMore, isDiagnosing, snappedCities, excludedCitiesForMore, rejectedLocations]);

  // Sugerencias que todavía no aterrizaron en una ciudad real: solo estas se
  // vuelven a enviar al backend en cada click (evita reprocesar puntos que ya
  // tienen resultado).
  const pendingSnapIndexes = useMemo(() => {
    if (!simResult) return [];
    return simResult.suggested_locations
      .map((_, i) => i)
      .filter((i) => !snappedCities || !snappedCities[i]?.is_snapped);
  }, [simResult, snappedCities]);

  const snappedCount = useMemo(
    () => snappedCities?.filter((c) => c.is_snapped).length ?? 0,
    [snappedCities]
  );

  // Progressive snap: iterates one point at a time so the map updates in
  // real-time (grey → green) instead of waiting for all points to resolve.
  // Maintains array alignment via `removedSoFar`: each NO_RESULTS removal
  // shifts subsequent indices down by one, and the counter corrects for that.
  const handleSnapToCity = useCallback(async () => {
    const result = simResultRef.current;
    if (!result || pendingSnapIndexes.length === 0) return;

    const locsToProcess = pendingSnapIndexes.map((origIndex) => ({
      origIndex,
      lat: result.suggested_locations[origIndex].lat,
      lng: result.suggested_locations[origIndex].lng,
    }));

    const radiusKm = Math.sqrt(result.simulated_area_km2 / Math.PI);
    const total = locsToProcess.length;

    setIsFetchingCities(true);
    setSnapError(null);
    setSnappingProgress({ current: 0, total });

    // Send all pending points in a single batch call instead of one per request.
    // Sequential per-point calls caused browser crashes with large suggestion sets
    // (hundreds of state updates + Leaflet re-renders in rapid succession).
    const BATCH = 50;
    const allSnapResults: Array<{ origIndex: number; lat: number; lng: number; result: SnappedCity }> = [];

    try {
      for (let start = 0; start < locsToProcess.length; start += BATCH) {
        const batch = locsToProcess.slice(start, start + BATCH);
        const snapResults = await coverageApi.snapToCity(
          batch.map(({ lat, lng }) => ({ lat, lng })),
          radiusKm,
          snapMinPopulationRef.current,
          blacklistedCities.length > 0 ? blacklistedCities : undefined,
        );
        for (let i = 0; i < batch.length; i++) {
          if (snapResults[i]) {
            allSnapResults.push({ origIndex: batch[i].origIndex, lat: batch[i].lat, lng: batch[i].lng, result: snapResults[i] });
          }
        }
        setSnappingProgress({ current: Math.min(start + BATCH, total), total });
      }
    } catch {
      setSnapError("Error al buscar ciudades. Intente nuevamente.");
      setIsFetchingCities(false);
      setSnappingProgress(null);
      return;
    }

    // Classify each result before touching state.
    const noResultOrigIndexes = new Set<number>();
    const snappedUpdates = new Map<number, SnappedCity>();
    const noResultReason = snapMinPopulationRef.current > 0
      ? `Sin ciudad con ≥ ${snapMinPopulationRef.current.toLocaleString("es-AR")} hab. en el radio`
      : "Sin ciudad en el radio de búsqueda";
    const newRejected: Array<{ city_name: string; lat: number; lng: number; reject_reason: string; score: number }> = [];

    for (const { origIndex, lat, lng, result: snapResult } of allSnapResults) {
      if (snapResult.is_snapped) {
        snappedUpdates.set(origIndex, snapResult);
      } else if (snapResult.error_reason === "NO_RESULTS") {
        noResultOrigIndexes.add(origIndex);
        newRejected.push({
          city_name: `(${lat.toFixed(3)}°, ${lng.toFixed(3)}°)`,
          lat,
          lng,
          reject_reason: noResultReason,
          score: 1,
        });
      }
    }

    // Apply all state changes at once.
    setSnappedCities((prev) => {
      const base: SnappedCity[] = prev
        ? [...prev]
        : Array(result.suggested_locations.length).fill({ lat: 0, lng: 0, city_name: "", is_snapped: false as const });
      for (const [idx, city] of snappedUpdates) {
        base[idx] = city;
      }
      return noResultOrigIndexes.size > 0
        ? base.filter((_, i) => !noResultOrigIndexes.has(i))
        : base;
    });

    if (newRejected.length > 0) {
      setRejectedLocations((prev) => [...prev, ...newRejected]);
      setSimResult((prev) =>
        prev
          ? { ...prev, suggested_locations: prev.suggested_locations.filter((_, i) => !noResultOrigIndexes.has(i)) }
          : prev,
      );
    }

    setIsFetchingCities(false);
    setSnappingProgress(null);
  }, [pendingSnapIndexes, blacklistedCities]);

  // Descarta una sugerencia: la quita de `simResult.suggested_locations` y de
  // `snappedCities` en el mismo índice, manteniendo ambos arrays alineados.
  // VoronoiCoverageMap reconstruye sus marcadores/círculos cuando cambia
  // `suggestedLocations`, así que el círculo verde desaparece del mapa al instante.
  const removeSuggestion = useCallback((index: number) => {
    setSimResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        suggested_locations: prev.suggested_locations.filter((_, i) => i !== index),
      };
    });
    setSnappedCities((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  // Descarta una ciudad para reintentos: agrega su nombre a la blacklist y
  // resetea la entrada a is_snapped=false para que aparezca como pendiente.
  // El punto de sugerencia se mantiene en simResult para el próximo reintento.
  const blacklistCity = useCallback((index: number, cityName: string) => {
    setBlacklistedCities((prev) => (prev.includes(cityName) ? prev : [...prev, cityName]));
    setSnappedCities((prev) => {
      if (!prev) return prev;
      const updated = [...prev];
      const origLoc = simResult?.suggested_locations[index];
      updated[index] = {
        lat: origLoc?.lat ?? 0,
        lng: origLoc?.lng ?? 0,
        city_name: "",
        is_snapped: false,
      };
      return updated;
    });
  }, [simResult]);

  // Ocultar/mostrar en mapa (sin afectar el cálculo Voronoi).
  const toggleHiddenBranch = useCallback((id: string) => {
    setHiddenBranchIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }, []);

  // Cerrar/restaurar en la simulación: excluye del Voronoi y re-diagnostica siempre.
  const toggleClosedBranch = useCallback((id: string) => {
    setClosedBranchIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      diagnoseCore(visualAreaRef.current, next);
      return next;
    });
  }, [diagnoseCore]);

  // Toggle includeInactive: sincroniza el ref ANTES de llamar a diagnoseCore para que
  // la nueva función estable lea el valor actualizado (el efecto de sync corre después).
  const handleToggleIncludeInactive = useCallback(() => {
    setIncludeInactive((v) => {
      const next = !v;
      includeInactiveRef.current = next;
      diagnoseCore(visualAreaRef.current, closedBranchIdsRef.current);
      return next;
    });
  }, [diagnoseCore]);

  // Pausa/reanuda una sugerencia (análisis "What-If"): no la elimina, solo la
  // excluye temporalmente del mapa y de la Proyección de Impacto.
  const togglePauseSuggestion = useCallback((index: number) => {
    setSnappedCities((prev) => {
      if (!prev) return prev;
      return prev.map((c, i) => (i === index ? { ...c, is_paused: !c.is_paused } : c));
    });
  }, []);

  // Sugerencias activas (no pausadas): se filtran del mismo modo y en el
  // mismo orden, así `suggestedLocations`/`snappedCities` siguen alineados al
  // pasarlos a VoronoiCoverageMap y a la Proyección de Impacto.
  const activeSuggestionLocations = useMemo(() => {
    if (!simResult) return undefined;
    return simResult.suggested_locations.filter((_, i) => !snappedCities?.[i]?.is_paused);
  }, [simResult, snappedCities]);

  const activeSnappedCities = useMemo(() => {
    if (!snappedCities) return snappedCities;
    return snappedCities.filter((c) => !c.is_paused);
  }, [snappedCities]);

  // Cuando hay sucursales cerradas, simResult.diagram_cells tiene las formas
  // Voronoi recalculadas (las celdas vecinas se expanden para cubrir el
  // territorio de las cerradas). Se enriquecen con la severidad de simulación
  // para que el mapa las coloree correctamente.
  const activeDiagramCells = useMemo<CoverageCell[]>(() => {
    if (!simResult?.diagram_cells?.length) {
      return diagram?.cells ?? [];
    }
    const diagByBranch = new Map(simResult.cells.map((c) => [c.branch_id, c]));
    return simResult.diagram_cells.map((cell) => {
      const diag = diagByBranch.get(cell.branch_id);
      return diag ? { ...cell, is_gap: diag.is_gap, gap_severity: diag.severity } : cell;
    });
  }, [simResult, diagram]);

  // Celdas visibles del mapa: excluye las sucursales ocultas o cerradas.
  const visibleCells = useMemo(() => {
    const hidden = new Set([...hiddenBranchIds, ...closedBranchIds]);
    if (hidden.size === 0) return activeDiagramCells;
    return activeDiagramCells.filter((c) => !hidden.has(c.branch_id));
  }, [activeDiagramCells, hiddenBranchIds, closedBranchIds]);

  // Lista unificada para el panel "Sucursales" — siempre incluye las celdas
  // del diagrama (activas); agrega las inactivas cuando el toggle está on.
  const panelBranches = useMemo((): PanelBranchItem[] => {
    if (!diagram) return [];
    const diagramIds = new Set(diagram.cells.map((c) => c.branch_id));

    const items: PanelBranchItem[] = diagram.cells.map((cell) => {
      const simCell = simResult?.cells.find((c) => c.branch_id === cell.branch_id);
      const severity = simCell
        ? simCell.severity
        : cell.is_gap ? cell.gap_severity : "";
      return {
        id: cell.branch_id,
        name: cell.branch_name,
        status: "activo" as const,
        severity,
        isInactive: false,
        coveragePercentage: simCell?.coverage_percentage,
        deficitKm2: simCell?.deficit_km2,
        lat: cell.site.lat,
        lng: cell.site.lng,
      };
    });

    if (includeInactive) {
      allBranches
        .filter((b) => b.status !== "activo" && !diagramIds.has(b.id) && b.latitude != null && b.longitude != null)
        .forEach((b) => {
          const simCell = simResult?.cells.find((c) => c.branch_id === b.id);
          items.push({
            id: b.id,
            name: b.name,
            status: b.status,
            severity: simCell?.severity ?? null,
            isInactive: true,
            coveragePercentage: simCell?.coverage_percentage,
            deficitKm2: simCell?.deficit_km2,
            lat: b.latitude,
            lng: b.longitude,
          });
        });
    }

    const RANK: Record<string, number> = { critico: 3, moderado: 2, leve: 1, "": 0 };
    return items.sort((a, b) => {
      if (a.isInactive !== b.isInactive) return a.isInactive ? 1 : -1;
      return (RANK[b.severity ?? ""] ?? 0) - (RANK[a.severity ?? ""] ?? 0);
    });
  }, [diagram, simResult, allBranches, includeInactive]);

  // Partición por zona de análisis: cuando hay una zona personalizada activa,
  // el panel de sucursales sigue listando TODAS las sucursales, pero separadas
  // en dos grupos — dentro y fuera de la zona. El cálculo de Voronoi es global
  // (una sucursal fuera de la zona igual afecta las celdas de adentro), así que
  // las de afuera siguen siendo interactivas. `inZoneBranchIds` se reutiliza
  // para acotar la Proyección de Impacto a las sucursales de la zona.
  const isZoneActive = territoryMode === "custom" && !!customBoundary && customBoundary.length >= 3;

  // Total area of the active zone — drives the adaptive slider bounds.
  const zoneAreaKm2 = useMemo(() => {
    if (isZoneActive && customBoundary && customBoundary.length >= 3) {
      return polygonAreaKm2(customBoundary);
    }
    return diagram?.total_area_km2 ?? SIM_AREA_MAX;
  }, [isZoneActive, customBoundary, diagram]);

  // Bounding box de la zona activa para las zonas industriales. Devuelve
  // undefined solo cuando no hay zona personalizada (el mapa cae entonces al
  // viewport). El backend sirve las zonas IGN desde memoria, sin límite de
  // tamaño, así que una zona grande ya no se descarta.
  const heatmapBbox = useMemo<string | undefined>(() => {
    if (!customBoundary || customBoundary.length < 3) return undefined;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of customBoundary) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    return `${minLng},${minLat},${maxLng},${maxLat}`;
  }, [customBoundary]);

  // Clamp the coverage-radius slider whenever the zone area changes.
  // The floor stays at SIM_AREA_MIN (~4 km radius) even nationally so dense
  // metros (AMBA) can use a tight radius that exposes uncovered demand — a
  // larger floor would let a single central branch blanket the whole metro and
  // suppress all suggestions there.
  useEffect(() => {
    const minA = SIM_AREA_MIN;
    const maxA = Math.max(minA, Math.min(SIM_AREA_MAX, Math.round(zoneAreaKm2 * 0.25)));
    setVisualArea((prev) => Math.max(minA, Math.min(maxA, prev)));
  }, [zoneAreaKm2]);

  const isBranchInZone = useCallback(
    (b: PanelBranchItem) =>
      b.lat != null && b.lng != null && !!customBoundary && rayCastPointInPolygon(b.lat, b.lng, customBoundary),
    [customBoundary],
  );

  const inZonePanelBranches = useMemo((): PanelBranchItem[] => {
    if (!isZoneActive) return panelBranches;
    return panelBranches.filter(isBranchInZone);
  }, [panelBranches, isZoneActive, isBranchInZone]);

  const outOfZonePanelBranches = useMemo((): PanelBranchItem[] => {
    if (!isZoneActive) return [];
    return panelBranches.filter((b) => !isBranchInZone(b));
  }, [panelBranches, isZoneActive, isBranchInZone]);

  const inZoneBranchIds = useMemo(
    () => new Set(inZonePanelBranches.map((b) => b.id)),
    [inZonePanelBranches],
  );

  // Resumen de fallos por tipo de error en el último lote de snapping.
  const failureSummary = useMemo(() => {
    if (!snappedCities) return null;
    let timeouts = 0;
    let noResults = 0;
    for (const c of snappedCities) {
      if (!c.is_snapped) {
        if (c.error_reason === "TIMEOUT") timeouts++;
        else if (c.error_reason === "NO_RESULTS") noResults++;
      }
    }
    if (timeouts === 0 && noResults === 0) return null;
    return { timeouts, noResults };
  }, [snappedCities]);

  // Recalcula la proyección de impacto contra el backend cada vez que cambia
  // simResult o el conjunto de sugerencias activas — incluyendo cuando
  // removeSuggestion/togglePauseSuggestion lo actualizan, para que el
  // "What-If" se mantenga sincronizado con las tarjetas visibles.
  useEffect(() => {
    if (!simResult || !activeSuggestionLocations || activeSuggestionLocations.length === 0) {
      setProjection(null);
      setProjectionError(null);
      return;
    }
    setProjectionLoading(true);
    setProjectionError(null);
    const suggestions = activeSuggestionLocations.map((loc) => ({ lat: loc.lat, lng: loc.lng }));
    // Scope the projection to the active zone: el cálculo de Voronoi (actual y
    // proyectado) se recorta contra la misma zona del diagnóstico, así los
    // porcentajes reflejan la cobertura dentro de la zona y no la nacional.
    const boundingArea =
      isZoneActive && customBoundary ? customBoundary.map(([lat, lng]) => ({ lat, lng })) : undefined;
    coverageApi
      .project(simResult.simulated_area_km2, suggestions, boundingArea)
      .then((res) => setProjection(res.branches))
      .catch(() => setProjectionError("No se pudo calcular la proyección de impacto en este momento."))
      .finally(() => setProjectionLoading(false));
  }, [simResult, activeSuggestionLocations, isZoneActive, customBoundary]);

  // Proyección de Impacto acotada: cuando hay una zona de análisis activa, solo
  // mostramos las sucursales que están dentro de la zona (a diferencia del panel
  // de Sucursales, que lista las de adentro y las de afuera por separado).
  const visibleProjection = useMemo((): BranchProjection[] | null => {
    if (!projection) return null;
    if (!isZoneActive) return projection;
    return projection.filter((p) => inZoneBranchIds.has(p.branch_id));
  }, [projection, isZoneActive, inZoneBranchIds]);

  const gaps = useMemo<CoverageCell[]>(() => {
    if (!diagram) return [];
    return [...diagram.cells]
      .filter((c) => c.is_gap)
      .sort(
        (a, b) =>
          (SEVERITY_RANK[b.gap_severity] ?? 0) - (SEVERITY_RANK[a.gap_severity] ?? 0) ||
          b.area_km2 - a.area_km2
      );
  }, [diagram]);

  const severityCounts = useMemo(() => {
    const counts = { critico: 0, moderado: 0, leve: 0 };
    gaps.forEach((g) => {
      if (g.gap_severity === "critico") counts.critico++;
      else if (g.gap_severity === "moderado") counts.moderado++;
      else if (g.gap_severity === "leve") counts.leve++;
    });
    return counts;
  }, [gaps]);

  // Contenido principal: mapa + panel lateral, o un placeholder de carga/error.
  // "Dashboard bloqueado": en desktop la fila ocupa el alto restante de la
  // pantalla. El mapa llena ese alto; el panel lateral scrollea de forma
  // independiente (overflow-y-auto) sin estirar la página. En mobile/tablet
  // se mantiene el stack vertical normal. En pantalla completa, el contenedor
  // ya no resta el alto del topbar (no es visible) y descuenta solo el
  // encabezado propio de esta sección.
  const gridHeightClass = isFullscreen ? "lg:h-[calc(100vh-8rem)]" : "lg:h-[calc(100vh-10rem)]";

  let body: ReactNode;

  if (loading) {
    body = <SkeletonCard className="h-[600px]" />;
  } else if (error) {
    body = (
      <Card variant="muted" className="flex flex-col items-center justify-center h-[400px] gap-3">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </Card>
    );
  } else if (!diagram || diagram.branch_count < 3) {
    body = (
      <Card variant="muted" className="flex flex-col items-center justify-center h-[400px] gap-2 text-center px-6">
        <MapPin className="w-10 h-10 text-slate-300" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          No hay suficientes sucursales activas para calcular la cobertura
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Se necesitan al menos 3 sucursales con coordenadas para construir el diagrama de cobertura.
        </p>
      </Card>
    );
  } else {
    const coveredCount = diagram.branch_count - diagram.gap_count;

    const simScopeLabel = highlighted
      ? diagram.cells.find((c) => c.branch_id === highlighted)?.branch_name ?? "Sucursal seleccionada"
      : "Todas las sucursales";

    body = (
      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 ${gridHeightClass}`}>
        {/* Mapa — ocupa 2/3 en desktop, ancho completo en mobile/tablet.
            `isolate` crea un nuevo stacking context: los panes/controles de
            Leaflet (z-index hasta 1000) quedan contenidos dentro del Card y
            nunca compiten con el z-index del topbar sticky (z-50). */}
        <Card className="lg:col-span-2 overflow-hidden !cursor-default p-0 isolate">
          <div className="h-[420px] sm:h-[520px] lg:h-full w-full">
            <VoronoiCoverageMap
              ref={coverageMapRef}
              cells={visibleCells}
              highlightedBranchId={highlighted}
              onSelectBranch={handleSelectBranch}
              simulationAreaKm2={visualArea}
              suggestedLocations={activeSuggestionLocations}
              snappedCities={activeSnappedCities}
              isDrawingBoundary={isDrawingBoundary}
              onBoundaryComplete={handleBoundaryComplete}
              onBoundaryCancel={handleBoundaryCancel}
              customBoundary={customBoundary}
              redrawReference={redrawReference}
              isEditingBoundary={isEditingBoundary}
              onBoundaryEdited={handleBoundaryEdited}
              onBoundaryEditCancel={handleBoundaryEditCancel}
              showIndustrialHeatmap={showIndustrialHeatmap}
              heatmapBbox={heatmapBbox}
              onIndustrialHeatmapLoaded={(count, error) => {
                setIndustrialHeatmapLoading(false);
                setIndustrialZoneResult({ count, error: error ?? false });
              }}
              rejectedLocations={showRejectedOnMap && rejectedLocations.length > 0 ? rejectedLocations : undefined}
            />
          </div>
        </Card>

        {/* Panel: simulador + situación actual + recomendaciones — scroll propio en desktop */}
        <div className="flex flex-col gap-4 lg:h-full lg:overflow-y-auto lg:pr-1">
          <Card variant="muted" className="p-5">
            <CollapsiblePanel
              title={
                <>
                  <Target className="w-4 h-4 text-orange-500" /> Simulador de cobertura
                </>
              }
            >
              <CoverageSimulatorPanel
                areaKm2={visualArea}
                onAreaChange={setVisualArea}
                onConfirm={handleConfirmSimulation}
                onMinPopulationChange={setSnapMinPopulation}
                maxSuggestions={maxSuggestions}
                onMaxSuggestionsChange={setMaxSuggestions}
                scopeLabel={simScopeLabel}
                disabled={isFetchingCities || isDiagnosing}
                isDiagnosing={isDiagnosing}
                territoryMode={territoryMode}
                customBoundaryPoints={customBoundary?.length ?? 0}
                isDrawingBoundary={isDrawingBoundary}
                isEditingBoundary={isEditingBoundary}
                onStartEditBoundary={customBoundary && customBoundary.length >= 3 ? handleStartEditBoundary : undefined}
                onClearBoundary={handleClearBoundary}
                regions={regions}
                selectedRegionId={selectedRegionId}
                onRegionChange={handleRegionChange}
                onStartDrawNewRegion={handleStartDrawNewRegion}
                canEditSelectedRegion={regions.find((r) => r.id === selectedRegionId)?.type === "custom"}
                onEditRegion={handleStartEditRegion}
                diagnosisMode={diagnosisMode}
                onDiagnosisModeChange={setDiagnosisMode}
                minDensity={minDensity}
                onMinDensityChange={setMinDensity}
                prioritizeIndustrial={prioritizeIndustrial}
                onPrioritizeIndustrialChange={setPrioritizeIndustrial}
                applyTerrainFriction={applyTerrainFriction}
                onApplyTerrainFrictionChange={setApplyTerrainFriction}
                minSeparation={minSeparation}
                onMinSeparationChange={setMinSeparation}
                minScore={minScore}
                onMinScoreChange={setMinScore}
                showRejectedOnMap={showRejectedOnMap}
                onShowRejectedOnMapChange={setShowRejectedOnMap}
                zoneAreaKm2={zoneAreaKm2}
                showIndustrialHeatmap={showIndustrialHeatmap}
                onIndustrialHeatmapChange={(v) => {
                  setShowIndustrialHeatmap(v);
                  setIndustrialZoneResult(null);
                  if (v) setIndustrialHeatmapLoading(true);
                  else setIndustrialHeatmapLoading(false);
                }}
                industrialHeatmapLoading={industrialHeatmapLoading}
                industrialZoneResult={industrialZoneResult}
              />
              {simResult !== null && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Último diagnóstico confirmado para {formatKm2(simResult.simulated_area_km2)} ({simScopeLabel}).
                </p>
              )}
              {simResult !== null && simResult.suggested_locations.length === 0 && !simError && (
                diagnosisMode === "density" ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    No se encontraron ciudades sin cobertura en la zona con los filtros actuales. Probá ampliar el área, bajar la población mínima o usá el modo Radio de cobertura.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                    No se detectaron vacíos de cobertura con este radio. Reducí el radio de cobertura para ver sugerencias de nuevas sucursales.
                  </p>
                )
              )}
              {simError && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{simError}</p>
              )}
              {regionSaveError && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">
                  {regionSaveError}
                </p>
              )}
              {simResult && simResult.suggested_locations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-gray-700">
                  {pendingSnapIndexes.length > 0 ? (
                    <button
                      onClick={() => void handleSnapToCity()}
                      disabled={isFetchingCities}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-slate-300 dark:border-gray-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-gray-700/40 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isFetchingCities ? "animate-spin" : ""}`} />
                      {snappingProgress
                        ? `Aterrizando ${snappingProgress.current} de ${snappingProgress.total}…`
                        : snappedCities
                          ? `Reintentar ${pendingSnapIndexes.length} sugerencia${pendingSnapIndexes.length === 1 ? "" : "s"} pendiente${pendingSnapIndexes.length === 1 ? "" : "s"}`
                          : "Aterrizar sugerencias en ciudades reales"}
                    </button>
                  ) : (
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      Todas las sugerencias fueron aterrizadas en ciudades reales.
                    </p>
                  )}
                  {snapError && (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{snapError}</p>
                  )}
                  {failureSummary && (
                    <div className="mt-2 space-y-0.5">
                      {failureSummary.timeouts > 0 && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">
                          {failureSummary.timeouts === 1
                            ? "1 sugerencia no pudo buscarse"
                            : `${failureSummary.timeouts} sugerencias no pudieron buscarse`}{" "}
                          (Timeout de API)
                        </p>
                      )}
                      {failureSummary.noResults > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {failureSummary.noResults === 1
                            ? "1 sugerencia sin ciudades"
                            : `${failureSummary.noResults} sugerencias sin ciudades`}
                          {snapMinPopulation > 0
                            ? ` con más de ${snapMinPopulation.toLocaleString("es-AR")} hab. en el radio`
                            : " en el radio de búsqueda"}
                        </p>
                      )}
                    </div>
                  )}
                  {snappedCities && !snapError && (
                    <>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {snappedCount} de {snappedCities.length} sugerencias aterrizadas en ciudades reales cercanas.
                        {pendingSnapIndexes.length > 0 && " Si no se encuentra alguna, pruebe nuevamente."}
                      </p>
                      {snappedCount > 0 && (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            {snappedCount} {snappedCount === 1 ? "ciudad candidata confirmada" : "ciudades candidatas confirmadas"}:
                          </p>
                          <ul className="space-y-2">
                            {snappedCities
                              .map((c, i) => ({ city: c, index: i }))
                              .filter(({ city }) => city.is_snapped)
                              .sort((a, b) =>
                                computeWeightedScore(simResult.suggested_locations[b.index], effectiveWeights) -
                                computeWeightedScore(simResult.suggested_locations[a.index], effectiveWeights)
                              )
                              .map(({ city, index }) => (
                                <SuggestionCard
                                  key={`${city.city_name}-${index}`}
                                  city={city}
                                  loc={simResult.suggested_locations[index]}
                                  onRemove={() => removeSuggestion(index)}
                                  onTogglePause={() => togglePauseSuggestion(index)}
                                  onBlacklist={(name) => blacklistCity(index, name)}
                                  onFlyTo={handleFlyToLocation}
                                  weights={effectiveWeights}
                                />
                              ))}
                          </ul>
                        </div>
                      )}
                      {(() => {
                        const unsnapped = snappedCities
                          .map((c, i) => ({ city: c, index: i }))
                          .filter(({ city }) => !city.is_snapped);
                        if (unsnapped.length === 0) return null;
                        return (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                              {unsnapped.length} sugerencia{unsnapped.length !== 1 ? "s" : ""} pendiente{unsnapped.length !== 1 ? "s" : ""} de asignación:
                            </p>
                            <ul className="space-y-2">
                              {unsnapped.map(({ city, index }, ui) => {
                                const loc = simResult.suggested_locations[index];
                                const isPaused = city.is_paused ?? false;
                                return (
                                  <li
                                    key={index}
                                    className={`relative p-3 pr-16 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 transition-opacity ${isPaused ? "opacity-50" : ""}`}
                                  >
                                    <div className="absolute top-2 right-2 flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        onClick={() => togglePauseSuggestion(index)}
                                        title={isPaused ? "Reanudar sugerencia" : "Pausar sugerencia"}
                                        className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer transition-colors"
                                      >
                                        {isPaused ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeSuggestion(index)}
                                        title="Descartar sugerencia"
                                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 cursor-pointer transition-colors"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleFlyToLocation(loc.lat, loc.lng)}
                                      title="Centrar mapa en esta sugerencia"
                                      className="text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer transition-colors text-left"
                                    >
                                      ID-{ui + 1}
                                    </button>
                                    <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
                                      {(loc.actual_added_km2 ?? 0) > 0 && (
                                        <>Aportará ~{formatKm2(loc.actual_added_km2)} de cobertura neta. </>
                                      )}
                                      {(loc.affected_branches ?? []).length > 0 && (
                                        <>Descomprimirá las zonas de: {(loc.affected_branches ?? []).join(", ")}.</>
                                      )}
                                    </p>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })()}
                      {snappedCount > 0 && diagnosisMode === "density" && (
                        <button
                          type="button"
                          disabled={isFindingMore || isDiagnosing}
                          onClick={handleFindMore}
                          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isFindingMore ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              Buscando más sugerencias…
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3.5 h-3.5" />
                              Buscar más sugerencias
                              {excludedCitiesForMore.length > 0 && (
                                <span className="ml-1 text-slate-400">
                                  (excluyendo {excludedCitiesForMore.length} {excludedCitiesForMore.length === 1 ? "ciudad" : "ciudades"})
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      )}
                      {findMoreSummary && !isFindingMore && (
                        <p className={`mt-1.5 text-xs ${findMoreSummary.error ? "text-rose-600 dark:text-rose-400" : findMoreSummary.found === 0 ? "text-slate-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {findMoreSummary.error
                            ? "Error al buscar más sugerencias."
                            : findMoreSummary.found === 0
                              ? "No se encontraron más sugerencias."
                              : `Se encontraron ${findMoreSummary.found} sugerencia${findMoreSummary.found === 1 ? "" : "s"} nueva${findMoreSummary.found === 1 ? "" : "s"}.`}
                        </p>
                      )}
                    </>
                  )}
                  {simResult !== null && rejectedLocations.length > 0 && (
                    <details className="mt-3 group">
                      <summary className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                        Ciudades descartadas ({rejectedLocations.length})
                        <span className="normal-case font-normal tracking-normal text-slate-400 ml-1">· No viables</span>
                      </summary>
                      <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {rejectedLocations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 p-2 rounded-lg bg-slate-100/70 dark:bg-gray-700/40 border border-slate-200 dark:border-gray-600">
                            {(r.score ?? 0) > 0 && <ScoreBadge score={r.score!} size="sm" />}
                            <div className="min-w-0">
                              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{r.city_name}</span>
                              <span className="block text-[10px] text-slate-500 dark:text-slate-400 leading-snug">{r.reject_reason}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {((visibleProjection && visibleProjection.length > 0) || projectionLoading || projectionError) && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-gray-700">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                        <Gauge className="w-3.5 h-3.5" /> Proyección de impacto
                        {isZoneActive && <span className="font-medium normal-case tracking-normal text-slate-400">· sucursales de la zona</span>}
                      </p>
                      {projectionLoading && (
                        <p className="text-xs text-slate-400">Calculando proyección…</p>
                      )}
                      {projectionError && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">{projectionError}</p>
                      )}
                      {visibleProjection && visibleProjection.length > 0 && (
                        <ul className="space-y-1.5">
                          {visibleProjection.map((p) => (
                            <li
                              key={p.branch_id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {p.branch_name}
                              </span>
                              <span className="font-mono text-slate-500 dark:text-slate-400">
                                {Math.round(p.current_coverage_pct)}% &rarr;{" "}
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                  {Math.round(p.projected_coverage_pct)}%
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CollapsiblePanel>
          </Card>

          <Card variant="muted" className="p-5">
            <CollapsiblePanel
              title={
                <>
                  <MapPin className="w-4 h-4 text-blue-600" /> Situación actual
                </>
              }
            >
              <SituationSummary
                covered={coveredCount}
                total={diagram.branch_count}
                gapCount={diagram.gap_count}
                severity={severityCounts}
                threshold={diagram.threshold_km2}
                simResult={simResult}
                highlighted={highlighted}
                zoneActive={isZoneActive}
                branchFilter={isZoneActive ? inZoneBranchIds : null}
              />
            </CollapsiblePanel>
          </Card>

          <Card variant="muted" className="p-5">
            <CollapsiblePanel
              title={
                <>
                  <Building2 className="w-4 h-4 text-blue-500" /> Sucursales
                </>
              }
            >
              <BranchSimulationPanel
                branches={inZonePanelBranches}
                outOfZoneBranches={outOfZonePanelBranches}
                zoneActive={isZoneActive}
                hiddenBranchIds={hiddenBranchIds}
                closedBranchIds={closedBranchIds}
                includeInactive={includeInactive}
                onToggleIncludeInactive={handleToggleIncludeInactive}
                onToggleHide={toggleHiddenBranch}
                onToggleClose={toggleClosedBranch}
                onFlyTo={handleFlyToLocation}
              />
            </CollapsiblePanel>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={isFullscreen ? "fullscreen-mode" : ""}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <MapPin className="w-4 h-4 text-blue-600" /> Cobertura territorial
          </h2>
          <p className="text-[11px] text-slate-400">
            Diagrama de cobertura por sucursal (Voronoi) y detección de zonas sub-cubiertas
          </p>
        </div>
        <button
          onClick={() => setShowScoreSettings(true)}
          title="Configurar pesos del Índice de Viabilidad"
          aria-label="Configurar puntuación"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => setIsFullscreen((v) => !v)}
          title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-gray-700 cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
      {body}

      {/* ── Modal: configuración de pesos del Índice de Viabilidad ─────────── */}
      {showScoreSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowScoreSettings(false)}>
          <div
            className="w-full max-w-md mx-4 rounded-xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-700 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Settings className="w-4 h-4 text-violet-500" />
                Pesos del Índice de Viabilidad
              </h3>
              <button onClick={() => setShowScoreSettings(false)} className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ajustá la importancia de cada factor positivo. El subtotal se normaliza automáticamente a 100 antes de aplicar la penalización de terreno.
            </p>

            {/* ── Factores positivos ── */}
            {(
              [
                {
                  key: "pop" as const,
                  label: "👥 Población",
                  desc: "Escala logarítmica sobre la población de la ciudad. 3 000 000 hab. = máximo.",
                  max: 60,
                },
                {
                  key: "density" as const,
                  label: "🏙 Densidad",
                  desc: "Escala lineal. 300 hab./km² de nueva cobertura = máximo. Favorece ciudades densas.",
                  max: 60,
                },
                {
                  key: "area" as const,
                  label: "📦 Área útil",
                  desc: "Escala logarítmica. Km² netos que el círculo de cobertura aporta sobre territorio argentino no cubierto.",
                  max: 60,
                },
                {
                  key: "industry" as const,
                  label: "🏭 Industrial",
                  desc: "Bonus fijo si hay zonas industriales IGN a menos de ~10 km. Premia la cercanía a parques logísticos.",
                  max: 40,
                },
              ]
            ).map(({ key, label, desc, max }) => (
              <div key={key} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-200 font-medium">{label}</span>
                  <span className="tabular-nums font-semibold text-violet-600 dark:text-violet-400">{scoreWeights[key]} pts</span>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">{desc}</p>
                <input
                  type="range"
                  min={0}
                  max={max}
                  step={1}
                  value={scoreWeights[key]}
                  onChange={(e) => setScoreWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  className="w-full accent-violet-600 mt-1"
                />
                <div className="flex justify-between text-[9px] text-slate-400">
                  <span>0</span><span>{max}</span>
                </div>
              </div>
            ))}

            {/* ── Penalización de terreno ── */}
            <div className="pt-3 border-t border-slate-100 dark:border-gray-700 space-y-0.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-700 dark:text-slate-200 font-medium">⛰️ Penalización de terreno</span>
                <span className="tabular-nums font-semibold text-rose-500 dark:text-rose-400">−{scoreWeights.terrain} pts máx.</span>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
                Puntos que se <strong>restan</strong> al score final según la dificultad orográfica. Se aplica en proporción: Llano −0, Llano-Ventoso −{(0.25 * scoreWeights.terrain).toFixed(0)}, Semi-montañoso −{(0.5 * scoreWeights.terrain).toFixed(0)}, Serrano −{(0.75 * scoreWeights.terrain).toFixed(0)}, Montañoso −{scoreWeights.terrain}.
              </p>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={scoreWeights.terrain}
                onChange={(e) => setScoreWeights((prev) => ({ ...prev, terrain: Number(e.target.value) }))}
                className="w-full accent-rose-500 mt-1"
              />
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>0 (sin penalización)</span><span>50</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-gray-700">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Base máx.: <strong className="text-slate-700 dark:text-slate-200">{scoreWeights.pop + scoreWeights.density + scoreWeights.area + scoreWeights.industry} pts</strong>
              </span>
              <button
                onClick={() => setScoreWeights(DEFAULT_SCORE_WEIGHTS)}
                className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
              >
                Restaurar valores
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: guardar zona dibujada ─────────────────────────────────────── */}
      {showSaveRegionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-xl bg-white dark:bg-gray-900 shadow-2xl border border-slate-200 dark:border-gray-700 p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {editingRegionId ? "Editar zona personalizada" : "Guardar zona personalizada"}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {editingRegionId
                ? "Confirmá el nombre y la nueva forma de la zona."
                : "Asigná un nombre a esta zona para reutilizarla en futuros análisis."}
            </p>
            <input
              type="text"
              value={savingRegionName}
              onChange={(e) => setSavingRegionName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSaveNewRegion(); }}
              placeholder="Ej. Patagonia, GBA Norte…"
              autoFocus
              maxLength={60}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {regionSaveError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">
                {regionSaveError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCancelSaveRegion}
                disabled={savingRegion}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-gray-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-800 cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSaveNewRegion()}
                disabled={savingRegion || !savingRegionName.trim()}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingRegion ? "Guardando…" : editingRegionId ? "Guardar cambios" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Situación actual": estado de cobertura de la red. Si hay una simulación
 * activa, su diagnóstico tiene prioridad — un radio simulado con déficits
 * reemplaza el mensaje verde estático (que reflejaría solo el diagrama real,
 * no el escenario que el usuario está evaluando) por un resumen de alerta u
 * OK basado en la simulación. Sin simulación activa, se muestra el
 * diagnóstico real del diagrama de cobertura.
 */
function SituationSummary({
  covered,
  total,
  gapCount,
  severity,
  threshold,
  simResult,
  highlighted,
  zoneActive = false,
  branchFilter = null,
}: {
  covered: number;
  total: number;
  gapCount: number;
  severity: { critico: number; moderado: number; leve: number };
  threshold: number;
  simResult: SimulationResult | null;
  highlighted: string | null;
  /** true cuando hay una zona de análisis activa — acota el resumen a la zona. */
  zoneActive?: boolean;
  /** IDs de sucursales dentro de la zona; null = sin acotar (nacional). */
  branchFilter?: Set<string> | null;
}) {
  const simCells = (() => {
    if (!simResult) return [];
    let cs = simResult.cells;
    if (branchFilter) cs = cs.filter((c) => branchFilter.has(c.branch_id));
    if (highlighted) cs = cs.filter((c) => c.branch_id === highlighted);
    return cs;
  })();
  const simGapCells = simCells.filter((c) => c.is_gap);
  const areaLabel = simResult ? formatKm2(simResult.simulated_area_km2) : "";

  let statusBlock: ReactNode = null;
  if (simCells.length > 0) {
    if (simGapCells.length > 0) {
      statusBlock = (
        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>
            <strong>Estado: Alerta.</strong>{" "}
            {highlighted
              ? `Esta sucursal presenta un déficit de cobertura bajo el radio simulado actual de ${areaLabel}.`
              : `${simGapCells.length} de ${simCells.length} sucursales presentan un déficit de cobertura bajo el radio simulado actual de ${areaLabel}.`}
          </p>
        </div>
      );
    } else {
      statusBlock = (
        <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <p>
            <strong>Estado: OK.</strong>{" "}
            {highlighted
              ? `Un radio de cobertura simulado de ${areaLabel} alcanzaría para cubrir adecuadamente el territorio de esta sucursal.`
              : `Un radio de cobertura simulado de ${areaLabel} alcanzaría para cubrir adecuadamente el territorio de las ${simCells.length} sucursales.`}
          </p>
        </div>
      );
    }
  } else if (zoneActive) {
    // Zona activa sin diagnóstico todavía: el resumen nacional no aplica.
    statusBlock = (
      <div className="flex items-start gap-2 text-slate-500 dark:text-slate-400">
        <Info className="w-5 h-5 shrink-0 mt-0.5" />
        <p>Confirmá un diagnóstico para ver la situación de cobertura de la zona seleccionada.</p>
      </div>
    );
  } else if (gapCount === 0) {
    statusBlock = (
      <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
        <p>
          La red de <strong>{total}</strong> sucursales cubre adecuadamente el territorio. No se
          detectan zonas con cobertura insuficiente según el umbral de {formatKm2(threshold)} por
          sucursal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
      {statusBlock}
      {/* Resumen nacional de gaps: solo sin zona activa (con zona, el estado de
          arriba ya está acotado a la zona y este conteo nacional confundiría). */}
      {!zoneActive && gapCount > 0 && (
        <>
          <p>
            De <strong>{total}</strong> sucursales activas, <strong>{covered}</strong> tienen cobertura
            adecuada y <strong className="text-rose-600 dark:text-rose-400">{gapCount}</strong> presentan
            un área de servicio mayor al umbral de {formatKm2(threshold)}.
          </p>
          <div className="flex flex-wrap gap-2">
            {severity.critico > 0 && (
              <SeverityPill count={severity.critico} severity="critico" />
            )}
            {severity.moderado > 0 && (
              <SeverityPill count={severity.moderado} severity="moderado" />
            )}
            {severity.leve > 0 && <SeverityPill count={severity.leve} severity="leve" />}
          </div>
        </>
      )}
    </div>
  );
}

function SeverityPill({
  count,
  severity,
}: {
  count: number;
  severity: "critico" | "moderado" | "leve";
}) {
  const s = GAP_STYLE[severity];
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.badge}`}>
      {count} {s.label.toLowerCase()}
      {count > 1 ? "s" : ""}
    </span>
  );
}

type ScoreWeightsConfig = { pop: number; density: number; area: number; industry: number; terrain: number };
const DEFAULT_SCORE_WEIGHTS: ScoreWeightsConfig = { pop: 20, density: 20, area: 35, industry: 15, terrain: 20 };

/** Returns Tailwind color classes based on the 1–100 Logistics Viability Score. */
function scoreColor(score: number): { ring: string; bg: string; text: string } {
  if (score >= 80) return { ring: "ring-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400" };
  if (score >= 50) return { ring: "ring-amber-400",   bg: "bg-amber-50 dark:bg-amber-900/30",   text: "text-amber-700 dark:text-amber-400"   };
  return               { ring: "ring-rose-400",    bg: "bg-rose-50 dark:bg-rose-900/30",     text: "text-rose-700 dark:text-rose-400"     };
}

// terrainFactor: 0 (Llano) → 1.0 (Montañoso), proportional penalty scale.
const TERRAIN_FACTORS: Record<string, number> = {
  "Llano": 0, "Llano-Ventoso": 0.2, "Semi-montañoso": 0.5, "Serrano": 0.7, "Montañoso": 1.0,
};

type ScoreBreakdown = { popPts: number; densPts: number; areaPts: number; industryPts: number; terrainPenalty: number };

function computeScoreBreakdown(loc: SuggestedLocation, w: ScoreWeightsConfig = DEFAULT_SCORE_WEIGHTS): ScoreBreakdown {
  const pop = loc.population ?? 0;
  const density = loc.density ?? 0;
  const area = loc.actual_added_km2 ?? loc.gap_area_km2 ?? 0;
  const terrainFactor = TERRAIN_FACTORS[loc.terrain_type ?? ""] ?? 0;
  const popPts = pop > 0 ? Math.min(w.pop, Math.log10(pop) / Math.log10(3_000_000) * w.pop) : 0;
  const densPts = density > 0 ? Math.min(w.density, density / 300 * w.density) : 0;
  const areaPts = area > 0 ? Math.min(w.area, Math.log10(area + 1) / Math.log10(300_001) * w.area) : 0;
  const industryPts = (loc.has_industrial_zone ?? false) ? w.industry : 0;
  const terrainPenalty = terrainFactor * w.terrain;
  return { popPts, densPts, areaPts, industryPts, terrainPenalty };
}

function computeWeightedScore(loc: SuggestedLocation, w: ScoreWeightsConfig): number {
  const b = computeScoreBreakdown(loc, w);
  const totalMax = w.pop + w.density + w.area + w.industry;
  if (totalMax <= 0) return 1;
  const normalized = (b.popPts + b.densPts + b.areaPts + b.industryPts) * (100 / totalMax);
  return Math.round(Math.min(100, Math.max(1, normalized - b.terrainPenalty)));
}

/** Compact circular badge that shows the Logistics Viability Index.
 *  When `loc` is provided, hovering shows a breakdown of how the score was computed. */
function ScoreBadge({ score, size = "md", loc, weights = DEFAULT_SCORE_WEIGHTS }: { score: number; size?: "sm" | "md"; loc?: SuggestedLocation; weights?: ScoreWeightsConfig }) {
  const [hovered, setHovered] = useState(false);
  const breakdown = loc ? computeScoreBreakdown(loc, weights) : null;
  const displayScore = breakdown ? computeWeightedScore(loc!, weights) : score;
  const { ring, bg, text } = scoreColor(displayScore);
  const dim = size === "sm" ? "w-8 h-8 text-[10px]" : "w-10 h-10 text-xs";
  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex flex-col items-center justify-center rounded-full ring-2 font-bold leading-none cursor-help ${dim} ${ring} ${bg} ${text}`}
      >
        <span>{displayScore}</span>
        <span className="text-[8px] font-normal opacity-70">/100</span>
      </div>
      {hovered && breakdown && (
        <div className="absolute left-full top-0 ml-2 z-50 w-56 rounded-lg shadow-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-2.5 pointer-events-none">
          <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-2">
            Índice de Viabilidad: {displayScore}/100
          </p>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">👥 Población</span>
              <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{breakdown.popPts.toFixed(1)}<span className="text-slate-400">/{weights.pop}</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">🏙 Densidad</span>
              <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{breakdown.densPts.toFixed(1)}<span className="text-slate-400">/{weights.density}</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">📦 Área útil</span>
              <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{breakdown.areaPts.toFixed(1)}<span className="text-slate-400">/{weights.area}</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 dark:text-slate-400">🏭 Industrial</span>
              <span className={`font-medium tabular-nums ${breakdown.industryPts > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
                {breakdown.industryPts.toFixed(0)}<span className="text-slate-400">/{weights.industry}</span>
              </span>
            </div>
            {breakdown.terrainPenalty > 0 && (
              <div className="flex justify-between items-center border-t border-slate-100 dark:border-gray-700 pt-1 mt-1 text-rose-500 dark:text-rose-400">
                <span>⛰️ {loc!.terrain_type ?? "Terreno difícil"}</span>
                <span className="font-medium tabular-nums">−{breakdown.terrainPenalty.toFixed(1)} pts</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta de sugerencia "aterrizada": ciudad real candidata a nueva sucursal,
 * con un enlace a Google Maps y el detalle de impacto operativo (cobertura
 * neta real sobre territorio + sucursales que se verían aliviadas). El botón
 * de descarte la quita del estado (y, por lo tanto, del mapa y de la
 * proyección de impacto) sin volver a consultar el backend de diagnóstico.
 * Si el checkbox "Excluir para reintentos" está activo, el descarte agrega
 * el nombre a la blacklist y mantiene el punto para un nuevo reintento.
 */
function SuggestionCard({
  city,
  loc,
  onRemove,
  onTogglePause,
  onBlacklist,
  onFlyTo,
  weights = DEFAULT_SCORE_WEIGHTS,
}: {
  city: SnappedCity;
  loc: SuggestedLocation;
  onRemove: () => void;
  onTogglePause: () => void;
  onBlacklist: (cityName: string) => void;
  onFlyTo: (lat: number, lng: number) => void;
  weights?: ScoreWeightsConfig;
}) {
  const [blacklistChecked, setBlacklistChecked] = useState(false);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${city.lat},${city.lng}`;
  const isPaused = city.is_paused ?? false;
  return (
    <li
      className={`relative p-3 pr-16 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 transition-opacity ${
        isPaused ? "opacity-50" : ""
      }`}
    >
      <div className="absolute top-2 right-2 flex items-center gap-0.5">
        <button
          type="button"
          onClick={onTogglePause}
          aria-label={isPaused ? `Reanudar sugerencia: ${city.city_name}` : `Pausar sugerencia: ${city.city_name}`}
          title={isPaused ? "Reanudar sugerencia" : "Pausar sugerencia"}
          className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer transition-colors"
        >
          {isPaused ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (blacklistChecked) {
              onBlacklist(city.city_name);
            } else {
              onRemove();
            }
          }}
          aria-label={blacklistChecked ? `Excluir ${city.city_name} para reintentos` : `Descartar sugerencia: ${city.city_name}`}
          title={blacklistChecked ? "Excluir para reintentos (reintentará con otra ciudad)" : "Descartar sugerencia"}
          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 cursor-pointer transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-start gap-2">
        {(loc.score ?? 0) > 0 && <ScoreBadge score={loc.score!} loc={loc} weights={weights} />}
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onFlyTo(city.lat, city.lng)}
            title="Centrar mapa en esta ciudad"
            className="text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer transition-colors text-left"
          >
            {city.city_name}
          </button>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> Ver en Google Maps
          </a>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
        {(loc.actual_added_km2 ?? 0) > 0 && (
          <>Aportará ~{formatKm2(loc.actual_added_km2)} de cobertura neta. </>
        )}
        {(loc.affected_branches ?? []).length > 0 && (
          <>Descomprimirá las zonas de: {(loc.affected_branches ?? []).join(", ")}.</>
        )}
      </p>
      {(loc.density ?? 0) > 0 && (
        <p className="mt-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
          {loc.density! >= 1
            ? Math.round(loc.density!).toLocaleString("es-AR")
            : "< 1"} hab./km² de nueva cobertura
        </p>
      )}
      {(loc.has_industrial_zone || (loc.terrain_type && loc.terrain_type !== "Llano")) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {loc.has_industrial_zone && (
            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
              🏭 Zona Industrial Cercana
            </span>
          )}
          {loc.terrain_type && loc.terrain_type !== "Llano" && (
            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-slate-300 font-medium">
              ⛰️ {loc.terrain_type}
            </span>
          )}
        </div>
      )}
      {(city.population ?? 0) > 0 && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Población estimada: {city.population!.toLocaleString("es-AR")} habitantes.
        </p>
      )}
      <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={blacklistChecked}
          onChange={(e) => setBlacklistChecked(e.target.checked)}
          className="w-3 h-3 rounded accent-slate-600"
        />
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          Excluir para reintentos
        </span>
      </label>
    </li>
  );
}

// ── Branch simulation panel ───────────────────────────────────────────────────

interface PanelBranchItem {
  id: string;
  name: string;
  status: Branch["status"];
  /** Coverage severity from simResult or diagram. null = inactive (no coverage data). */
  severity: string | null;
  isInactive: boolean;
  /** Populated from simResult when a diagnosis has been run. */
  coveragePercentage?: number;
  deficitKm2?: number;
  /** Branch coordinates — used for fly-to map navigation. */
  lat?: number;
  lng?: number;
}

function BranchSimulationPanel({
  branches,
  outOfZoneBranches,
  zoneActive,
  hiddenBranchIds,
  closedBranchIds,
  includeInactive,
  onToggleIncludeInactive,
  onToggleHide,
  onToggleClose,
  onFlyTo,
}: {
  /** Sucursales dentro de la zona de análisis (o todas, si no hay zona activa). */
  branches: PanelBranchItem[];
  /** Sucursales fuera de la zona — solo se usa cuando `zoneActive` es true. */
  outOfZoneBranches: PanelBranchItem[];
  /** true cuando hay una zona personalizada activa → se muestran dos listas. */
  zoneActive: boolean;
  hiddenBranchIds: string[];
  closedBranchIds: string[];
  includeInactive: boolean;
  onToggleIncludeInactive: () => void;
  onToggleHide: (id: string) => void;
  onToggleClose: (id: string) => void;
  onFlyTo: (lat: number, lng: number) => void;
}) {
  const closedCount = closedBranchIds.length;
  const hiddenCount = hiddenBranchIds.length;

  const renderCard = (b: PanelBranchItem) => (
    <BranchSimulationCard
      key={b.id}
      branch={b}
      isHidden={hiddenBranchIds.includes(b.id)}
      isClosed={closedBranchIds.includes(b.id)}
      onToggleHide={() => onToggleHide(b.id)}
      onToggleClose={() => onToggleClose(b.id)}
      onFlyTo={b.lat != null && b.lng != null ? () => onFlyTo(b.lat!, b.lng!) : undefined}
    />
  );

  return (
    <div className="space-y-3">
      {/* Toggle includeInactive */}
      <label className="flex items-center gap-2 cursor-pointer select-none group">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={onToggleIncludeInactive}
          className="w-3.5 h-3.5 rounded accent-slate-600 cursor-pointer"
        />
        <span className="text-xs text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
          Incluir sucursales Inactivas y Fuera de servicio en la simulación
        </span>
      </label>

      {branches.length === 0 && outOfZoneBranches.length === 0 ? (
        <p className="text-sm text-slate-400">No hay sucursales disponibles.</p>
      ) : zoneActive ? (
        <>
          {/* Dentro de la zona */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              En la zona de análisis ({branches.length})
            </p>
            {branches.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Ninguna sucursal cae dentro de la zona.</p>
            ) : (
              <ul className="space-y-2">{branches.map(renderCard)}</ul>
            )}
          </div>

          {/* Fuera de la zona */}
          {outOfZoneBranches.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Fuera de la zona ({outOfZoneBranches.length})
              </p>
              <ul className="space-y-2">{outOfZoneBranches.map(renderCard)}</ul>
            </div>
          )}
        </>
      ) : (
        <ul className="space-y-2">{branches.map(renderCard)}</ul>
      )}

      {(closedCount > 0 || hiddenCount > 0) && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          {closedCount > 0 && `${closedCount} excluida${closedCount !== 1 ? "s" : ""} del cálculo${closedCount > 0 && hiddenCount > 0 ? " · " : "."}`}
          {hiddenCount > 0 && `${hiddenCount} oculta${hiddenCount !== 1 ? "s" : ""} del mapa.`}
        </p>
      )}
    </div>
  );
}

const INACTIVE_BADGE: Record<string, string> = {
  inactivo: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  fuera_de_servicio: "bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-300",
};

function BranchSimulationCard({
  branch,
  isHidden,
  isClosed,
  onToggleHide,
  onToggleClose,
  onFlyTo,
}: {
  branch: PanelBranchItem;
  isHidden: boolean;
  isClosed: boolean;
  onToggleHide: () => void;
  onToggleClose: () => void;
  onFlyTo?: () => void;
}) {
  const isDimmed = isHidden || isClosed;

  const coverageBadge = (() => {
    if (branch.severity === null) {
      return {
        label: branchStatusLabel(branch.status),
        className: INACTIVE_BADGE[branch.status] ?? "bg-slate-100 text-slate-600",
      };
    }
    if (!branch.severity) return { label: "Adecuada", className: ADEQUATE_BADGE };
    const style = GAP_STYLE[branch.severity as keyof typeof GAP_STYLE];
    return style ? { label: style.label, className: style.badge } : null;
  })();

  return (
    <li
      className={`p-3 rounded-lg border transition-all ${
        isClosed
          ? "border-rose-200 dark:border-rose-800/40 bg-rose-50/40 dark:bg-rose-900/10"
          : isHidden
          ? "border-slate-200 dark:border-gray-700 bg-slate-100/50 dark:bg-gray-800/30"
          : "border-slate-200 dark:border-gray-700"
      } ${isDimmed ? "opacity-50" : ""}`}
    >
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {onFlyTo ? (
            <button
              type="button"
              onClick={onFlyTo}
              title="Centrar mapa en esta sucursal"
              className="text-sm font-semibold truncate text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline cursor-pointer transition-colors text-left"
            >
              {branch.name}
            </button>
          ) : (
            <span className="text-sm font-semibold truncate text-slate-800 dark:text-slate-100">
              {branch.name}
            </span>
          )}
          {coverageBadge && (
            <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${coverageBadge.className}`}>
              {coverageBadge.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Eye: toggle map visibility only */}
          <button
            type="button"
            onClick={onToggleHide}
            disabled={isClosed}
            title={isHidden ? "Mostrar en mapa" : "Ocultar del mapa (el cálculo Voronoi no cambia)"}
            className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          {/* Power: toggle closed (excluded from Voronoi + map) — auto-recalculates */}
          <button
            type="button"
            onClick={onToggleClose}
            title={isClosed ? "Restaurar en la simulación (recalcula)" : "Simular cierre — excluye del cálculo y recalcula"}
            className={`p-1 rounded-md cursor-pointer transition-colors ${
              isClosed
                ? "text-rose-500 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-700"
                : "text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
            }`}
          >
            {isClosed ? <RotateCcw className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {/* Description */}
      {isClosed ? (
        <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500 italic">
          Excluida del cálculo de Voronoi.
        </p>
      ) : isHidden ? (
        <p className="mt-1 text-[10px] font-medium text-blue-500 dark:text-blue-400">
          Oculta del mapa
        </p>
      ) : branch.coveragePercentage !== undefined ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          {branch.severity
            ? `${branch.name} solo alcanza a cubrir el ${Math.round(branch.coveragePercentage)}% de su territorio asignado (Déficit de ${formatKm2(branch.deficitKm2 ?? 0)}). Se recomienda abrir una sucursal cercana.`
            : `${branch.name} alcanzaría una cobertura adecuada: el área simulada cubre el ${Math.round(branch.coveragePercentage)}% de su territorio asignado.`}
        </p>
      ) : branch.isInactive ? (
        <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500 italic">
          Excluida del cálculo de Voronoi.
        </p>
      ) : null}
    </li>
  );
}

// ── Geometry utilities ────────────────────────────────────────────────────────

/** Ray-casting point-in-polygon for lat/lng coordinates.
 *  polygon is `[lat, lng][]` — the same format as `customBoundary`. */
/** Spherical polygon area in km² using the trapezoidal formula on WGS-84. */
function polygonAreaKm2(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = [toRad(pts[i][0]), toRad(pts[i][1])];
    const [lat2, lng2] = [toRad(pts[(i + 1) % n][0]), toRad(pts[(i + 1) % n][1])];
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return (Math.abs(area) * R * R) / 2;
}

function rayCastPointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Diagnóstico del simulador ─────────────────────────────────────────────────
// Estilo para sucursales con cobertura adecuada (severity === "") — no está en
// GAP_STYLE porque ese mapa solo cubre las severidades de gap.
const ADEQUATE_BADGE = "bg-emerald-100 text-emerald-800";

