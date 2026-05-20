import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bell, CheckCheck, X, Building2, Warehouse, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, AlertOctagon } from "lucide-react";
import { notificationApi, fetchServerClockOffsetMs, type Notification } from "../api/notifications";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function NotifIcon({ type }: { type: string }) {
  if (type === "shipment_received")   return <Warehouse     size={16} color="#60a5fa" />;
  if (type === "destination_arrival") return <Building2     size={16} color="#34d399" />;
  if (type === "return_arrival")      return <RotateCcw     size={16} color="#fb923c" />;
  if (type === "sla_risk")            return <AlertTriangle size={16} color="#ef4444" />;
  if (type === "sla_expired")         return <AlertOctagon  size={16} color="#b91c1c" />;
  return <Bell size={16} color="#94a3b8" />;
}

function groupLabel(type: string, count: number): string {
  if (type === "destination_arrival") return `Llegaron ${count} envíos a su sucursal destino final`;
  if (type === "shipment_received")   return `Llegaron ${count} envíos a una sucursal intermedia`;
  if (type === "return_arrival")      return `${count} envíos en devolución llegaron a sucursal de origen`;
  if (type === "sla_risk")            return `${count} envíos en riesgo de SLA`;
  if (type === "sla_expired")         return `${count} envíos con SLA vencido`;
  return `${count} notificaciones`;
}

function groupAccent(type: string): string {
  if (type === "destination_arrival") return "#34d399";
  if (type === "shipment_received")   return "#60a5fa";
  if (type === "return_arrival")      return "#fb923c";
  if (type === "sla_risk")            return "#ef4444";
  if (type === "sla_expired")         return "#b91c1c";
  return "#94a3b8";
}

// ─── SLA countdown helpers ────────────────────────────────────────────────────

