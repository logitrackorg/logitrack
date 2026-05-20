import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bell, CheckCheck, X, Building2, Warehouse, RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { notificationApi, type Notification } from "../api/notifications";

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
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
  if (type === "fatigue_alert")       return <AlertTriangle size={16} color="#ef4444" />;
  return <Bell size={16} color="#94a3b8" />;
}

function groupLabel(type: string, count: number): string {
  if (type === "destination_arrival") return `Llegaron ${count} envíos a su sucursal destino final`;
  if (type === "shipment_received")   return `Llegaron ${count} envíos a una sucursal intermedia`;
  if (type === "return_arrival")      return `${count} envíos en devolución llegaron a sucursal de origen`;
  return `${count} notificaciones`;
}

function groupAccent(type: string): string {
  if (type === "destination_arrival") return "#34d399";
  if (type === "shipment_received")   return "#60a5fa";
  if (type === "return_arrival")      return "#fb923c";
  if (type === "fatigue_alert")       return "#ef4444";
  return "#94a3b8";
}

function GroupIcon({ type }: { type: string }) {
  const color = groupAccent(type);
  if (type === "destination_arrival") return <Building2     size={16} color={color} />;
  if (type === "shipment_received")   return <Warehouse     size={16} color={color} />;
  if (type === "return_arrival")      return <RotateCcw     size={16} color={color} />;
  if (type === "fatigue_alert")       return <AlertTriangle size={16} color={color} />;
  return <Bell size={16} color="#94a3b8" />;
}

// ─── Grouping ────────────────────────────────────────────────────────────────
// Consecutive notifications of the same groupable type within a 5-minute window
// collapse into an expandable card.
// fatigue_alert is intentionally excluded — each alert is individual and urgent.

const GROUP_WINDOW_MS  = 5 * 60 * 1000;
const GROUPABLE_TYPES  = new Set(["destination_arrival", "shipment_received", "return_arrival"]);

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
  // Primera alerta de fatiga sin leer — dispara el banner crítico.
  const [criticalAlert, setCriticalAlert]   = useState<Notification | null>(null);
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
      const notifs = data.notifications ?? [];
      setNotifications(notifs);
      // Detectar la primera alerta de fatiga sin leer para mostrar el banner crítico.
      const firstCritical = notifs.find((n) => n.type === "fatigue_alert" && !n.read_at);
      setCriticalAlert(firstCritical ?? null);
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
      es.addEventListener("notification", () => {
        fetchCount();
        fetchNotifications(); // actualiza el banner crítico en tiempo real
      });
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
      if (n.type === "fatigue_alert") setCriticalAlert(null);
    }
    if (n.type === "fatigue_alert") {
      navigate("/supervisor/fatigue");
    } else if (n.resource_id) {
      navigate(`/shipments/${n.resource_id}`);
    }
    setOpen(false);
  };

  const dismissCriticalAlert = async () => {
    if (!criticalAlert) return;
    await notificationApi.markRead(criticalAlert.id);
    setUnreadCount((c) => Math.max(0, c - 1));
    setNotifications((prev) =>
      prev.map((item) =>
        item.id === criticalAlert.id ? { ...item, read_at: new Date().toISOString() } : item
      )
    );
    setCriticalAlert(null);
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
    const isFatigue = n.type === "fatigue_alert";
    
    // groupAccent devuelve el color correcto para cada tipo: azul, verde, naranja o rojo.
    // Se usa tanto para el dot como para el fondo tintado (hex 12 ≈ 7 % opacidad).
    const accent   = groupAccent(n.type);
    const unreadBg = `${accent}12`;

    return (
      <div
        key={n.id}
        onClick={() => handleItemClick(n)}
        style={{ 
          ...rowBase, 
          cursor: "pointer", 
          background: n.read_at ? "transparent" : unreadBg, 
          borderLeft: isFatigue && !n.read_at ? "3px solid #ef4444" : "3px solid transparent" 
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = n.read_at ? "transparent" : unreadBg)}
      >
        <div style={{ marginTop: 2, flexShrink: 0 }}><NotifIcon type={n.type} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: isFatigue ? "#fca5a5" : "#e2e8f0", fontSize: 13, fontWeight: n.read_at ? 400 : 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {n.title}
            </span>
            <span style={{ color: "#64748b", fontSize: 11, flexShrink: 0 }}>{relativeTime(n.created_at)}</span>
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {n.body}
          </div>
          
          {/* Botón exclusivo para las alertas de Ojo de Patrón */}
          {isFatigue && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate("/supervisor/fatigue"); setOpen(false); }}
              style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "#f87171", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, padding: "2px 8px", cursor: "pointer" }}
            >
              Ver historial del chofer →
            </button>
          )}
        </div>
        
        {/* El puntito de no leído usando tu variable accent unificada */}
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
    const unreadBg  = type === "destination_arrival" ? "rgba(52,211,153,0.07)" : "rgba(96,165,250,0.07)";
    const subBg     = type === "destination_arrival" ? "rgba(52,211,153,0.05)" : "rgba(96,165,250,0.05)";

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
        {expanded && items.map((n) => (
          <div
            key={n.id}
            onClick={() => handleItemClick(n)}
            style={{ ...rowBase, cursor: "pointer", paddingLeft: 36, background: n.read_at ? "rgba(0,0,0,0.15)" : subBg, borderBottom: "1px solid #152338" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = n.read_at ? "rgba(0,0,0,0.15)" : subBg)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ color: "#cbd5e1", fontSize: 12, fontWeight: n.read_at ? 400 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                {n.body}
              </span>
            </div>
            {!n.read_at && <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, flexShrink: 0, marginTop: 4 }} />}
          </div>
        ))}
      </div>
    );
  };

  const displayItems = buildDisplayItems(notifications);

  // ── JSX ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Banner crítico de fatiga — fijo en la parte superior de la pantalla ── */}
      {criticalAlert && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "linear-gradient(90deg, #7f1d1d, #991b1b)",
          borderBottom: "2px solid #ef4444",
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 16px",
          boxShadow: "0 4px 20px rgba(239,68,68,0.4)",
          animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
        }}>
          <AlertTriangle size={20} color="#fca5a5" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: "#fca5a5", fontWeight: 700, fontSize: 13 }}>
              {criticalAlert.title}
            </span>
            <span style={{ color: "#fecaca", fontSize: 12, marginLeft: 10 }}>
              {criticalAlert.body}
            </span>
          </div>
          <button
            onClick={() => { navigate("/supervisor/fatigue"); dismissCriticalAlert(); }}
            style={{ flexShrink: 0, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Ver historial del chofer
          </button>
          <button
            onClick={dismissCriticalAlert}
            title="Descartar"
            style={{ flexShrink: 0, background: "none", border: "none", color: "#fca5a5", cursor: "pointer", display: "flex", padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>
      )}

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
    </>
  );
}
