import { useEffect, useState } from "react";
import { TrendingUp, AlertCircle, RefreshCw, ArrowRight } from "lucide-react";
import { priorityLogsApi, type PriorityLog } from "../api/priorityLogs";
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
  const [logs, setLogs] = useState<PriorityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchLogs = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await priorityLogsApi.list();
      setLogs(data.logs);
      setTotal(data.total);
      setError("");
    } catch {
      setError("No se pudo cargar el registro de auditoría. Verificá tu conexión o intentá más tarde.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void fetchLogs(); }, []);

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
              Repriorización automática cuando el tiempo en estado supera el 150 % del promedio histórico
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando registros…</p>
        </Card>
      ) : !error && logs.length === 0 ? (
        <Card className="p-10 text-center">
          <TrendingUp className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">Sin eventos registrados aún</p>
          <p className="mt-1 text-xs text-slate-400">
            El motor de SLA aún no detectó envíos con demora que superen el umbral del 150 %.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Eventos de repriorización
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {total}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      ID de Envío
                    </th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      Fecha y Hora
                    </th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Salto de Prioridad
                    </th>
                    <th className="py-2.5 px-4 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Motivo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, idx) => (
                    <tr
                      key={`${log.tracking_id}-${log.timestamp}-${idx}`}
                      className="border-t border-slate-100 hover:bg-slate-50/60 transition-colors"
                    >
                      {/* Tracking ID */}
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs font-semibold text-[#1e3a5f] bg-[#1e3a5f]/5 px-2 py-0.5 rounded">
                          {log.tracking_id}
                        </span>
                      </td>

                      {/* Timestamp */}
                      <td className="py-3 px-4 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {fmtDateTime(log.timestamp)}
                      </td>

                      {/* Priority jump */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <PriorityBadge level={log.priority_from} />
                          <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <PriorityBadge level={log.priority_to} />
                        </div>
                      </td>

                      {/* Reason */}
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-xs">
                        <span title={log.reason} className="line-clamp-2">
                          {log.reason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
