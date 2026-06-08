import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bell, CheckCheck, X, Building2, Warehouse, RotateCcw, PackageCheck, ChevronDown, ChevronUp, AlertTriangle, AlertOctagon, Bot, Truck, MapPin, UserCheck } from "lucide-react";
import { notificationApi, fetchServerClockOffsetMs, type Notification } from "../api/notifications";
import { Button } from "@/components/ui/button";

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
  if (type === "shipment_received")        return <Warehouse     size={16} color="#60a5fa" />;
  if (type === "destination_arrival")      return <Building2     size={16} color="#34d399" />;
  if (type === "return_arrival")           return <RotateCcw     size={16} color="#fb923c" />;
  if (type === "return_started")           return <RotateCcw     size={16} color="#f97316" />;
  if (type === "return_completed")         return <PackageCheck  size={16} color="#f59e0b" />;
  if (type === "sla_risk")                 return <AlertTriangle size={16} color="#ef4444" />;
  if (type === "sla_expired")              return <AlertOctagon  size={16} color="#b91c1c" />;
  if (type === "fatigue_alert")            return <AlertTriangle size={16} color="#ef4444" />;
  if (type === "chatbot_pickup_requested")       return <Bot size={16} color="#a78bfa" />;
  if (type === "chatbot_rejected_by_recipient")  return <Bot size={16} color="#f97316" />;
  if (type === "chatbot_cancelled_by_sender")    return <Bot size={16} color="#ef4444" />;
  if (type === "chatbot_delivery_rescheduled")   return <Bot size={16} color="#38bdf8" />;
  if (type === "min_fill_reached")         return <Truck         size={16} color="#7c3aed" />;
  if (type === "route_assigned")           return <MapPin     size={16} color="#0ea5e9" />;
  if (type === "route_reassigned")         return <MapPin     size={16} color="#f59e0b" />;
  if (type === "trip_driver_assigned")     return <UserCheck  size={16} color="#10b981" />;
  return <Bell size={16} color="#94a3b8" />;
}

function groupLabel(type: string, count: number): string {
  if (type === "destination_arrival") return `Llegaron ${count} envíos a su sucursal destino final`;
  if (type === "shipment_received")   return `Llegaron ${count} envíos a una sucursal intermedia`;
  if (type === "return_arrival")      return `${count} envíos en devolución llegaron a sucursal de origen`;
  if (type === "return_started")      return `${count} envíos listos para devolución`;
  if (type === "return_completed")    return `${count} envíos devueltos — coordinar entrega con remitente`;
  if (type === "sla_risk")            return `${count} envíos en riesgo de SLA`;
  if (type === "sla_expired")         return `${count} envíos con SLA vencido`;
  if (type === "route_assigned")        return `${count} rutas asignadas`;
  if (type === "route_reassigned")      return `${count} rutas reasignadas`;
  if (type === "trip_driver_assigned")          return `${count} choferes asignados a viajes`;
  if (type === "chatbot_rejected_by_recipient")  return `${count} envíos rechazados por el destinatario`;
  if (type === "chatbot_cancelled_by_sender")    return `${count} envíos cancelados por el remitente`;
  if (type === "chatbot_delivery_rescheduled")   return `${count} entregas reprogramadas por el destinatario`;
  return `${count} notificaciones`;
}

function groupAccent(type: string): string {
  if (type === "destination_arrival") return "#34d399";
  if (type === "shipment_received")   return "#60a5fa";
  if (type === "return_arrival")      return "#fb923c";
  if (type === "return_started")      return "#f97316";
  if (type === "return_completed")    return "#f59e0b";
  if (type === "sla_risk")            return "#ef4444";
  if (type === "sla_expired")         return "#b91c1c";
  if (type === "fatigue_alert")       return "#ef4444";
  if (type === "min_fill_reached")    return "#7c3aed";
  if (type === "route_assigned")        return "#0ea5e9";
  if (type === "route_reassigned")      return "#f59e0b";
  if (type === "trip_driver_assigned")          return "#10b981";
  if (type === "chatbot_rejected_by_recipient")  return "#f97316";
  if (type === "chatbot_cancelled_by_sender")    return "#ef4444";
  if (type === "chatbot_delivery_rescheduled")   return "#38bdf8";
  return "#94a3b8";
}

