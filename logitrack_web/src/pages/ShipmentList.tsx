import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { shipmentApi, type Shipment, type ShipmentStatus } from "../api/shipments";
import { fmtDate } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { useAuth } from "../context/AuthContext";

type StatusFilter = ShipmentStatus | "active" | "";

export function ShipmentList() {
  const [searchParams] = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get("status") as StatusFilter) ??
    (sessionStorage.getItem("shipment_status_filter") as StatusFilter) ??
    "active"
  );

  useEffect(() => {
    sessionStorage.setItem("shipment_status_filter", statusFilter);
  }, [statusFilter]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  const dateRangeInvalid = !!(dateFrom && dateTo && dateTo < dateFrom);

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const data = q ? await shipmentApi.search(q) : await shipmentApi.list();
      setShipments(data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(query.trim() || undefined);
  };

  // Returns YYYY-MM-DD in local time for a given ISO timestamp
  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const filtered = shipments.filter((s) => {
    if (statusFilter === "active" && (s.status === "delivered" || s.status === "pending" || s.status === "returned" || s.status === "cancelled")) return false;
    if (statusFilter !== "active" && statusFilter !== "" && s.status !== statusFilter) return false;
    if (!dateRangeInvalid) {
      const created = localDate(s.created_at);
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
    }
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Shipments</h1>
        {hasRole("operator", "supervisor", "admin") && (
          <button onClick={() => navigate("/new")}
            style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 600 }}>
            + New Shipment
          </button>
        )}
      </div>

      {/* Search & filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, flex: 1, minWidth: 240 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by tracking ID, sender, recipient or city..."
            style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }} />
          <button type="submit"
            style={{ background: "#4b5563", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>
            Search
          </button>
          {query && (
            <button type="button" onClick={() => { setQuery(""); load(); }}
              style={{ background: "#e5e7eb", border: "none", borderRadius: 6, padding: "8px 12px", cursor: "pointer" }}>
              Clear
            </button>
          )}
        </form>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#374151" }}>
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={selectStyle} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#374151" }}>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{ ...selectStyle, borderColor: dateRangeInvalid ? "#ef4444" : "#d1d5db" }} />
        </label>
        {dateRangeInvalid && (
          <span style={{ fontSize: 13, color: "#ef4444", alignSelf: "center" }}>
            "To" date must be after "From"
          </span>
        )}
        {(dateFrom || dateTo) && (
          <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }}
            style={{ background: "#e5e7eb", border: "none", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 14 }}>
            Clear dates
          </button>
        )}

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={selectStyle}>
          <option value="active">Active</option>
          <option value="">All</option>
          <option value="at_branch">At Branch</option>
          <option value="cancelled">Cancelled</option>
          <option value="delivered">Delivered</option>
          <option value="delivery_failed">Delivery Failed</option>
          <option value="delivering">Delivering</option>
          <option value="pending">Draft</option>
          <option value="in_progress">In Progress</option>
          <option value="in_transit">In Transit</option>
          <option value="ready_for_pickup">Ready for Pickup</option>
          <option value="ready_for_return">Ready for Return</option>
          <option value="returned">Returned</option>
        </select>

      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No shipments found.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{filtered.length} shipment{filtered.length !== 1 ? "s" : ""}</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                <th style={th}>Tracking ID</th>
                <th style={th}>Sender</th>
                <th style={th}>Recipient</th>
                <th style={th}>Origin → Destination</th>
                <th style={th}>Weight</th>
                <th style={th}>Priority</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
                <th style={th}>Est. Delivery</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.tracking_id} onClick={() => navigate(`/shipments/${s.tracking_id}`)}
                  style={{ borderBottom: "1px solid #e5e7eb", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td style={td}><code>{s.status === "pending" ? <span style={{ color: "#9ca3af" }}>—</span> : s.tracking_id}</code></td>
                  <td style={td}>{s.sender.name}</td>
                  <td style={td}>{s.recipient.name}</td>
                  <td style={td}>{s.sender.address.city} → {s.recipient.address.city}</td>
                  <td style={td}>{s.weight_kg} kg</td>
                  <td style={td}><PriorityBadge priority={s.priority} /></td>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  <td style={td}>{fmtDate(s.created_at)}</td>
                  <td style={td}>{fmtDate(s.estimated_delivery_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const td: React.CSSProperties = { padding: "10px 14px" };
const selectStyle: React.CSSProperties = { padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" };
