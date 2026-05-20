import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Package, CheckCheck, Building2, RotateCcw, AlertTriangle, AlertOctagon } from "lucide-react";
import { notificationApi, fetchServerClockOffsetMs, type Notification } from "../api/notifications";

const PAGE_SIZE = 20;

function relativeTime(dateStr: string, clockOffsetMs = 0): string {
  const diff = (Date.now() + clockOffsetMs) - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function typeAccent(type: string): string {
  if (type === "destination_arrival") return "#34d399";
  if (type === "return_arrival")      return "#fb923c";
  if (type === "sla_risk")            return "#ef4444";
  if (type === "sla_expired")         return "#b91c1c";
  return "#3b82f6";
}

function NotifIcon({ type }: { type: string }) {
  if (type === "shipment_received")   return <Package      size={18} color="#60a5fa" />;
  if (type === "destination_arrival") return <Building2    size={18} color="#34d399" />;
  if (type === "return_arrival")      return <RotateCcw    size={18} color="#fb923c" />;
  if (type === "sla_risk")            return <AlertTriangle size={18} color="#ef4444" />;
  if (type === "sla_expired")         return <AlertOctagon size={18} color="#b91c1c" />;
  return <Bell size={18} color="#94a3b8" />;
}

function parseSLAEta(body: string): Date | null {
  const match = body.match(/eta:([^\s·]+)$/);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

function bodyWithoutEta(body: string): string {
  return body.replace(/\s*·\s*eta:[^\s·]+$/, "");
}

function slaCountdown(eta: Date, clockOffsetMs = 0): string {
  const serverNow = Date.now() + clockOffsetMs;
  const diff = eta.getTime() - serverNow;
  if (diff <= 0) return "venció";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `vence en ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vence en ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `vence en ${days} d`;
}

export function NotificationsPage() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0); // offset reloj servidor vs browser

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Applied filters (only applied on search button or enter)
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedDateFrom, setAppliedDateFrom] = useState("");
  const [appliedDateTo, setAppliedDateTo] = useState("");

  const fetchPage = useCallback(
    async (currentOffset: number, sSearch: string, sDateFrom: string, sDateTo: string) => {
      setLoading(true);
      try {
        const params: Parameters<typeof notificationApi.list>[0] = {
          limit: PAGE_SIZE,
          offset: currentOffset,
        };
        if (sSearch) params.search = sSearch;
        if (sDateFrom) params.date_from = new Date(sDateFrom).toISOString();
        if (sDateTo) {
          // Include entire end day
          const end = new Date(sDateTo);
          end.setHours(23, 59, 59, 999);
          params.date_to = end.toISOString();
        }
        const data = await notificationApi.list(params);
        setNotifications(data.notifications ?? []);
        setTotal(data.total);
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchPage(offset, appliedSearch, appliedDateFrom, appliedDateTo);
  }, [fetchPage, offset, appliedSearch, appliedDateFrom, appliedDateTo]);

  // Carga el offset del reloj del servidor al montar y cada 30 s para que el
  // countdown refleje el reloj admin aunque el browser muestre otra hora.
  useEffect(() => {
    const refresh = () => fetchServerClockOffsetMs().then(setClockOffsetMs);
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  const handleSearch = () => {
    setAppliedSearch(search);
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
    setOffset(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleMarkAllRead = async () => {
    await notificationApi.markAllRead();
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    );
  };

  const handleItemClick = async (n: Notification) => {
    if (!n.read_at) {
      await notificationApi.markRead(n.id);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
    }
    if (n.resource_id) {
      navigate(`/shipments/${n.resource_id}`);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 16px" }}>
      {/* Page title */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e3a5f" }}>
          Notificaciones
        </h1>
        <button
          onClick={handleMarkAllRead}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "#1e3a5f",
            color: "#e2e8f0",
            border: "none",
            borderRadius: 7,
            padding: "7px 14px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <CheckCheck size={15} />
          Marcar todas como leídas
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 20,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: "1 1 200px", minWidth: 160 }}>
          <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
            Buscar
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Título o contenido..."
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: "0 1 160px" }}>
          <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
            Desde
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: "0 1 160px" }}>
          <label style={{ display: "block", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
            Hasta
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>
        <button
          onClick={handleSearch}
          style={{
            padding: "7px 18px",
            background: "#1e3a5f",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            alignSelf: "flex-end",
          }}
        >
          Buscar
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>Cargando...</div>
      ) : notifications.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            color: "#94a3b8",
            padding: 48,
            background: "#f8fafc",
            borderRadius: 10,
            border: "1px dashed #cbd5e1",
          }}
        >
          <Bell size={36} color="#cbd5e1" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14 }}>No hay notificaciones</div>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          {notifications.map((n, idx) => (
            <div
              key={n.id}
              onClick={() => handleItemClick(n)}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                padding: "14px 20px",
                borderBottom: idx < notifications.length - 1 ? "1px solid #f1f5f9" : "none",
                background: n.read_at ? "#fff" : (n.type === "sla_risk" || n.type === "sla_expired") ? "#fef2f2" : "#eff6ff",
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = n.read_at ? "#fff" : (n.type === "sla_risk" || n.type === "sla_expired") ? "#fef2f2" : "#eff6ff")
              }
            >
              <div style={{ marginTop: 3, flexShrink: 0 }}>
                <NotifIcon type={n.type} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: n.read_at ? 400 : 600,
                      color: "#1e293b",
                    }}
                  >
                    {n.title}
                  </span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
                    <span style={{ color: "#94a3b8", fontSize: 11 }}>
                      {relativeTime(n.created_at, clockOffsetMs)}
                    </span>
                    <span style={{ color: "#cbd5e1", fontSize: 11 }}>
                      {formatDate(n.created_at)}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "#475569", marginTop: 3 }}>
                  {n.type === "sla_risk" ? bodyWithoutEta(n.body) : n.body}
                </div>
                {/* Countdown live para sla_risk — solo mientras el SLA sigue vigente */}
                {n.type === "sla_risk" && (() => {
                  const eta = parseSLAEta(n.body);
                  if (!eta) return null;
                  const label = slaCountdown(eta, clockOffsetMs);
                  if (label === "venció") return null; // sla_expired ya cubre este estado
                  return (
                    <div style={{ fontSize: 12, marginTop: 3, fontWeight: 600, color: typeAccent(n.type) }}>
                      {label}
                    </div>
                  );
                })()}
                {/* Label para sla_expired */}
                {n.type === "sla_expired" && (
                  <div style={{ fontSize: 12, marginTop: 3, fontWeight: 700, color: typeAccent(n.type) }}>
                    SLA vencido
                  </div>
                )}
                {n.resource_id && (
                  <div style={{ fontSize: 11, color: "#60a5fa", marginTop: 4 }}>
                    #{n.resource_id}
                  </div>
                )}
              </div>
              {!n.read_at && (
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: typeAccent(n.type),
                    flexShrink: 0,
                    marginTop: 7,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 20,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 13, color: "#64748b" }}>
            {total} resultado{total !== 1 ? "s" : ""} · Página {currentPage} de {totalPages}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: offset === 0 ? "#f8fafc" : "#fff",
                color: offset === 0 ? "#94a3b8" : "#1e3a5f",
                cursor: offset === 0 ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              ← Anterior
            </button>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: offset + PAGE_SIZE >= total ? "#f8fafc" : "#fff",
                color: offset + PAGE_SIZE >= total ? "#94a3b8" : "#1e3a5f",
                cursor: offset + PAGE_SIZE >= total ? "not-allowed" : "pointer",
                fontSize: 13,
              }}
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
