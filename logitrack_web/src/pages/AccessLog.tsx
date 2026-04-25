import { useEffect, useState } from "react";
import { accessLogApi, type AccessLog, type AccessEventType } from "../api/accessLog";
import { fmtDateTime } from "../utils/date";

const EVENT_LABELS: Record<AccessEventType, string> = {
  login_success: "Login",
  login_failure: "Failed login",
  logout: "Logout",
};

const EVENT_COLORS: Record<AccessEventType, { bg: string; color: string }> = {
  login_success: { bg: "#dcfce7", color: "#166534" },
  login_failure: { bg: "#fee2e2", color: "#991b1b" },
  logout: { bg: "#f1f5f9", color: "#475569" },
};

export function AccessLog() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<AccessEventType | "">("");

  useEffect(() => {
    accessLogApi.list(500)
      .then(setLogs)
      .catch(() => setError("Failed to load access logs."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter((l) => {
    if (eventFilter && l.event_type !== eventFilter) return false;
    if (search && !l.username.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1e293b" }}>Access Log</h2>
      <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14 }}>
        Read-only audit log of all login and logout events.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Filter by username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, width: 220 }}
        />
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value as AccessEventType | "")}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14 }}
        >
          <option value="">All events</option>
          <option value="login_success">Login</option>
          <option value="login_failure">Failed login</option>
          <option value="logout">Logout</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#94a3b8", alignSelf: "center" }}>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Loading…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {!loading && !error && (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={th}>Timestamp</th>
                <th style={th}>Username</th>
                <th style={th}>Event</th>
                <th style={th}>User ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8" }}>
                    No records found.
                  </td>
                </tr>
              )}
              {filtered.map((log) => {
                const badge = EVENT_COLORS[log.event_type];
                return (
                  <tr key={log.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={td}>{fmtDateTime(log.timestamp)}</td>
                    <td style={{ ...td, fontWeight: 600, color: "#1e293b" }}>{log.username}</td>
                    <td style={td}>
                      <span style={{
                        background: badge.bg,
                        color: badge.color,
                        padding: "2px 10px",
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        {EVENT_LABELS[log.event_type]}
                      </span>
                    </td>
                    <td style={{ ...td, color: "#94a3b8", fontFamily: "monospace", fontSize: 12 }}>
                      {log.user_id || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 12,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const td: React.CSSProperties = {
  padding: "10px 16px",
  color: "#334155",
};
