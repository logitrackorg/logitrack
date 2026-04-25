import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shipmentApi, type Stats, type Shipment, type ShipmentStatus } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { fmtDateTime } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";

const statusConfig: Record<ShipmentStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: "Borrador",        color: "#374151", bg: "#f3f4f6" },
  in_progress: { label: "En proceso",      color: "#92400e", bg: "#fef3c7" },
  pre_transit: { label: "Pre tránsito",    color: "#0e7490", bg: "#cffafe" },
  in_transit:  { label: "En tránsito",     color: "#1e40af", bg: "#dbeafe" },
  at_branch:   { label: "En sucursal",     color: "#5b21b6", bg: "#ede9fe" },
  delivering:       { label: "En reparto",         color: "#9a3412", bg: "#ffedd5" },
  delivery_failed:  { label: "Entrega fallida",    color: "#991b1b", bg: "#fee2e2" },
  delivered:        { label: "Entregado",           color: "#065f46", bg: "#d1fae5" },
  ready_for_pickup: { label: "Listo para retiro",  color: "#0e7490", bg: "#cffafe" },
  ready_for_return: { label: "Listo para devolución", color: "#5b21b6", bg: "#ede9fe" },
  returned:         { label: "Devuelto",            color: "#374151", bg: "#f3f4f6" },
  cancelled:        { label: "Cancelado",           color: "#b91c1c", bg: "#fee2e2" },
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

  // For supervisors the branch is always their own; for managers it's selectable.
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

  // Group branches by province for the dropdown.
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

  // Label shown next to "Dashboard" heading.
  const branchLabel = (() => {
    if (isSupervisor) {
      const b = branches.find((br) => br.id === supervisorBranch);
      return b ? b.name : supervisorBranch || "Tu sucursal";
    }
    if (!effectiveBranch) return "Todas las sucursales";
    const b = branches.find((br) => br.id === effectiveBranch);
    return b ? b.name : effectiveBranch;
  })();

  return (
    <div style={{ padding: 24 }}>
      {/* Header with branch filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>

        {isSupervisor ? (
          // Supervisor: locked badge showing their branch
          <span style={{
            background: "#dbeafe", color: "#1e40af", borderRadius: 8,
            padding: "4px 12px", fontSize: 13, fontWeight: 600,
          }}>
            {branchLabel}
          </span>
        ) : (
          // Manager / admin: branch selector
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            style={{
              border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px",
              fontSize: 13, background: "#fff", color: "#374151", cursor: "pointer",
            }}
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
      </div>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 32 }}>
        <StatCard label="Total de envíos" value={stats?.total ?? 0} color="#1e3a5f" bg="#e0eaff" />
        {(Object.keys(statusConfig) as ShipmentStatus[]).map((s) => (
          <StatCard
            key={s}
            label={statusConfig[s].label}
            value={stats?.by_status?.[s] ?? 0}
            color={statusConfig[s].color}
            bg={statusConfig[s].bg}
            onClick={() => navigate(`/?status=${s}`)}
          />
        ))}
      </div>

      {/* Shipments created vs delivered per day chart */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>Envíos creados vs entregados por día</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <label htmlFor="date-from" style={{ color: "#6b7280" }}>Desde</label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}
            />
            <label htmlFor="date-to" style={{ color: "#6b7280" }}>Hasta</label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ border: "1px solid #d1d5db", borderRadius: 6, padding: "4px 8px", fontSize: 13 }}
            />
          </div>
        </div>
        <DayChart
          byDay={stats?.by_day ?? {}}
          byDayDelivered={stats?.by_day_delivered ?? {}}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      </div>

      {/* Recent shipments */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Envíos recientes</h2>
        <button
          onClick={() => navigate("/")}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 }}
        >
          Ver todos →
        </button>
      </div>

      {recent.length === 0 ? (
        <p style={{ color: "#6b7280" }}>Todavía no hay envíos.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 500 }}>
          <thead>
            <tr style={{ background: "#f9fafb", textAlign: "left" }}>
              <th style={th}>ID de seguimiento</th>
              <th style={th}>Destinatario</th>
              <th style={th}>Destino</th>
              <th style={th}>Estado</th>
              <th style={th}>Fecha de creación</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((s) => (
              <tr
                key={s.tracking_id}
                onClick={() => navigate(`/shipments/${s.tracking_id}`)}
                style={{ borderBottom: "1px solid #e5e7eb", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <td style={td}><code>{s.tracking_id}</code></td>
                <td style={td}>{s.recipient.name}</td>
                <td style={td}>{s.recipient.address.city}</td>
                <td style={td}><StatusBadge status={s.status} /></td>
                <td style={td}>{fmtDateTime(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

// --- DayChart ---

interface DayChartProps {
  byDay: Record<string, number>;
  byDayDelivered: Record<string, number>;
  dateFrom: string;
  dateTo: string;
}

function DayChart({ byDay, byDayDelivered, dateFrom, dateTo }: DayChartProps) {
  // Build ordered list of days in the range.
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
    return <p style={{ color: "#6b7280", fontSize: 14 }}>Seleccioná un rango de fechas para ver el gráfico.</p>;
  }

  const maxCount = Math.max(...days.map((d) => Math.max(d.created, d.delivered)), 1);
  const chartH = 160;
  // Each day group has 2 bars + inner gap; calculate slot width for the whole day
  const slotW = Math.max(10, Math.min(52, Math.floor(700 / days.length)));
  const innerGap = 1;
  const barW = Math.max(2, Math.floor((slotW - innerGap) / 2) - 1);
  const groupGap = Math.max(2, slotW - 2 * barW - innerGap);
  const svgW = days.length * (2 * barW + innerGap + groupGap) + 40;

  // Y-axis ticks (0, max/2, max)
  const yTicks = [0, Math.round(maxCount / 2), maxCount].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div style={{ overflowX: "auto", background: "#f9fafb", borderRadius: 10, padding: "16px 8px 8px 8px", border: "1px solid #e5e7eb" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, paddingLeft: 40, marginBottom: 8, fontSize: 11, color: "#374151" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: "#3b82f6" }} />
          Creados
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: "#10b981" }} />
          Entregados
        </span>
      </div>
      <svg width={svgW} height={chartH + 48} style={{ display: "block" }}>
        {/* Y-axis ticks and gridlines */}
        {yTicks.map((tick) => {
          const y = chartH - Math.round((tick / maxCount) * chartH) + 8;
          return (
            <g key={tick}>
              <line x1={34} x2={svgW} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={30} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{tick}</text>
            </g>
          );
        })}

        {/* Bar groups */}
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
              {/* Created bar (blue) */}
              <rect
                x={xCreated}
                y={chartH - createdH + 8}
                width={barW}
                height={createdH}
                rx={2}
                fill="#3b82f6"
                opacity={0.85}
              >
                <title>{d.date} — Creados: {d.created}</title>
              </rect>
              {d.created > 0 && createdH > 14 && (
                <text x={xCreated + barW / 2} y={chartH - createdH + 8 + createdH - 4} textAnchor="middle" fontSize={9} fill="white" fontWeight={600}>
                  {d.created}
                </text>
              )}
              {d.created > 0 && createdH <= 14 && (
                <text x={xCreated + barW / 2} y={chartH - createdH + 8 - 3} textAnchor="middle" fontSize={9} fill="#3b82f6" fontWeight={600}>
                  {d.created}
                </text>
              )}

              {/* Delivered bar (green) */}
              <rect
                x={xDelivered}
                y={chartH - deliveredH + 8}
                width={barW}
                height={deliveredH}
                rx={2}
                fill="#10b981"
                opacity={0.85}
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
                  fill="#6b7280"
                  transform={`rotate(-40, ${centerX}, ${chartH + 22})`}
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, paddingLeft: 40, display: "flex", gap: 16 }}>
        <span>Creados en el período: <strong style={{ color: "#374151" }}>{days.reduce((s, d) => s + d.created, 0)}</strong></span>
        <span>Entregados en el período: <strong style={{ color: "#374151" }}>{days.reduce((s, d) => s + d.delivered, 0)}</strong></span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  bg,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: bg,
        borderRadius: 10,
        padding: "16px 20px",
        width: "100%",
        border: "none",
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color, opacity: 0.8, marginTop: 4 }}>{label}</div>
    </button>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const td: React.CSSProperties = { padding: "10px 14px" };
