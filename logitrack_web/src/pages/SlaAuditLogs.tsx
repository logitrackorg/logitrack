import { useEffect, useMemo, useState } from "react";
import { TrendingUp, AlertCircle, RefreshCw, ArrowRight, Search, Calendar, Building2 } from "lucide-react";
import { priorityLogsApi, type PriorityLog } from "../api/priorityLogs";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { fmtDateTime } from "../utils/date";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const PRIORITY_LABEL: Record<string, string> = {
  baja:  "Baja",
  media: "Media",
  alta:  "Alta",
};

const PRIORITY_BADGE: Record<string, string> = {
  baja:  "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  media: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  alta:  "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

function PriorityBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PRIORITY_BADGE[level] ?? PRIORITY_BADGE.baja}`}>
      {PRIORITY_LABEL[level] ?? level}
    </span>
  );
}

export function SlaAuditLogs() {
  const { user } = useAuth();

  const [logs, setLogs] = useState<PriorityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);

  // ── Filtros ──────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Por defecto: la sucursal del usuario; gerente/admin sin sucursal → "" (todas).
  const [branchFilter, setBranchFilter] = useState<string>(user?.branch_id ?? "");

  const fetchLogs = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await priorityLogsApi.list();
      setLogs(data.logs);
      setError("");
    } catch {
      setError("No se pudo cargar el registro de auditoría. Verificá tu conexión o intentá más tarde.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void fetchLogs(); }, []);
  useEffect(() => { branchApi.listActive().then(setBranches).catch(() => {}); }, []);

  // ── Filtrado reactivo en memoria ───────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const end   = dateTo   ? new Date(`${dateTo}T23:59:59.999`) : null;

    return logs.filter((log) => {
      // Texto: ID, remitente, destinatario o ciudad.
      if (q) {
        const haystack = [
          log.tracking_id,
          log.sender_name,
          log.receiver_name,
          log.origin_city,
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Rango de fechas (inclusive).
      if (start || end) {
        const ts = new Date(log.timestamp);
        if (start && ts < start) return false;
        if (end && ts > end) return false;
      }
      // Sucursal.
      if (branchFilter && log.current_branch_id !== branchFilter) return false;
      return true;
    });
  }, [logs, searchText, dateFrom, dateTo, branchFilter]);

  const clearFilters = () => {
    setSearchText("");
    setDateFrom("");
    setDateTo("");
    setBranchFilter(user?.branch_id ?? "");
  };

  const hasActiveFilters =
    searchText !== "" || dateFrom !== "" || dateTo !== "" || branchFilter !== (user?.branch_id ?? "");

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Auditoría — Escalado Automático SLA</h1>
            <p className="text-[12px] text-slate-500 leading-tight">
              Repriorización automática cuando el tiempo en estado supera el umbral configurado
            </p>
          </div>
        </div>

        <button
          onClick={() => void fetchLogs(true)}
          disabled={refreshing}
          className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* ── Barra de filtros ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            {/* Búsqueda por texto */}
            <div className="flex-1 min-w-0">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Búsqueda</label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Buscar por ID, remitente, destinatario o ciudad..."
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all"
                />
              </div>
            </div>

            {/* Fecha inicio */}
            <div className="shrink-0">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Fecha inicio</label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all"
                />
              </div>
            </div>

            {/* Fecha fin */}
            <div className="shrink-0">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Fecha fin</label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all"
                />
              </div>
            </div>

            {/* Sucursal */}
            <div className="shrink-0">
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Sucursal</label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="h-9 pl-9 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all appearance-none cursor-pointer"
                >
                  <option value="">Todas las sucursales</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="h-9 px-3 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
              >
                Limpiar
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando registros…</p>
        </Card>
      ) : !error && logs.length === 0 ? (
        <Card className="p-10 text-center">
          <TrendingUp className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">Sin eventos registrados aún</p>
          <p className="mt-1 text-xs text-slate-400">
            El motor de SLA aún no detectó envíos con demora que superen el umbral configurado.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Eventos de repriorización
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {filtered.length}{filtered.length !== logs.length ? ` de ${logs.length}` : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">ID de Envío</th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Fecha y Hora</th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Sucursal / Ciudad</th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Salto de Prioridad</th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-slate-400">
                        No hay registros que coincidan con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((log, idx) => (
                      <tr
                        key={`${log.tracking_id}-${log.timestamp}-${idx}`}
                        className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <span className="font-mono text-xs font-semibold text-[var(--sidebar-bg)] bg-[var(--sidebar-bg)]/5 px-2 py-0.5 rounded">
                            {log.tracking_id}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {fmtDateTime(log.timestamp)}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {log.current_branch || log.origin_city || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <PriorityBadge level={log.priority_from} />
                            <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                            <PriorityBadge level={log.priority_to} />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                          <span title={log.reason} className="line-clamp-2">{log.reason}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
