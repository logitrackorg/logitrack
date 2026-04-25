import { useEffect, useState } from "react";
import { accessLogApi, type AccessLog, type AccessEventType } from "../api/accessLog";
import { fmtDateTime } from "../utils/date";

const EVENT_LABELS: Record<AccessEventType, string> = {
  login_success: "Inicio de sesión",
  login_failure: "Inicio de sesión fallido",
  logout: "Cierre de sesión",
};

const EVENT_COLORS: Record<AccessEventType, { bg: string; color: string }> = {
  login_success: { bg: "#dcfce7", color: "#166534" },
  login_failure: { bg: "#fee2e2", color: "#991b1b" },
  logout: { bg: "#f1f5f9", color: "#475569" },
};

const ROWS_PER_GROUP = 10;

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";

  return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function getDayKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

interface DayGroup {
  key: string;
  logs: AccessLog[];
}

export function AccessLog() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<AccessEventType | "">("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    accessLogApi.list(500)
      .then(setLogs)
      .catch(() => setError("No se pudo cargar el registro de accesos."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter((l) => {
    if (eventFilter && l.event_type !== eventFilter) return false;
    if (search && !l.username.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const groups: DayGroup[] = filtered.reduce<DayGroup[]>((acc, log) => {
    const key = getDayKey(log.timestamp);
    const existing = acc.find((g) => g.key === key);
    if (existing) {
      existing.logs.push(log);
    } else {
      acc.push({ key, logs: [log] });
    }
    return acc;
  }, []);

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleExpand = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1e293b" }}>Registro de accesos</h2>
      <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14 }}>
        Registro de auditoría de solo lectura de todos los eventos de inicio y cierre de sesión.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Filtrar por usuario…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, width: 220 }}
        />
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value as AccessEventType | "")}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14 }}
        >
          <option value="">Todos los eventos</option>
          <option value="login_success">Inicio de sesión</option>
          <option value="login_failure">Inicio de sesión fallido</option>
          <option value="logout">Cierre de sesión</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#94a3b8", alignSelf: "center" }}>
          {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
          {groups.length > 0 && ` · ${groups.length} día${groups.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {loading && <p style={{ color: "#64748b" }}>Cargando…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {!loading && !error && groups.length === 0 && (
        <p style={{ color: "#94a3b8", textAlign: "center", marginTop: 48 }}>No se encontraron registros.</p>
      )}

      {!loading && !error && groups.map((group) => {
        const isCollapsed = collapsed[group.key] ?? false;
        const isExpanded = expanded[group.key] ?? false;
        const visibleLogs = isExpanded ? group.logs : group.logs.slice(0, ROWS_PER_GROUP);
        const hasMore = group.logs.length > ROWS_PER_GROUP;

        return (
          <div key={group.key} style={{ marginBottom: 16 }}>
            {/* Day header */}
            <button
              onClick={() => toggleCollapse(group.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "6px 0",
                marginBottom: 6,
                textAlign: "left",
              }}
            >
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#475569",
                textTransform: "capitalize",
                letterSpacing: "0.01em",
              }}>
                {formatDayLabel(group.key)}
              </span>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                background: "#e2e8f0",
                color: "#64748b",
                borderRadius: 20,
                padding: "1px 8px",
              }}>
                {group.logs.length}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 16, color: "#94a3b8", lineHeight: 1 }}>
                {isCollapsed ? "▶" : "▼"}
              </span>
            </button>

            {!isCollapsed && (
              <>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={th}>Hora</th>
                        <th style={th}>Usuario</th>
                        <th style={th}>Evento</th>
                        <th style={th}>ID de usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLogs.map((log) => {
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

                {hasMore && (
                  <button
                    onClick={() => toggleExpand(group.key)}
                    style={{
                      marginTop: 6,
                      fontSize: 13,
                      color: "#3b82f6",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "2px 4px",
                    }}
                  >
                    {isExpanded
                      ? "Mostrar menos"
                      : `Mostrar ${group.logs.length - ROWS_PER_GROUP} registro${group.logs.length - ROWS_PER_GROUP !== 1 ? "s" : ""} más`}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
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
