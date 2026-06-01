import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
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
      setConfirmUnblock(false);
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
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15, 23, 42, 0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              maxWidth: 440,
              width: "100%",
              padding: "32px 28px",
              boxShadow: "0 25px 50px rgba(0,0,0,0.4)",
              border: "3px solid #fca5a5",
              position: "relative",
            }}
          >
            {/* Contador de alertas si hay más de una */}
            {queue.length > 1 && (
              <span
                style={{
                  position: "absolute",
                  top: 16,
                  right: 16,
                  background: "#fca5a5",
                  color: "#7f1d1d",
                  borderRadius: 999,
                  padding: "2px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                1 de {queue.length}
              </span>
            )}

            {/* Encabezado */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "#fee2e2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  animation: "sup-pulse 1.4s ease-in-out infinite",
                }}
              >
                <AlertTriangle style={{ width: 26, height: 26, color: "#dc2626" }} />
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>
                  Alerta de fatiga crítica
                </p>
                <h2
                  id="sup-fatigue-title"
                  style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}
                >
                  {current.full_name}
                </h2>
              </div>
            </div>

            {/* Score */}
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 13, color: "#7f1d1d" }}>
                Score de riesgo:{" "}
                <strong style={{ fontSize: 15 }}>{current.score}/100</strong>
                {" — nivel "}
                <strong style={{ color: "#dc2626" }}>ROJO</strong>
              </span>
            </div>

            {/* Mensaje */}
            <p style={{ fontSize: 14, color: "#334155", lineHeight: 1.6, marginBottom: 24 }}>
              El chofer <strong>{current.full_name}</strong> tuvo un mal desempeño en el
              test de fatiga. Realizá las acciones correspondientes de inmediato.
            </p>

            {/* Confirmación de desbloqueo */}
            {unblocked ? (
              <div style={{
                background: "#fff7ed", border: "1px solid #fed7aa",
                borderRadius: 8, padding: "12px 16px",
                color: "#9a3412", fontSize: 13, fontWeight: 600, textAlign: "center",
              }}>
                🔓 Ruta desbloqueada. El chofer puede continuar.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={() => void handleUnblock()}
                  disabled={unblocking}
                  style={{
                    background: "#f97316", color: "#fff", border: "none",
                    borderRadius: 10, padding: "13px 20px", fontSize: 14, fontWeight: 700,
                    cursor: unblocking ? "not-allowed" : "pointer",
                    opacity: unblocking ? 0.7 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  🔓 {unblocking ? "Desbloqueando…" : "Desbloquear ruta"}
                </button>
                <button
                  onClick={() => void handleContinue()}
                  disabled={unblocking}
                  style={{
                    background: "transparent", color: "#64748b",
                    border: "1px solid #cbd5e1", borderRadius: 10,
                    padding: "12px 20px", fontSize: 14, fontWeight: 600,
                    cursor: unblocking ? "not-allowed" : "pointer",
                    opacity: unblocking ? 0.7 : 1,
                  }}
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
