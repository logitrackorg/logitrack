import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Package, CheckCheck, Building2, RotateCcw, PackageCheck, AlertTriangle, AlertOctagon, Truck, MapPin, UserCheck, Bot } from "lucide-react";
import { notificationApi, fetchServerClockOffsetMs, type Notification } from "../api/notifications";

const PAGE_SIZE = 20;

const NOTIF_ACCENT: Record<string, string> = {
  destination_arrival: "emerald-400",
  return_arrival: "orange-400",
  return_started: "orange-500",
  return_completed: "amber-500",
  sla_risk: "red-500",
  sla_expired: "red-700",
  min_fill_reached: "violet-600",
  route_assigned: "sky-500",
  route_reassigned: "amber-500",
  trip_driver_assigned: "emerald-500",
  chatbot_rejected_by_recipient: "orange-500",
  chatbot_cancelled_by_sender: "red-500",
};

function accentClass(type: string, prefix: "text" | "bg"): string {
  return `${prefix}-${NOTIF_ACCENT[type] ?? "blue-500"}`;
}

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

function NotifIcon({ type }: { type: string }) {
  const cls = accentClass(type, "text");
  if (type === "shipment_received")             return <Package      size={18} className="text-blue-400" />;
  if (type === "destination_arrival")           return <Building2    size={18} className={cls} />;
  if (type === "return_arrival")                return <RotateCcw    size={18} className={cls} />;
  if (type === "return_started")                return <RotateCcw    size={18} className={cls} />;
  if (type === "return_completed")              return <PackageCheck size={18} className={cls} />;
  if (type === "sla_risk")                      return <AlertTriangle size={18} className={cls} />;
  if (type === "sla_expired")                   return <AlertOctagon size={18} className={cls} />;
  if (type === "min_fill_reached")              return <Truck        size={18} className={cls} />;
  if (type === "route_assigned")                return <MapPin       size={18} className={cls} />;
  if (type === "route_reassigned")              return <MapPin       size={18} className={cls} />;
  if (type === "trip_driver_assigned")          return <UserCheck    size={18} className={cls} />;
  if (type === "chatbot_rejected_by_recipient") return <Bot          size={18} className={cls} />;
  if (type === "chatbot_cancelled_by_sender")   return <Bot          size={18} className={cls} />;
  return <Bell size={18} className="dark:text-gray-500 text-slate-400" />;
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

function notifRowBg(n: Notification): string {
  if (n.read_at) return "dark:bg-gray-800 bg-white";
  if (n.type === "sla_risk" || n.type === "sla_expired") return "bg-red-50";
  if (n.type === "return_completed" || n.type === "return_arrival") return "bg-amber-50";
  if (n.type === "min_fill_reached") return "bg-violet-50";
  return "bg-blue-50";
}

function notifRowBorder(n: Notification): string {
  if (n.read_at) return "border-l-transparent";
  if (n.type === "return_completed" || n.type === "return_arrival") return "border-l-amber-500";
  if (n.type === "min_fill_reached") return "border-l-violet-500";
  return "border-l-transparent";
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
      if (n.type === "min_fill_reached") {
        navigate(`/${n.resource_id}`);
      } else if (n.type === "route_assigned" || n.type === "route_reassigned") {
        navigate("/driver/route");
      } else if (n.type === "trip_driver_assigned") {
        navigate("/viajes");
      } else {
        navigate(`/shipments/${n.resource_id}`);
      }
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="mx-auto max-w-[860px] px-4 py-8">
      {/* Page title */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="m-0 text-xl font-bold dark:text-gray-100 text-slate-900">
          Notificaciones
        </h1>
        <button
          onClick={handleMarkAllRead}
          className="inline-flex items-center gap-1.5 bg-[var(--sidebar-bg)] text-slate-200 border-none rounded-lg px-3.5 py-1.5 cursor-pointer text-xs font-medium"
        >
          <CheckCheck size={15} />
          Marcar todas como leídas
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2.5 mb-5 flex-wrap items-end">
        <div className="flex-[1_1_200px] min-w-[160px]">
          <label className="block text-xs dark:text-gray-400 text-slate-500 mb-1">
            Buscar
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Título o contenido..."
            className="w-full px-2.5 py-1.5 rounded-md border dark:border-gray-700 border-slate-200 text-xs box-border"
          />
        </div>
        <div className="flex-[0_1_160px]">
          <label className="block text-xs dark:text-gray-400 text-slate-500 mb-1">
            Desde
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md border dark:border-gray-700 border-slate-200 text-xs box-border"
          />
        </div>
        <div className="flex-[0_1_160px]">
          <label className="block text-xs dark:text-gray-400 text-slate-500 mb-1">
            Hasta
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md border dark:border-gray-700 border-slate-200 text-xs box-border"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-4.5 py-1.5 bg-[var(--sidebar-bg)] text-white border-none rounded-md cursor-pointer text-xs font-semibold self-end"
        >
          Buscar
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center dark:text-gray-400 text-slate-500 py-10">Cargando...</div>
      ) : notifications.length === 0 ? (
        <div className="text-center dark:text-gray-500 text-slate-400 py-12 dark:bg-gray-800 bg-white rounded-xl border border-dashed dark:border-gray-700 border-slate-200">
          <Bell size={36} className="text-slate-300 mb-3" />
          <div className="text-sm">No hay notificaciones</div>
        </div>
      ) : (
        <div className="border dark:border-gray-700 border-slate-200 rounded-xl overflow-hidden dark:bg-gray-800 bg-white">
          {notifications.map((n, idx) => (
            <div
              key={n.id}
              onClick={() => handleItemClick(n)}
              className={`flex gap-3.5 items-start px-5 py-3.5 ${idx < notifications.length - 1 ? "border-b dark:border-gray-700 border-slate-100" : ""} ${notifRowBg(n)} border-l-[3px] ${notifRowBorder(n)} cursor-pointer transition-colors duration-150 hover:bg-blue-50`}
            >
              <div className="mt-0.5 shrink-0">
                <NotifIcon type={n.type} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-3 flex-wrap">
                  <span
                    className={`text-sm ${n.read_at ? "font-normal" : "font-semibold"} dark:text-gray-100 text-slate-900`}
                  >
                    {n.title}
                  </span>
                  <div className="flex gap-2.5 items-center shrink-0">
                    <span className="dark:text-gray-500 text-slate-400 text-xs">
                      {relativeTime(n.created_at, clockOffsetMs)}
                    </span>
                    <span className="text-slate-300 text-xs">
                      {formatDate(n.created_at)}
                    </span>
                  </div>
                </div>
                <div className="text-xs dark:text-gray-400 text-slate-500 mt-0.5">
                  {n.type === "sla_risk" ? bodyWithoutEta(n.body) : n.body}
                </div>
                {/* Countdown live para sla_risk — solo mientras el SLA sigue vigente */}
                {n.type === "sla_risk" && (() => {
                  const eta = parseSLAEta(n.body);
                  if (!eta) return null;
                  const label = slaCountdown(eta, clockOffsetMs);
                  if (label === "venció") return null; // sla_expired ya cubre este estado
                  return (
                    <div className={`text-xs mt-0.5 font-semibold ${accentClass(n.type, "text")}`}>
                      {label}
                    </div>
                  );
                })()}
                {/* Label para sla_expired */}
                {n.type === "sla_expired" && (
                  <div className={`text-xs mt-0.5 font-bold ${accentClass(n.type, "text")}`}>
                    SLA vencido
                  </div>
                )}
                {/* Acción requerida para return_completed y return_arrival — CA-05 */}
                {(n.type === "return_completed" || n.type === "return_arrival") && (
                  <div className="text-xs mt-0.5 font-bold text-amber-500">
                    Acción requerida: coordinar entrega con remitente
                  </div>
                )}
                {n.resource_id && (
                  <div className="text-xs text-blue-500 mt-1">
                    #{n.resource_id}
                  </div>
                )}
              </div>
              {!n.read_at && (
                <div
                  className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${accentClass(n.type, "bg")}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-5 flex-wrap gap-2">
          <span className="text-xs dark:text-gray-400 text-slate-500">
            {total} resultado{total !== 1 ? "s" : ""} · Página {currentPage} de {totalPages}
          </span>
          <div className="flex gap-1.5">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className={`px-3.5 py-1.5 rounded-md border dark:border-gray-700 border-slate-200 text-xs ${
                offset === 0
                  ? "dark:bg-gray-800/50 bg-slate-50 dark:text-gray-500 text-slate-400 cursor-not-allowed"
                  : "dark:bg-gray-800 bg-white dark:text-gray-100 text-slate-900 cursor-pointer"
              }`}
            >
              ← Anterior
            </button>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className={`px-3.5 py-1.5 rounded-md border dark:border-gray-700 border-slate-200 text-xs ${
                offset + PAGE_SIZE >= total
                  ? "dark:bg-gray-800/50 bg-slate-50 dark:text-gray-500 text-slate-400 cursor-not-allowed"
                  : "dark:bg-gray-800 bg-white dark:text-gray-100 text-slate-900 cursor-pointer"
              }`}
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
