import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, ArrowRight, Package, Truck, CheckCircle2, AlertCircle, RotateCcw, Box } from "lucide-react";
import { shipmentApi, type Stats, type Shipment, type ShipmentStatus } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { fmtDateTime } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { TopbarActions } from "../components/topbarContext";
import { Card } from "../components/ui/card";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../components/ui/gradient-card";
import { StatCard } from "../components/ui/stat-card";

const statusConfig: Record<ShipmentStatus, { label: string; tone: "default" | "success" | "warning" | "danger" | "info" }> = {
  draft:                { label: "Borradores",                  tone: "default" },
  at_origin_hub:        { label: "En sucursal de origen",       tone: "warning" },
  loaded:               { label: "Cargado en vehículo",          tone: "info" },
  in_transit:           { label: "En tránsito",                 tone: "info" },
  at_hub:               { label: "En sucursal",                 tone: "info" },
  out_for_delivery:     { label: "Última milla",                tone: "warning" },
  delivery_failed:      { label: "Entrega fallida",             tone: "danger" },
  redelivery_scheduled: { label: "Reentrega programada",        tone: "warning" },
  no_entregado:         { label: "No entregados",               tone: "danger" },
  rechazado:            { label: "Rechazados",                  tone: "danger" },
  delivered:            { label: "Entregados",                  tone: "success" },
  ready_for_pickup:     { label: "Listos para retiro",          tone: "info" },
  ready_for_return:     { label: "Listos para devolución",      tone: "warning" },
  returned:             { label: "Devueltos",                   tone: "default" },
  cancelled:            { label: "Cancelados",                  tone: "danger" },
  lost:                 { label: "Extraviados",                 tone: "danger" },
  destroyed:            { label: "Daño total",                  tone: "danger" },
  expired:              { label: "Borrador expirado",           tone: "default" },
  pending_payment:      { label: "Pago pendiente",              tone: "warning" },
};

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toDateInput(from), to: toDateInput(to) };
}

const inputClass =
  "h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

