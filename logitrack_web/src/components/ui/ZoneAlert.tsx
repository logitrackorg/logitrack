import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Zone } from "../../api/zones";

interface ZoneAlertProps {
  zones: Zone[];
  /** Callback que informa al padre si el cartel grande está descartado (para el badge minimizado). */
  onDismissedChange?: (dismissed: boolean) => void;
}

export function ZoneAlert({ zones, onDismissedChange }: ZoneAlertProps) {
  const activeZones = zones.filter((z) => z.active);
  const [isDismissed, setIsDismissed] = useState(false);

  // Cada vez que el conjunto de zonas activas cambia (se entra a una nueva zona,
  // o se sale y se vuelve a entrar), el cartel vuelve a mostrarse.
  const zoneKey = activeZones.map((z) => z.id).join(",");
  useEffect(() => {
    if (activeZones.length > 0) {
      setIsDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey]);

  // Notificar al padre cuando cambia el estado de descarte.
  useEffect(() => {
    onDismissedChange?.(isDismissed && activeZones.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDismissed, activeZones.length]);

  if (activeZones.length === 0) return null;

  const first = activeZones[0];

  // Cartel descartado → no renderizar nada aquí; el badge minimizado vive en el header.
  if (isDismissed) return null;

  return (
    /*
     * pointer-events-none en el wrapper externo NO es correcto aquí porque
     * necesitamos que el botón "X" sea clickeable. En cambio:
     *   - Usamos `w-fit` para que el div no se expanda a todo el ancho.
     *   - No usamos `inset-x-0` ni `w-full` para que no capture clics fuera.
     *   - z-20 queda por debajo del z-30 de los controles del simulador.
     */
    <div
      className="fixed top-[92px] left-1/2 -translate-x-1/2 z-[1600] w-fit max-w-[calc(100%-2rem)] pointer-events-auto"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 shadow-[0_4px_20px_rgba(239,68,68,0.25)] animate-[zone-pulse_2s_ease-in-out_infinite] dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />

        <div className="flex-1 min-w-0">
          <p className="font-bold text-xs uppercase tracking-wide">ZONA PELIGROSA</p>
          <p className="text-xs mt-0.5 truncate">
            {first.name}
            {first.description ? ` — ${first.description}` : ""}
          </p>
        </div>

        {activeZones.length > 1 && (
          <span className="shrink-0 bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 text-[10px] font-semibold dark:bg-red-500/20 dark:text-red-300">
            +{activeZones.length - 1}
          </span>
        )}

        {/* Botón de cierre */}
        <button
          onClick={() => setIsDismissed(true)}
          aria-label="Cerrar aviso de zona peligrosa"
          className="ml-2 shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
