// devicePermissions — solicita explícitamente los permisos de hardware que el
// test de fatiga (y el flujo del chofer) necesitan ANTES de iniciar (BUG-46):
//   - Geolocalización: para el seguimiento de ruta y el gate de velocidad (BUG-43).
//   - Micrófono: requerido por el sub-test de voz (VoiceCheckIn → getUserMedia).
//
// Las APIs nativas (getCurrentPosition / getUserMedia) disparan el prompt de
// permisos del navegador la primera vez que se invocan. Esta función las llama
// de forma controlada y reporta cuáles fueron denegadas.

export type DevicePermission = "geolocation" | "microphone";

export interface PermissionCheckResult {
  /** true solo si TODOS los permisos requeridos fueron concedidos. */
  granted: boolean;
  /** Lista de permisos denegados o no disponibles. */
  denied: DevicePermission[];
  /** Mensaje legible para mostrar al chofer cuando algo falta. */
  message: string;
}

const PERMISSION_LABELS: Record<DevicePermission, string> = {
  geolocation: "Ubicación (GPS)",
  microphone: "Micrófono",
};

/** Solicita la ubicación. Resuelve true si se concede, false si se deniega/no existe. */
function requestGeolocation(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn("[devicePermissions] Geolocalización no soportada por el dispositivo.");
      resolve(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => {
        console.warn(`[devicePermissions] Ubicación denegada o sin señal: ${err.message}`);
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

/** Solicita el micrófono. Resuelve true si se concede; libera el stream de inmediato. */
async function requestMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn("[devicePermissions] mediaDevices.getUserMedia no disponible.");
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // No necesitamos grabar acá: solo gatillar el permiso. Liberar el hardware.
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    console.warn(`[devicePermissions] Micrófono denegado: ${(err as Error)?.message ?? err}`);
    return false;
  }
}

/**
 * checkDevicePermissions — solicita ubicación + micrófono y devuelve el estado
 * agregado. Pensada para ejecutarse ANTES de montar el test de fatiga.
 */
export async function checkDevicePermissions(): Promise<PermissionCheckResult> {
  // En paralelo: ambos prompts pueden coexistir; el navegador los encola.
  const [geoOk, micOk] = await Promise.all([requestGeolocation(), requestMicrophone()]);

  const denied: DevicePermission[] = [];
  if (!geoOk) denied.push("geolocation");
  if (!micOk) denied.push("microphone");

  const granted = denied.length === 0;
  const message = granted
    ? "Permisos concedidos."
    : `Para iniciar tu jornada necesitás habilitar: ${denied
        .map((d) => PERMISSION_LABELS[d])
        .join(" y ")}. Activá los permisos en tu navegador y volvé a intentar.`;

  return { granted, denied, message };
}
