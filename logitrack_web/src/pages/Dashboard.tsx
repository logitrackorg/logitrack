import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shipmentApi, type Stats, type Shipment, type ShipmentStatus } from "../api/shipments";
import { fmtDateTime } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";

const statusConfig: Record<ShipmentStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: "Draft",       color: "#374151", bg: "#f3f4f6" },
  in_progress: { label: "In Progress", color: "#92400e", bg: "#fef3c7" },
  in_transit:  { label: "In Transit", color: "#1e40af", bg: "#dbeafe" },
  at_branch:   { label: "At Branch",  color: "#5b21b6", bg: "#ede9fe" },
  delivering:       { label: "Delivering",     color: "#9a3412", bg: "#ffedd5" },
  delivery_failed:  { label: "Delivery Failed",   color: "#991b1b", bg: "#fee2e2" },
  delivered:        { label: "Delivered",          color: "#065f46", bg: "#d1fae5" },
  ready_for_pickup: { label: "Ready for pickup",      color: "#0e7490", bg: "#cffafe" },
  ready_for_return: { label: "Ready for return",      color: "#5b21b6", bg: "#ede9fe" },
  returned:         { label: "Returned",               color: "#374151", bg: "#f3f4f6" },
  cancelled:        { label: "Cancelled",               color: "#b91c1c", bg: "#fee2e2" },
};

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Shipment[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    shipmentApi.stats().then(setStats);
    shipmentApi.list().then((all) => {
      const sorted = [...all].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setRecent(sorted.slice(0, 5));
    });
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Dashboard</h1>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 32 }}>
        <StatCard label="Total Shipments" value={stats?.total ?? 0} color="#1e3a5f" bg="#e0eaff" />
        {(Object.keys(statusConfig) as ShipmentStatus[]).map((s) => (
          <StatCard
            key={s}
            label={statusConfig[s].label}
            value={stats?.by_status?.[s] ?? 0}
            color={statusConfig[s].color}
            bg={statusConfig[s].bg}
          />
        ))}
      </div>

      {/* Recent shipments */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Recent Shipments</h2>
        <button
          onClick={() => navigate("/")}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 }}
        >
          View all →
        </button>
      </div>

      {recent.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No shipments yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#f9fafb", textAlign: "left" }}>
              <th style={th}>Tracking ID</th>
              <th style={th}>Recipient</th>
              <th style={th}>Destination</th>
              <th style={th}>Status</th>
              <th style={th}>Created At</th>
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
      )}
    </div>
  );
}

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ background: bg, borderRadius: 10, padding: "16px 20px" }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color, opacity: 0.8, marginTop: 4 }}>{label}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const td: React.CSSProperties = { padding: "10px 14px" };
