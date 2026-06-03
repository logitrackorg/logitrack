import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { slaMetricsApi, type SLAMetrics } from "../../api/slaMetrics";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../utils/dashboard";

// ── Palette ──────────────────────────────────────────────────────────────────
const COLOR_OK   = "#22c55e";  // green-500
const COLOR_WARN = "#f59e0b";  // amber-500
const COLOR_BAD  = "#ef4444";  // red-500
const COLOR_LINE = "#2563eb";  // blue-600

function healthColor(rate: number): string {
  if (rate >= 90) return COLOR_OK;
  if (rate >= 75) return COLOR_WARN;
  return COLOR_BAD;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function BarTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-[var(--text-primary)] mb-1">{label}</p>
      <p className="text-rose-600 font-bold">{payload[0].value} envío{payload[0].value !== 1 ? "s" : ""} demorado{payload[0].value !== 1 ? "s" : ""}</p>
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

// ── Main component ────────────────────────────────────────────────────────────
export default function SlaTab() {
  const [metrics, setMetrics] = useState<SLAMetrics | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    setError(false);
    slaMetricsApi
      .get()
      .then((data) => { setMetrics(data); setLoading(false); setRefreshing(false); })
      .catch(() => { setError(true); setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Skeleton className="h-96" />;

  if (error || !metrics) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500">
        <AlertCircle className="w-8 h-8 text-rose-400" />
        <p className="text-sm">No se pudieron cargar las métricas SLA.</p>
        <button
          onClick={() => load(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reintentar
        </button>
      </div>
    );
  }

  const rate  = metrics.sla_health_rate;
  const hue   = healthColor(rate);
  const ShieldIcon = rate >= 90 ? ShieldCheck : ShieldAlert;

  // Format date labels for the X axis of the trend chart.
  const trendData = metrics.delay_trend.map((d) => {
    const [, mm, dd] = d.date.split("-");
    return { ...d, label: `${dd}/${mm}` };
  });

  return (
    <div className="space-y-6">
      {/* ── Refresh button ──────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* ── Row 1: KPI card ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Health rate — big number */}
        <Card className="sm:col-span-1">
          <CardContent className="pt-6 pb-6 flex flex-col items-center text-center gap-3">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: `${hue}22` }}
            >
              <ShieldIcon className="w-7 h-7" style={{ color: hue }} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Tasa de Cumplimiento SLA
              </p>
              <p className="text-5xl font-black tabular-nums" style={{ color: hue }}>
                {rate.toFixed(1)}
                <span className="text-2xl font-bold">%</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                {metrics.delayed_total} demorado{metrics.delayed_total !== 1 ? "s" : ""} de {metrics.active_total} activos
              </p>
            </div>
            <div
              className="w-full h-2 rounded-full mt-1"
              style={{ background: `${hue}33` }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${rate}%`, background: hue }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Secondary KPI chips */}
        <Card className="sm:col-span-2">
          <CardContent className="p-5 grid grid-cols-2 gap-4 h-full">
            <KpiChip
              label="Envíos demorados totales"
              value={metrics.delayed_total}
              color={metrics.delayed_total === 0 ? COLOR_OK : COLOR_BAD}
              icon={<AlertCircle className="w-4 h-4" />}
            />
            <KpiChip
              label="Estado con mayor cantidad de demorados"
              value={metrics.bottlenecks[0]?.status ?? "—"}
              color={COLOR_WARN}
              icon={<ShieldAlert className="w-4 h-4" />}
              small
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Row 2: Bar chart + Line chart ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bottleneck bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">
              Cantidad de demoras por Estado
            </CardTitle>
            <p className="text-[11px] text-slate-400">Cuello de botellapor estado actual</p>
          </CardHeader>
          <CardContent>
            {metrics.bottlenecks.length === 0 ? (
              <EmptyState text="Sin cuellos de botella detectados" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={metrics.bottlenecks} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="status"
                    width={140}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 18) + "…" : v}
                  />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {metrics.bottlenecks.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={idx === 0 ? COLOR_BAD : idx === 1 ? COLOR_WARN : "#94a3b8"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Delay trend line chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">
              Tendencia de Demoras (últimos 7 días)
            </CardTitle>
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
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={COLOR_LINE}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: COLOR_LINE, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function KpiChip({
  label, value, color, icon, small = false,
}: {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
  /** small=true renders text values (e.g. status names) at a smaller size */
  small?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 p-5 rounded-xl border border-slate-100 bg-slate-50/60 h-full">
      {/* Label row */}
      <div className="flex items-center gap-2" style={{ color }}>
        {icon}
        <p className="text-xs font-bold uppercase tracking-wider leading-snug">{label}</p>
      </div>
      {/* Value */}
      <p
        className={`font-black leading-none text-slate-800 ${
          small ? "text-xl break-words" : "text-5xl tabular-nums"
        }`}
      >
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