// ─── Tailwind accent color helper ──────────────────────────────────────────
// Maps notification types to Tailwind text-color classes so dynamic
// accent backgrounds can resolve via `currentColor` (bg-current, etc.).

function typeTextColor(type: string): string {
  switch (type) {
    case "destination_arrival": return "text-emerald-400";
    case "shipment_received": return "text-blue-400";
    case "return_arrival": return "text-orange-400";
    case "return_started": return "text-orange-500";
    case "return_completed": return "text-amber-500";
    case "sla_risk": return "text-red-500";
    case "sla_expired": return "text-red-700";
    case "fatigue_alert": return "text-red-500";
    case "min_fill_reached": return "text-violet-500";
    case "route_assigned": return "text-sky-500";
    case "route_reassigned": return "text-amber-500";
    case "trip_driver_assigned": return "text-emerald-500";
    case "chatbot_pickup_requested": return "text-violet-400";
    case "chatbot_rejected_by_recipient": return "text-orange-500";
    case "chatbot_cancelled_by_sender": return "text-red-500";
    case "chatbot_delivery_rescheduled": return "text-cyan-400";
    default: return "text-slate-400";
  }
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
  if (type === "return_started")      return <RotateCcw     size={16} color={color} />;
  if (type === "return_completed")    return <PackageCheck  size={16} color={color} />;
  if (type === "sla_risk")            return <AlertTriangle size={16} color={color} />;
  if (type === "sla_expired")         return <AlertOctagon  size={16} color={color} />;
  if (type === "fatigue_alert")       return <AlertTriangle size={16} color={color} />;
  if (type === "route_assigned")        return <MapPin size={16} color={color} />;
  if (type === "route_reassigned")      return <MapPin size={16} color={color} />;
  if (type === "trip_driver_assigned")          return <UserCheck size={16} color={color} />;
  if (type === "chatbot_rejected_by_recipient")  return <Bot size={16} color={color} />;
  if (type === "chatbot_cancelled_by_sender")    return <Bot size={16} color={color} />;
  if (type === "chatbot_delivery_rescheduled")   return <Bot size={16} color={color} />;
  return <Bell size={16} color="#94a3b8" />;
}

// ─── Grouping ────────────────────────────────────────────────────────────────
// Consecutive notifications of the same groupable type within a 5-minute window
// collapse into an expandable card.
// fatigue_alert is intentionally excluded — each alert is individual and urgent.