/** Extrae el ETA ISO del body de una notificación sla_risk (formato "... · eta:RFC3339"). */
function parseSLAEta(body: string): Date | null {
  const match = body.match(/eta:([^\s·]+)$/);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

/** Devuelve el texto del body sin el sufijo eta:... */
function bodyWithoutEta(body: string): string {
  return body.replace(/\s*·\s*eta:[^\s·]+$/, "");
}

/** Countdown en tiempo real a partir del ETA, usando el reloj del servidor. */
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

function GroupIcon({ type }: { type: string }) {
  const color = groupAccent(type);
  if (type === "destination_arrival") return <Building2     size={16} color={color} />;
  if (type === "shipment_received")   return <Warehouse     size={16} color={color} />;
  if (type === "return_arrival")      return <RotateCcw     size={16} color={color} />;
  if (type === "sla_risk")            return <AlertTriangle size={16} color={color} />;
  if (type === "sla_expired")         return <AlertOctagon  size={16} color={color} />;
  return <Bell size={16} color="#94a3b8" />;
}

// ─── Grouping ────────────────────────────────────────────────────────────────
// Consecutive notifications of the same groupable type within a 5-minute window
// collapse into an expandable card.

const GROUP_WINDOW_MS  = 5 * 60 * 1000;
const GROUPABLE_TYPES  = new Set(["destination_arrival", "shipment_received", "return_arrival", "sla_risk", "sla_expired"]);

type SingleItem  = { kind: "single"; n: Notification };
type GroupItem   = { kind: "group";  items: Notification[]; key: string };
type DisplayItem = SingleItem | GroupItem;

function buildDisplayItems(notifications: Notification[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let i = 0;
  while (i < notifications.length) {
    const n = notifications[i];
    if (!GROUPABLE_TYPES.has(n.type)) {
      result.push({ kind: "single", n });
      i++;
      continue;
    }
    // Collect same-type consecutive items within the window
    const anchor = new Date(n.created_at).getTime();
    const group: Notification[] = [n];
    let j = i + 1;
    while (
      j < notifications.length &&
      notifications[j].type === n.type &&
      Math.abs(new Date(notifications[j].created_at).getTime() - anchor) <= GROUP_WINDOW_MS
    ) {
      group.push(notifications[j]);
      j++;
    }
    if (group.length === 1) {
      result.push({ kind: "single", n });
    } else {
      result.push({ kind: "group", items: group, key: n.id });
    }
    i = j;
  }
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen]                     = useState(false);
  const [unreadCount, setUnreadCount]       = useState(0);
  const [notifications, setNotifications]   = useState<Notification[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [clockOffsetMs, setClockOffsetMs]   = useState(0); // offset reloj servidor vs browser
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const fetchCount = useCallback(async () => {
    try {
      const data = await notificationApi.unreadCount();
      setUnreadCount(data.count);
    } catch { /* silently ignore */ }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await notificationApi.list({ limit: 20, offset: 0 });
      setNotifications(data.notifications ?? []);
    } catch { /* silently ignore */ }
  }, []);

  // SSE — real-time push; falls back to 60 s polling if connection drops.
  useEffect(() => {
    fetchCount();
    const token = localStorage.getItem("token");
    const base  = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
    const url   = `${base}/notifications/stream?token=${encodeURIComponent(token ?? "")}`;

    let es: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const startSSE = () => {
      es = new EventSource(url);
      es.addEventListener("notification", () => fetchCount());
      es.onerror = () => {
        es?.close(); es = null;
        if (!pollInterval) pollInterval = setInterval(fetchCount, 60_000);
      };
    };

    if (typeof EventSource !== "undefined" && token) startSSE();
    else pollInterval = setInterval(fetchCount, 60_000);

    return () => { es?.close(); if (pollInterval) clearInterval(pollInterval); };
  }, [fetchCount]);

  // Refetch on SPA navigation and tab/window focus.
  useEffect(() => { fetchCount(); }, [location.pathname, fetchCount]);
  useEffect(() => {
    const onVis   = () => { if (!document.hidden) fetchCount(); };
    const onFocus = () => fetchCount();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchCount]);

  // Ticker: re-render every 30 s while panel is open para actualizar el countdown de SLA.
  // También refresca el offset del reloj del servidor para que el countdown sea correcto
  // cuando el admin activó un override de reloj.
  useEffect(() => {
    if (!open) return;
    const refresh = () =>
      fetchServerClockOffsetMs().then(setClockOffsetMs); // setState → re-render automático
    refresh(); // carga inmediata al abrir el panel
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [open]);

  // Close panel on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (!open) { fetchNotifications(); fetchCount(); }
    setOpen((v) => !v);
  };

  const handleMarkAllRead = async () => {
    await notificationApi.markAllRead();
    setUnreadCount(0);
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    );
  };

  const handleItemClick = async (n: Notification) => {
    if (!n.read_at) {
      await notificationApi.markRead(n.id);
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
    }
    if (n.resource_id) navigate(`/shipments/${n.resource_id}`);
    setOpen(false);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const rowBase: React.CSSProperties = {
    padding: "12px 16px",
    borderBottom: "1px solid #1a2e4a",
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    transition: "background 0.15s",
  };

  const renderSingle = (n: Notification) => {
    const isSLARisk    = n.type === "sla_risk";
    const isSLAExpired = n.type === "sla_expired";
    const eta          = isSLARisk ? parseSLAEta(n.body) : null;
    const displayBody  = isSLARisk ? bodyWithoutEta(n.body) : n.body;
    const accent       = groupAccent(n.type);

    return (
      <div
        key={n.id}
        onClick={() => handleItemClick(n)}
        style={{ ...rowBase, cursor: "pointer", background: n.read_at ? "transparent" : `${accent}12` }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = n.read_at ? "transparent" : `${accent}12`)}
      >
        <div style={{ marginTop: 2, flexShrink: 0 }}><NotifIcon type={n.type} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: n.read_at ? 400 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {n.title}
            </span>
            <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>{relativeTime(n.created_at, clockOffsetMs)}</span>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {displayBody}
          </div>
          {/* Countdown live para sla_risk — solo mientras el SLA sigue vigente */}
          {isSLARisk && eta && (() => {
            const label = slaCountdown(eta, clockOffsetMs);
            if (label === "venció") return null; // sla_expired ya cubre este estado
            return (
              <div style={{ fontSize: 11, marginTop: 3, fontWeight: 600, color: accent }}>
                {label}
              </div>
            );
          })()}
          {/* Label fijo para sla_expired */}
          {isSLAExpired && (
            <div style={{ fontSize: 11, marginTop: 3, fontWeight: 700, color: accent }}>
              SLA vencido
            </div>
          )}
        </div>
        {!n.read_at && <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, flexShrink: 0, marginTop: 6 }} />}
      </div>
    );
  };

  const renderGroup = (items: Notification[], key: string) => {
    const type      = items[0].type;
    const expanded  = expandedGroups.has(key);
    const hasUnread = items.some((n) => !n.read_at);
    const accent    = groupAccent(type);
    const Chevron   = expanded ? ChevronUp : ChevronDown;
    const isSLA     = type === "sla_risk" || type === "sla_expired";
    const unreadBg  = type === "destination_arrival" ? "rgba(52,211,153,0.07)"
                    : type === "return_arrival"       ? "rgba(251,146,60,0.07)"
                    : isSLA                           ? `${accent}12`
                    : "rgba(96,165,250,0.07)";
    const subBg     = type === "destination_arrival" ? "rgba(52,211,153,0.05)"
                    : type === "return_arrival"       ? "rgba(251,146,60,0.05)"
                    : isSLA                           ? `${accent}0d`
                    : "rgba(96,165,250,0.05)";

    return (
      <div key={key}>
        {/* Group header — click toggles expand, does NOT navigate or mark read */}
        <div
          onClick={() => toggleGroup(key)}
          style={{ ...rowBase, cursor: "pointer", background: hasUnread ? unreadBg : "transparent" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = hasUnread ? unreadBg : "transparent")}
        >
          <div style={{ marginTop: 2, flexShrink: 0 }}><GroupIcon type={type} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: hasUnread ? 600 : 400 }}>
                {groupLabel(type, items.length)}
              </span>
              <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>{relativeTime(items[0].created_at)}</span>
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
              {expanded ? "Tocá cada envío para ver el detalle" : `${items.length} envíos · expandir`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {hasUnread && <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, marginTop: 2 }} />}
            <Chevron size={14} color="#64748b" />
          </div>
        </div>

        {/* Expanded sub-items */}
        {expanded && items.map((n) => {
          const isSLARisk    = n.type === "sla_risk";
          const isSLAExpired = n.type === "sla_expired";
          const eta          = isSLARisk ? parseSLAEta(n.body) : null;
          const displayBody  = isSLARisk ? bodyWithoutEta(n.body) : n.body;
          return (
            <div
              key={n.id}
              onClick={() => handleItemClick(n)}
              style={{ ...rowBase, cursor: "pointer", paddingLeft: 36, background: n.read_at ? "rgba(0,0,0,0.15)" : subBg, borderBottom: "1px solid #152338" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = n.read_at ? "rgba(0,0,0,0.15)" : subBg)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: n.read_at ? 400 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                  {displayBody}
                </span>
                {isSLARisk && eta && (() => {
                  const label = slaCountdown(eta, clockOffsetMs);
                  if (label === "venció") return null;
                  return <span style={{ fontSize: 11, fontWeight: 600, color: accent }}>{label}</span>;
                })()}
                {isSLAExpired && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>SLA vencido</span>
                )}
              </div>
              {!n.read_at && <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, flexShrink: 0, marginTop: 4 }} />}
            </div>
          );
        })}
      </div>
    );
  };

  const displayItems = buildDisplayItems(notifications);

  // ── JSX ─────────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        title="Notificaciones"
        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, display: "flex", alignItems: "center", position: "relative", color: "#cbd5e1" }}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: 0, right: 0, background: "#ef4444", color: "#fff", borderRadius: "50%", fontSize: 10, fontWeight: 700, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 380, background: "#0f2744", border: "1px solid #1e3a5f", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 50, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #1e3a5f" }}>
            <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14 }}>Notificaciones</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} title="Marcar todas como leídas" style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <CheckCheck size={14} /> Marcar todas
                </button>
              )}
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex" }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {displayItems.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#64748b", fontSize: 13 }}>Sin notificaciones</div>
            ) : (
              displayItems.map((item) =>
                item.kind === "single"
                  ? renderSingle(item.n)
                  : renderGroup(item.items, item.key)
              )
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: "10px 16px", borderTop: "1px solid #1e3a5f", textAlign: "center" }}>
            <button onClick={() => { navigate("/notifications"); setOpen(false); }} style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              Ver todas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