export function Dashboard() {
  const { user, hasRole } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Shipment[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const range = defaultRange();
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const navigate = useNavigate();

  const isSupervisor = hasRole("supervisor") && !hasRole("manager", "admin");
  const supervisorBranch = isSupervisor ? (user?.branch_id ?? "") : "";
  const effectiveBranch = isSupervisor ? supervisorBranch : selectedBranch;

  useEffect(() => {
    if (!isSupervisor) {
      branchApi.list("activo").then(setBranches);
    }
  }, [isSupervisor]);

  useEffect(() => {
    const params: { date_from: string; date_to: string; branch_id?: string } = {
      date_from: dateFrom,
      date_to: dateTo,
    };
    if (effectiveBranch) params.branch_id = effectiveBranch;
    shipmentApi.stats(params).then(setStats);
  }, [dateFrom, dateTo, effectiveBranch]);

  useEffect(() => {
    const params: { branch_id?: string } = {};
    if (effectiveBranch) params.branch_id = effectiveBranch;
    shipmentApi.list(params).then((all) => {
      const sorted = [...all].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setRecent(sorted.slice(0, 5));
    });
  }, [effectiveBranch]);

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

  const branchLabel = (() => {
    if (isSupervisor) {
      const b = branches.find((br) => br.id === supervisorBranch);
      return b ? b.name : supervisorBranch || "Tu sucursal";
    }
    if (!effectiveBranch) return "Todas las sucursales";
    const b = branches.find((br) => br.id === effectiveBranch);
    return b ? b.name : effectiveBranch;
  })();

  // Highlighted KPIs (gradient cards on top)
  const totalShipments = stats?.total ?? 0;
  const inProgress = (stats?.by_status?.in_transit ?? 0) + (stats?.by_status?.out_for_delivery ?? 0) + (stats?.by_status?.loaded ?? 0);
  const delivered = stats?.by_status?.delivered ?? 0;
  const issues = (stats?.by_status?.delivery_failed ?? 0) + (stats?.by_status?.lost ?? 0) + (stats?.by_status?.destroyed ?? 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <TopbarActions>
        {isSupervisor ? (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 border border-blue-200 text-sm font-semibold text-[#1e3a5f]">
            <MapPin className="w-3.5 h-3.5" />
            {branchLabel}
          </span>
        ) : (
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className={inputClass}
          >
            <option value="">Todas las sucursales</option>
            {sortedProvinces.map((prov) => (
              <optgroup key={prov} label={prov}>
                {branchesByProvince[prov].map((b) => (
                  <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </TopbarActions>

      {/* Highlighted KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <GradientCard tone="brand">
          <div className="flex items-start gap-3">
            <GradientCardIcon><Box className="w-5 h-5" /></GradientCardIcon>
            <div className="flex-1 min-w-0">
              <GradientCardLabel>Total de envíos</GradientCardLabel>
              <GradientCardValue className="mt-1">{totalShipments}</GradientCardValue>
            </div>
          </div>
        </GradientCard>

        <StatCard
          label="En curso"
          value={inProgress}
          hint="Cargado en vehículo + en tránsito + última milla"
          icon={<Truck className="w-4 h-4" />}
          tone="info"
        />
        <StatCard
          label="Entregados"
          value={delivered}
          hint="Completados con éxito"
          icon={<CheckCircle2 className="w-4 h-4" />}
          tone="success"
          onClick={() => navigate("/?status=delivered")}
        />
        <StatCard
          label="Problemas"
          value={issues}
          hint="Fallidos + extraviados + dañados"
          icon={<AlertCircle className="w-4 h-4" />}
          tone="danger"
        />
      </div>

      {/* Status breakdown */}
      <Card className="p-5 mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Distribución por estado</h2>
          <p className="text-xs text-slate-500">Click en una tarjeta para filtrar el listado</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {(Object.keys(statusConfig) as ShipmentStatus[]).map((s) => {
            const cfg = statusConfig[s];
            const value = stats?.by_status?.[s] ?? 0;
            return (
              <StatCard
                key={s}
                label={cfg.label}
                value={value}
                tone={cfg.tone}
                icon={<Package className="w-4 h-4" />}
                onClick={() => navigate(`/?status=${s}`)}
                className="!p-3"
              />
            );
          })}
        </div>
      </Card>

      {/* Chart */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-slate-900">Envíos creados vs entregados por día</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Desde</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hasta</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <DayChart
          byDay={stats?.by_day ?? {}}
          byDayDelivered={stats?.by_day_delivered ?? {}}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      </Card>

      {/* Recent shipments */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-base font-semibold text-slate-900">Envíos recientes</h2>
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#2563eb] hover:text-[#1d4ed8] cursor-pointer"
          >
            Ver todos <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="p-10 text-center">
            <RotateCcw className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Todavía no hay envíos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                  <th className={thClass}>ID de seguimiento</th>
                  <th className={thClass}>Destinatario</th>
                  <th className={thClass}>Destino</th>
                  <th className={thClass}>Estado</th>
                  <th className={thClass}>Creado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr
                    key={s.tracking_id}
                    onClick={() => navigate(`/shipments/${s.tracking_id}`)}
                    className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className={tdClass}><code className="text-xs font-mono text-slate-700">{s.tracking_id}</code></td>
                    <td className={tdClass}>{s.recipient.name}</td>
                    <td className={`${tdClass} text-slate-600`}>{s.recipient.address.city}</td>
                    <td className={tdClass}><StatusBadge status={s.status} label={shipmentStatusLabelOverride(s)} /></td>
                    <td className={`${tdClass} text-slate-500`}>{fmtDateTime(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const thClass = "px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider";
const tdClass = "px-4 py-3 text-slate-700";

// --- DayChart ---

interface DayChartProps {
  byDay: Record<string, number>;
  byDayDelivered: Record<string, number>;
  dateFrom: string;
  dateTo: string;
}

function DayChart({ byDay, byDayDelivered, dateFrom, dateTo }: DayChartProps) {
  const days: { date: string; created: number; delivered: number }[] = [];
  if (dateFrom && dateTo) {
    const cur = new Date(dateFrom + "T00:00:00");
    const end = new Date(dateTo + "T00:00:00");
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      days.push({ date: key, created: byDay[key] ?? 0, delivered: byDayDelivered[key] ?? 0 });
      cur.setDate(cur.getDate() + 1);
    }
  }

  if (days.length === 0) {
    return <p className="text-sm text-slate-500">Seleccioná un rango de fechas para ver el gráfico.</p>;
  }

  const maxCount = Math.max(...days.map((d) => Math.max(d.created, d.delivered)), 1);
  const chartH = 180;
  const slotW = Math.max(10, Math.min(52, Math.floor(700 / days.length)));
  const innerGap = 1;
  const barW = Math.max(2, Math.floor((slotW - innerGap) / 2) - 1);
  const groupGap = Math.max(2, slotW - 2 * barW - innerGap);
  const svgW = days.length * (2 * barW + innerGap + groupGap) + 40;
  const yTicks = [0, Math.round(maxCount / 2), maxCount].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="overflow-x-auto rounded-lg bg-slate-50 border border-slate-200 p-4">
      <div className="flex gap-4 pl-10 mb-2 text-xs text-slate-700">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-[#2563eb]" />
          Creados
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
          Entregados
        </span>
      </div>
      <svg width={svgW} height={chartH + 48} className="block">
        {yTicks.map((tick) => {
          const y = chartH - Math.round((tick / maxCount) * chartH) + 8;
          return (
            <g key={tick}>
              <line x1={34} x2={svgW} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={30} y={y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">{tick}</text>
            </g>
          );
        })}

        {days.map((d, i) => {
          const groupX = 40 + i * (2 * barW + innerGap + groupGap);
          const centerX = groupX + barW + innerGap / 2;
          const showLabel = days.length <= 31 || i % Math.ceil(days.length / 15) === 0;

          const createdH = Math.max(d.created > 0 ? 2 : 0, Math.round((d.created / maxCount) * chartH));
          const deliveredH = Math.max(d.delivered > 0 ? 2 : 0, Math.round((d.delivered / maxCount) * chartH));

          const xCreated = groupX;
          const xDelivered = groupX + barW + innerGap;

          return (
            <g key={d.date}>
              <rect
                x={xCreated}
                y={chartH - createdH + 8}
                width={barW}
                height={createdH}
                rx={2}
                fill="#2563eb"
                opacity={0.9}
              >
                <title>{d.date} — Creados: {d.created}</title>
              </rect>
              {d.created > 0 && createdH > 14 && (
                <text x={xCreated + barW / 2} y={chartH - createdH + 8 + createdH - 4} textAnchor="middle" fontSize={9} fill="white" fontWeight={600}>
                  {d.created}
                </text>
              )}
              {d.created > 0 && createdH <= 14 && (
                <text x={xCreated + barW / 2} y={chartH - createdH + 8 - 3} textAnchor="middle" fontSize={9} fill="#2563eb" fontWeight={600}>
                  {d.created}
                </text>
              )}

              <rect
                x={xDelivered}
                y={chartH - deliveredH + 8}
                width={barW}
                height={deliveredH}
                rx={2}
                fill="#10b981"
                opacity={0.9}
              >
                <title>{d.date} — Entregados: {d.delivered}</title>
              </rect>
              {d.delivered > 0 && deliveredH > 14 && (
                <text x={xDelivered + barW / 2} y={chartH - deliveredH + 8 + deliveredH - 4} textAnchor="middle" fontSize={9} fill="white" fontWeight={600}>
                  {d.delivered}
                </text>
              )}
              {d.delivered > 0 && deliveredH <= 14 && (
                <text x={xDelivered + barW / 2} y={chartH - deliveredH + 8 - 3} textAnchor="middle" fontSize={9} fill="#10b981" fontWeight={600}>
                  {d.delivered}
                </text>
              )}

              {showLabel && (
                <text
                  x={centerX}
                  y={chartH + 22}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#64748b"
                  transform={`rotate(-40, ${centerX}, ${chartH + 22})`}
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 pl-10 mt-1 text-xs text-slate-500">
        <span>Creados en el período: <strong className="text-slate-700">{days.reduce((s, d) => s + d.created, 0)}</strong></span>
        <span>Entregados en el período: <strong className="text-slate-700">{days.reduce((s, d) => s + d.delivered, 0)}</strong></span>
      </div>
    </div>
  );
}