const GROUP_WINDOW_MS  = 5 * 60 * 1000;
const GROUPABLE_TYPES  = new Set(["destination_arrival", "shipment_received", "return_arrival", "return_started", "sla_risk", "sla_expired"]);

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
  }, [fetchCount, fetchNotifications]);

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

  // Carga el offset del reloj del servidor al montar (antes de que el usuario
  // abra el panel) y lo refresca cada 30 s. Así el tiempo relativo ya es
  // correcto desde el primer render del panel, sin esperar la promesa.
  useEffect(() => {
    const refresh = () => fetchServerClockOffsetMs().then(setClockOffsetMs);
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

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
    } else if (n.type === "min_fill_reached" && n.resource_id) {
      navigate(`/${n.resource_id}`);
    } else if (n.type === "route_assigned" || n.type === "route_reassigned") {
      navigate("/driver/route");
    } else if (n.type === "trip_driver_assigned") {
      navigate("/viajes");
    } else if (n.type === "chatbot_rejected_by_recipient" || n.type === "chatbot_cancelled_by_sender") {
      if (n.resource_id) navigate(`/shipments/${n.resource_id}`);
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

  const renderSingle = (n: Notification) => {
    const isSLARisk           = n.type === "sla_risk";
    const isSLAExpired        = n.type === "sla_expired";
    const isFatigue           = n.type === "fatigue_alert";
    const isReturnCompleted   = n.type === "return_completed";
    const isReturnArrival     = n.type === "return_arrival";
    const isRescheduled       = n.type === "chatbot_delivery_rescheduled";
    const rescheduledDate     = isRescheduled ? (n.body.match(/para el (\d{2}\/\d{2}\/\d{4})/)?.[1] ?? null) : null;
    const eta               = isSLARisk ? parseSLAEta(n.body) : null;
    const displayBody       = isSLARisk ? bodyWithoutEta(n.body) : n.body;
    const accentClass       = typeTextColor(n.type);
    const unreadBgClass     = !n.read_at
      ? (isReturnCompleted ? "bg-current/[.12]" : "bg-current/[.07]")
      : "";
    const accentBorder      = (isFatigue || isReturnCompleted) && !n.read_at;

    return (
      <div
        key={n.id}
        onClick={() => handleItemClick(n)}
        className={`px-4 py-3 border-b border-[#1a2e4a] flex gap-2.5 items-start transition-colors cursor-pointer border-l-[3px] ${accentClass} ${unreadBgClass} ${
          accentBorder ? "border-l-current" : "border-l-transparent"
        } hover:bg-white/[0.04]`}
      >
        <div className="mt-0.5 shrink-0"><NotifIcon type={n.type} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline gap-2">
            <span className={`truncate text-[13px] ${!n.read_at ? "font-semibold" : "font-normal"} ${
              (isFatigue || isReturnCompleted) ? "text-amber-300" : "text-[#e2e8f0]"
            }`}>
              {n.title}
            </span>
            <span className="text-[11px] text-[#64748b] shrink-0">{relativeTime(n.created_at, clockOffsetMs)}</span>
          </div>
          <div className="text-xs text-[#94a3b8] mt-0.5 truncate">
            {displayBody}
          </div>
          {/* Countdown live para sla_risk — solo mientras el SLA sigue vigente */}
          {isSLARisk && eta && (() => {
            const label = slaCountdown(eta, clockOffsetMs);
            if (label === "venció") return null; // sla_expired ya cubre este estado
            return (
              <div className="text-[11px] mt-[3px] font-semibold text-current">
                {label}
              </div>
            );
          })()}
          {/* Label fijo para sla_expired */}
          {isSLAExpired && (
            <div className="text-[11px] mt-[3px] font-bold text-current">
              SLA vencido
            </div>
          )}
          {/* Botón de acción para return_completed y return_arrival — CA-05: requiere acción */}
          {(isReturnCompleted || isReturnArrival) && (
            <div className="text-[11px] mt-[3px] font-bold text-amber-500">
              Acción requerida: coordinar entrega con remitente
            </div>
          )}
          {/* Chip de nueva fecha para reprogramaciones del chatbot */}
          {isRescheduled && rescheduledDate && (
            <div className="inline-flex items-center gap-1 mt-1 text-[11px] font-bold text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 rounded-[5px] px-1.5 py-0.5">
              📅 Nueva fecha: {rescheduledDate}
            </div>
          )}
          {/* Botón exclusivo para las alertas de fatiga */}
          {isFatigue && (
            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => { e.stopPropagation(); navigate("/supervisor/fatigue"); setOpen(false); }}
              className="mt-1.5 text-[11px] text-red-400 bg-red-500/15 border-red-500/30 rounded-[5px] px-2 py-0.5"
            >
              Ver historial del chofer →
            </Button>
          )}
        </div>
        {!n.read_at && <div className="w-[7px] h-[7px] rounded-full shrink-0 mt-1.5 bg-current" />}
      </div>
    );
  };

  const renderGroup = (items: Notification[], key: string) => {
    const type      = items[0].type;
    const expanded  = expandedGroups.has(key);
    const hasUnread = items.some((n) => !n.read_at);
    const accentClass = typeTextColor(type);
    const Chevron   = expanded ? ChevronUp : ChevronDown;
    const unreadBgClass = hasUnread
      ? (type === "return_completed" ? "bg-current/[.12]" : "bg-current/[.07]")
      : "";

    return (
      <div key={key}>
        {/* Group header — click toggles expand, does NOT navigate or mark read */}
        <div
          onClick={() => toggleGroup(key)}
          className={`px-4 py-3 border-b border-[#1a2e4a] flex gap-2.5 items-start cursor-pointer transition-colors ${accentClass} ${unreadBgClass} hover:bg-white/[0.04]`}
        >
          <div className="mt-0.5 shrink-0"><GroupIcon type={type} /></div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-baseline gap-2">
              <span className={`text-[13px] text-[#e2e8f0] ${hasUnread ? "font-semibold" : "font-normal"}`}>
                {groupLabel(type, items.length)}
              </span>
              <span className="text-[11px] text-[#64748b] shrink-0">{relativeTime(items[0].created_at, clockOffsetMs)}</span>
            </div>
            <div className="text-xs text-[#94a3b8] mt-0.5">
              {expanded ? "Tocá cada envío para ver el detalle" : `${items.length} envíos · expandir`}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1 shrink-0">
            {hasUnread && <div className="w-[7px] h-[7px] rounded-full bg-current mt-0.5" />}
            <Chevron size={14} color="#64748b" />
          </div>
        </div>

        {/* Expanded sub-items */}
        {expanded && items.map((n) => {
          const isSLARisk    = n.type === "sla_risk";
          const isSLAExpired = n.type === "sla_expired";
          const eta          = isSLARisk ? parseSLAEta(n.body) : null;
          const displayBody  = isSLARisk ? bodyWithoutEta(n.body) : n.body;
          // subBg: return_completed uses 8%, others use 5%
          const subBgClass   = n.read_at
            ? "bg-black/[0.15]"
            : (type === "return_completed" ? "bg-current/[.08]" : "bg-current/[.05]");
          return (
            <div
              key={n.id}
              onClick={() => handleItemClick(n)}
              className={`px-4 py-3 cursor-pointer pl-9 border-b border-[#152338] transition-colors ${accentClass} ${subBgClass} hover:bg-white/[0.04]`}
            >
              <div className="flex-1 min-w-0">
                <span className={`text-xs block truncate ${!n.read_at ? "font-semibold" : "font-normal"} text-[#cbd5e1]`}>
                  {displayBody}
                </span>
                {isSLARisk && eta && (() => {
                  const label = slaCountdown(eta, clockOffsetMs);
                  if (label === "venció") return null;
                  return <span className="text-[11px] font-semibold text-current">{label}</span>;
                })()}
                {isSLAExpired && (
                  <span className="text-[11px] font-bold text-current">SLA vencido</span>
                )}
              </div>
              {!n.read_at && <div className="w-[6px] h-[6px] rounded-full shrink-0 mt-1 bg-current" />}
            </div>
          );
        })}
      </div>
    );
  };

  const displayItems = buildDisplayItems(notifications);

  // ── JSX ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Banner crítico de fatiga — fijo en la parte superior de la pantalla ── */}
      {criticalAlert && (
        <div className="fixed top-0 inset-x-0 z-[9999] bg-gradient-to-r from-red-900 to-red-800 border-b-2 border-red-500 flex items-center gap-3 px-4 py-2.5 shadow-[0_4px_20px_rgba(239,68,68,0.4)] animate-pulse">
          <AlertTriangle size={20} color="#fca5a5" className="shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-red-300 font-bold text-[13px]">
              {criticalAlert.title}
            </span>
            <span className="text-red-200 text-xs ml-2.5">
              {criticalAlert.body}
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => { navigate("/supervisor/fatigue"); dismissCriticalAlert(); }}
            className="shrink-0 bg-white/15 border-white/30 text-white px-3 py-1 text-xs font-bold whitespace-nowrap rounded-md"
          >
            Ver historial del chofer
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={dismissCriticalAlert}
            aria-label="Descartar alerta"
            title="Descartar"
            className="text-red-300"
          >
            <X size={16} />
          </Button>
        </div>
      )}

    <div ref={panelRef} className="relative inline-flex items-center">
      {/* Bell button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleToggle}
        title="Notificaciones"
        className="relative text-slate-300"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white rounded-full text-[10px] font-bold min-w-[16px] h-[16px] flex items-center justify-center px-[3px]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 w-[380px] bg-[#0f2744] border border-[var(--sidebar-bg)] rounded-[10px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--sidebar-bg)]">
            <span className="text-[#e2e8f0] font-bold text-sm">Notificaciones</span>
            <div className="flex gap-2 items-center">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={handleMarkAllRead} title="Marcar todas como leídas" className="text-blue-400">
                  <CheckCheck size={14} /> Marcar todas
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cerrar panel" className="text-slate-400">
                <X size={16} />
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {displayItems.length === 0 ? (
              <div className="py-6 px-4 text-center text-[13px] text-[#64748b]">Sin notificaciones</div>
            ) : (
              displayItems.map((item) =>
                item.kind === "single"
                  ? renderSingle(item.n)
                  : renderGroup(item.items, item.key)
              )
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-[var(--sidebar-bg)] text-center">
            <Button variant="ghost" onClick={() => { navigate("/notifications"); setOpen(false); }} className="text-blue-400 text-[13px] font-medium">
              Ver todas
            </Button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
