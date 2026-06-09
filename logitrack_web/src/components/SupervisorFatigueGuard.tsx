import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Unlock } from "lucide-react";
import { supervisorFatigueApi, type ActiveFatigueAlert } from "../api/supervisorFatigue";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 30_000;

interface Props {
  children: React.ReactNode;
}

/** Envuelve el layout de supervisores y managers.
 *  Cada 30 s consulta GET /supervisor/fatigue-alerts.
 *  Si hay alertas activas (choferes con nivel ROJO sin revisar), muestra un
 *  modal emergente de pantalla completa con dos acciones:
 *    - "Cortar ruta y llamar de vuelta": llama al endpoint de recall y descarta.
 *    - "No hacer nada": descarta sin acción.
 *  Si hay múltiples alertas se procesan de a una (la más reciente primero).
 *  Solo visible para supervisores y managers. */
export function SupervisorFatigueGuard({ children }: Props) {
  const { user } = useAuth();
  const isSupervisorOrManager =
    user?.role === "supervisor" || user?.role === "manager";

  const [queue, setQueue] = useState<ActiveFatigueAlert[]>([]);
  const [unblocking, setUnblocking] = useState(false);
  const [unblocked, setUnblocked] = useState(false);

  const current = queue[0] ?? null;

  const removeFirst = () =>
    setQueue((prev) => prev.slice(1));

  const poll = useCallback(async () => {
    if (!isSupervisorOrManager) return;
    try {
      const res = await supervisorFatigueApi.getActiveAlerts();
      if (res.alerts.length === 0) return;
      // Solo agregar a la cola alertas que no están ya en ella
      setQueue((prev) => {
        const inQueue = new Set(prev.map((a) => a.driver_id));
        const news = res.alerts.filter((a) => !inQueue.has(a.driver_id));
        return news.length > 0 ? [...prev, ...news] : prev;
      });
    } catch {
      // Error de red — no interrumpir el flujo
    }
  }, [isSupervisorOrManager]);

  useEffect(() => {
    if (!isSupervisorOrManager) return;
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isSupervisorOrManager, poll]);

  // Resetear estado cuando cambia la alerta mostrada
  useEffect(() => {
    setUnblocked(false);
    setUnblocking(false);
  }, [current?.driver_id]);

  const handleContinue = async () => {
    if (!current) return;
    try {
      await supervisorFatigueApi.dismissAlert(current.driver_id);
    } catch { /* descartar igual */ }
    removeFirst();
  };

  const handleUnblock = async () => {
    if (!current) return;
    setUnblocking(true);
    try {
      await supervisorFatigueApi.unblockDriver(current.driver_id);
      setUnblocked(true);
      setTimeout(() => removeFirst(), 1800);
    } catch {
      setUnblocking(false);
    }
  };

  return (
    <>
      {children}

      {current && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="sup-fatigue-title"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-[rgba(15,23,42,0.88)]"
        >
          <div className="bg-white rounded-2xl max-w-[440px] w-full p-8 shadow-2xl border-[3px] border-red-300 relative">
            {/* Contador de alertas si hay más de una */}
            {queue.length > 1 && (
              <span className="absolute top-4 right-4 bg-red-300 text-red-900 rounded-full px-2.5 py-0.5 text-[11px] font-bold">
                1 de {queue.length}
              </span>
            )}

            {/* Encabezado */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center shrink-0 animate-[sup-pulse_1.4s_ease-in-out_infinite]">
                <AlertTriangle className="w-[26px] h-[26px] text-red-600" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-red-600 tracking-wider uppercase mb-0.5">
                  Alerta de fatiga crítica
                </p>
                <h2
                  id="sup-fatigue-title"
                  className="text-lg font-extrabold text-slate-900 m-0"
                >
                  {current.full_name}
                </h2>
              </div>
            </div>

            {/* Score */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-center gap-2">
              <span className="text-[13px] text-red-900">
                Score de riesgo:{" "}
                <strong className="text-[15px]">{current.score}/100</strong>
                {" — nivel "}
                <strong className="text-red-600">ROJO</strong>
              </span>
            </div>

            {/* Mensaje */}
            <p className="text-sm text-slate-700 leading-relaxed mb-6">
              El chofer <strong>{current.full_name}</strong> tuvo un mal desempeño en el
              test de fatiga. Realizá las acciones correspondientes de inmediato.
            </p>

            {/* Confirmación de desbloqueo */}
            {unblocked ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-orange-800 text-[13px] font-semibold text-center">
                <Unlock size={16} className="inline mr-1" /> Ruta desbloqueada. El chofer puede continuar.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={() => void handleUnblock()}
                  disabled={unblocking}
                  className={`bg-orange-500 text-white rounded-xl py-3 px-5 text-sm font-bold flex items-center justify-center gap-2 ${
                    unblocking ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <Unlock size={14} className="mr-1" /> {unblocking ? "Desbloqueando…" : "Desbloquear ruta"}
                </button>
                <button
                  onClick={() => void handleContinue()}
                  disabled={unblocking}
                  className={`bg-transparent text-slate-500 border border-slate-300 rounded-xl py-3 px-5 text-sm font-semibold ${
                    unblocking ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  Continuar
                </button>
              </div>
            )}

            {/* Animación CSS */}
            <style>{`
              @keyframes sup-pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
              }
            `}</style>
          </div>
        </div>
      )}
    </>
  );
}
