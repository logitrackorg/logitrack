// driverDebug — logging de diagnóstico para las pantallas del chofer de última
// milla. Loguea a la consola (visible al reproducir en el navegador) y, en
// best-effort, emite un evento a PostHog con el prefijo `driver_debug_` para
// poder consultar el flujo en producción sin depender de la consola del chofer.
//
// Pensado para investigar el bounce post check-in (chofer rebotado a
// /driver/scan en vez de quedar en su ruta). Quitar una vez identificada la
// causa raíz.
import posthog from "posthog-js";

export function driverDebug(event: string, props: Record<string, unknown> = {}): void {
  const payload = { ...props, ts: new Date().toISOString(), path: window.location.pathname };
  // eslint-disable-next-line no-console
  console.log(`[driver-debug] ${event}`, payload);
  try {
    posthog.capture(`driver_debug_${event}`, payload);
  } catch {
    /* PostHog es opcional — nunca romper el flujo del chofer por un log */
  }
}
