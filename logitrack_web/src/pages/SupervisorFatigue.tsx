import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  supervisorFatigueApi,
  type CheckinRecord,
  type DriverFatigueStatus,
  type FatigueDashboardResponse,
  type RiskLevel,
} from "../api/supervisorFatigue";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { fmtDateTime, fmtDateTimeSeconds } from "../utils/date";

// ── constantes ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;

function kssRangeBadge(level: number): string {
  if (level <= 4) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (level <= 7) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

// ── semáforo ──────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: RiskLevel }) {
  const map: Record<RiskLevel, { cls: string; dot: string; label: string }> = {
    verde:     { cls: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", label: "Verde" },
    amarillo:  { cls: "bg-amber-100  text-amber-800  border-amber-200",    dot: "bg-amber-400",   label: "Ámbar" },
    rojo:      { cls: "bg-rose-100   text-rose-800   border-rose-200",     dot: "bg-rose-500",    label: "Rojo" },
    pendiente: { cls: "bg-slate-100  text-slate-600  border-slate-200",    dot: "bg-slate-400",   label: "Pendiente" },
    salteado:  { cls: "bg-orange-100 text-orange-800 border-orange-200",   dot: "bg-orange-500",  label: "Salteado" },
  };
  const s = map[level];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold whitespace-nowrap ${s.cls}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ── barra de score ────────────────────────────────────────────────────────────

function ScoreBar({
  score,
  greenMax,
  redMin,
}: {
  score: number;
  greenMax: number;
  redMin: number;
}) {
  const color =
    score <= greenMax ? "#10b981" : score >= redMin ? "#ef4444" : "#f59e0b";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span
        className="text-xs font-bold tabular-nums w-8 text-right shrink-0"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}

// ── fila de historial ─────────────────────────────────────────────────────────

function HistoryRow({ record }: { record: CheckinRecord }) {
  const [yy, mm, dd] = record.date.split("-");
  const dateLabel = `${dd}/${mm}/${yy}`;

  const totalMisfires =
    record.touch_events && record.touch_events.length > 0
      ? record.touch_events.reduce((sum, e) => sum + e.misfires, 0)
      : null;

  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
      {/* Fecha */}
      <td className="py-2 px-3 text-xs text-slate-600 tabular-nums font-medium whitespace-nowrap">
        {dateLabel}
      </td>

      {record.skipped ? (
        <td className="py-2 px-3" colSpan={5}>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-bold bg-orange-50 text-orange-700 border-orange-200">
            <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
            Salteado por el chofer
          </span>
        </td>
      ) : (
        <>
          {/* KSS */}
          <td className="py-2 px-3">
            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${kssRangeBadge(record.kss_level)}`}>
              {record.kss_level}
            </span>
          </td>

          {/* Sueño */}
          <td className="py-2 px-3 text-xs tabular-nums text-center text-slate-600">
            {record.horas_sueno}h
          </td>

          {/* Score Grabación — drift de voz */}
          <td className="py-2 px-3 text-center">
            {record.drift_score != null ? (
              <span className={`text-[11px] font-bold tabular-nums ${
                record.drift_score <= 29 ? "text-emerald-600" :
                record.drift_score < 60  ? "text-amber-600" : "text-rose-600"
              }`}>
                {record.drift_score}
              </span>
            ) : (
              <span className="text-[11px] text-slate-300">—</span>
            )}
          </td>

          {/* PVT — latencia promedio */}
          <td className="py-2 px-3 text-center">
            {record.pvt_metrics ? (
              <span className={`text-[11px] font-bold tabular-nums ${
                record.pvt_metrics.latencia_promedio_ms < 250 ? "text-emerald-600" :
                record.pvt_metrics.latencia_promedio_ms < 350 ? "text-blue-600"   :
                record.pvt_metrics.latencia_promedio_ms < 450 ? "text-amber-600"  : "text-rose-600"
              }`}>
                {record.pvt_metrics.latencia_promedio_ms.toFixed(0)} ms
              </span>
            ) : (
              <span className="text-[11px] text-slate-300">—</span>
            )}
          </td>

          {/* Interacciones táctiles fallidas */}
          <td className="py-2 px-3 text-center">
            {totalMisfires !== null ? (
              <span className={`text-[11px] font-bold tabular-nums ${
                totalMisfires === 0 ? "text-emerald-600" :
                totalMisfires <= 3  ? "text-amber-600"   : "text-rose-600"
              }`}>
                {totalMisfires}
              </span>
            ) : (
              <span className="text-[11px] text-slate-300">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

// ── fila principal de chofer ──────────────────────────────────────────────────

function DriverRow({
  driver,
  greenMax,
  redMin,
  expanded,
  onToggle,
}: {
  driver: DriverFatigueStatus;
  greenMax: number;
  redMin: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const checkinTimeStr = driver.checkin_time
    ? fmtDateTime(driver.checkin_time)
    : null;

  return (
    <>
      {/* Fila principal */}
      <tr
        className="border-t border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {/* Nombre */}
        <td className="py-3 px-4">
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-snug">
              {driver.full_name}
            </p>
            <p className="text-[11px] text-slate-400 font-mono">{driver.username}</p>
          </div>
        </td>

        {/* Nivel de Riesgo Total — badge + barra de score */}
        <td className="py-3 px-4 min-w-[160px]">
          <RiskBadge level={driver.risk_level} />
          {driver.risk_score !== null && (
            <div className="mt-2">
              <ScoreBar score={driver.risk_score} greenMax={greenMax} redMin={redMin} />
            </div>
          )}
        </td>

        {/* Último Check-in */}
        <td className="py-3 px-4">
          {checkinTimeStr ? (
            <span className="text-xs text-slate-500 tabular-nums">{checkinTimeStr}</span>
          ) : (
            <span className="text-xs text-slate-300 italic">Sin check-in</span>
          )}
        </td>

        {/* Toggle historial */}
        <td className="py-3 px-4 text-center">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] font-semibold hover:underline cursor-pointer"
          >
            {(driver.history ?? []).length}
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </td>
      </tr>

      {/* Panel de historial expandible */}
      {expanded && (
        <tr>
          <td colSpan={4} className="bg-slate-50/80 border-t border-slate-100 px-4 py-3">
            {(driver.history ?? []).length === 0 ? (
              <p className="text-xs text-slate-400 italic py-1">
                Sin historial de check-ins registrado.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Fecha</th>
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">KSS</th>
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Sueño</th>
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">Score Grabación</th>
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center">PVT</th>
                      <th className="py-2 px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center whitespace-nowrap">Interac. Táctiles Fallidas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(driver.history ?? []).map((rec) => (
                      <HistoryRow
                        key={rec.date}
                        record={rec}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export function SupervisorFatigue() {
  const { user, hasRole } = useAuth();
  const isSupervisor = hasRole("supervisor") && !hasRole("manager", "admin");

  const [data, setData] = useState<FatigueDashboardResponse | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(user?.branch_id ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);

  // Usamos ref para que el intervalo de polling siempre use el branch actual
  const branchRef = useRef(selectedBranch);
  branchRef.current = selectedBranch;

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const branchId = isSupervisor ? undefined : (branchRef.current || undefined);
      const result = await supervisorFatigueApi.getDashboard(branchId);
      setData(result);
      setLastUpdated(new Date());
      setError("");
    } catch {
      setError("No se pudo cargar el panel de fatiga.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isSupervisor]);

  // Carga inicial + polling cada 60s
  useEffect(() => {
    load();
    const id = setInterval(() => load(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Carga sucursales para el selector (managers)
  useEffect(() => {
    if (!isSupervisor) {
      branchApi.listActive().then(setBranches).catch(() => {});
    }
  }, [isSupervisor]);

  // Refetch cuando el manager cambia de sucursal
  useEffect(() => {
    if (!isSupervisor) load();
  }, [selectedBranch, isSupervisor, load]);

  // ── stats ─────────────────────────────────────────────────────────────────

  const drivers = data?.drivers ?? [];
  const total = drivers.length;
  const skippedCount = drivers.filter((d) => d.risk_level === "salteado").length;
  const fullCheckin = drivers.filter((d) => d.checkin_today && d.risk_level !== "salteado").length;
  const pending = total - fullCheckin - skippedCount;
  const green = drivers.filter((d) => d.risk_level === "verde").length;
  const red = drivers.filter((d) => d.risk_level === "rojo").length;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          title="Fatiga de choferes"
          description="Estado de riesgo en tiempo real para los conductores de la sucursal."
          icon={<Activity className="w-5 h-5" />}
        />

        <div className="flex items-center gap-2 shrink-0">
          {lastUpdated && (
            <span className="text-[11px] text-slate-400 tabular-nums hidden sm:block">
              <Clock className="w-3 h-3 inline mr-1" />
              {fmtDateTimeSeconds(lastUpdated)}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Selector de sucursal (solo manager/admin) */}
      {!isSupervisor && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Sucursal:</label>
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all"
          >
            <option value="">Todas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Cards de resumen */}
      {!loading && data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard icon={<Users className="w-4 h-4" />} label="Choferes" value={total} color="slate" />
          <SummaryCard icon={<CheckCircle2 className="w-4 h-4" />} label="Completado" value={fullCheckin} color="blue" />
          <SummaryCard icon={<ShieldAlert className="w-4 h-4" />} label="Pendientes" value={pending} color="slate" />
          <SummaryCard icon={<span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />} label="Salteado" value={skippedCount} color="amber" />
          <SummaryCard icon={<span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />} label="Verde" value={green} color="green" />
          {/* Rojo — visible siempre para urgencia */}
          {red > 0 && (
            <Card className="col-span-2 sm:col-span-3 lg:col-span-5 border-rose-300 bg-rose-50">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="w-4 h-4 rounded-full bg-rose-500 shrink-0 animate-pulse" />
                <p className="text-sm font-bold text-rose-800">
                  {red} {red === 1 ? "chofer" : "choferes"} en zona ROJA — revisión urgente recomendada
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tabla principal */}
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando datos de fatiga…</p>
        </Card>
      ) : !data || drivers.length === 0 ? (
        <Card className="p-10 text-center">
          <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            No hay choferes activos en esta sucursal.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="text-base">
              Choferes · {data.date.split("-").reverse().join("/")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Chofer</th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider min-w-[180px]">Nivel de Riesgo Total</th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Último Check-in</th>
                    <th className="py-2.5 px-4 text-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">Historial</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <DriverRow
                      key={d.driver_id}
                      driver={d}
                      greenMax={data.green_max}
                      redMin={data.red_min}
                      expanded={expandedDriver === d.driver_id}
                      onToggle={() =>
                        setExpandedDriver((prev) =>
                          prev === d.driver_id ? null : d.driver_id
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-slate-400 text-center">
        Actualización automática cada 60 segundos · Hacé clic en una fila para ver el historial
      </p>
    </div>
  );
}

// ── card de resumen ───────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "slate" | "blue" | "green" | "amber" | "red";
}) {
  const colorMap = {
    slate: "text-slate-500 bg-slate-50",
    blue:  "text-blue-600 bg-blue-50",
    green: "text-emerald-600 bg-emerald-50",
    amber: "text-amber-600 bg-amber-50",
    red:   "text-rose-600 bg-rose-50",
  };
  return (
    <Card className="p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colorMap[color]}`}>
        {icon}
      </div>
      <p className="text-2xl font-extrabold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </Card>
  );
}
