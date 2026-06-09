import { useEffect, useState } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { accessLogApi, type AccessLog, type AccessEventType } from "../api/accessLog";
import { fmtDateTime } from "../utils/date";
import { Card } from "../components/ui/card";

const EVENT_LABELS: Record<AccessEventType, string> = {
  login_success: "Inicio de sesión",
  login_failure: "Inicio de sesión fallido",
  logout: "Cierre de sesión",
};

const EVENT_BADGE: Record<AccessEventType, string> = {
  login_success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  login_failure: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  logout: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
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
    <div className="p-6 max-w-[1100px] mx-auto">
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Filtrar por usuario…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
            />
          </div>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as AccessEventType | "")}
            className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
          >
            <option value="">Todos los eventos</option>
            <option value="login_success">Inicio de sesión</option>
            <option value="login_failure">Inicio de sesión fallido</option>
            <option value="logout">Cierre de sesión</option>
          </select>
          <span className="ml-auto text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
            {groups.length > 0 && ` · ${groups.length} día${groups.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </Card>

      {loading && (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      )}
      {error && (
        <Card className="p-6 text-center">
          <p className="text-sm text-rose-600">{error}</p>
        </Card>
      )}

      {!loading && !error && groups.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">No se encontraron registros.</p>
        </Card>
      )}

      {!loading && !error && groups.map((group) => {
        const isCollapsed = collapsed[group.key] ?? false;
        const isExpanded = expanded[group.key] ?? false;
        const visibleLogs = isExpanded ? group.logs : group.logs.slice(0, ROWS_PER_GROUP);
        const hasMore = group.logs.length > ROWS_PER_GROUP;

        return (
          <div key={group.key} className="mb-4">
            <button
              onClick={() => toggleCollapse(group.key)}
              className="w-full flex items-center gap-2 py-1.5 text-left cursor-pointer text-slate-700 hover:text-slate-900 transition-colors"
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              <span className="text-sm font-bold capitalize">{formatDayLabel(group.key)}</span>
              <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                {group.logs.length}
              </span>
            </button>

            {!isCollapsed && (
              <>
                <Card className="overflow-hidden mt-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100">
                        <th className={thClass}>Hora</th>
                        <th className={thClass}>Usuario</th>
                        <th className={thClass}>Evento</th>
                        <th className={thClass}>ID de usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLogs.map((log) => (
                        <tr key={log.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-2.5 text-slate-700">{fmtDateTime(log.timestamp)}</td>
                          <td className="px-4 py-2.5 font-semibold text-slate-900">{log.username}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${EVENT_BADGE[log.event_type]}`}>
                              {EVENT_LABELS[log.event_type]}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">
                            {log.user_id || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

                {hasMore && (
                  <button
                    onClick={() => toggleExpand(group.key)}
                    className="mt-2 text-sm font-semibold text-[var(--brand)] hover:text-[var(--brand-strong)] cursor-pointer"
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

const thClass = "px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider";
