import axios from "axios";
import type { Shipment } from "./shipments";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export interface DriverRoute {
  id: string;
  date: string;
  driver_id: string;
  shipment_ids: string[];
  created_by: string;
  created_at: string;
  status: "pendiente" | "en_curso" | "finalizada";
  started_at?: string;
  // Horario óptimo de salida sugerido por el motor de ruteo. Es informativo:
  // ayuda al chofer a decidir cuándo arrancar para cumplir las ventanas de
  // entrega. Si la ruta se creó manualmente queda undefined.
  suggested_start_time?: string;
}

export interface DriverRouteResponse {
  route: DriverRoute;
  shipments: Shipment[];
  waypoints?: Array<{
    sequence: number;
    tracking_id: string;
    latitude: number;
    longitude: number;
    name: string;
    address: string;
    status: string;
  }>;
  origin?: {
    latitude: number;
    longitude: number;
    name: string;
  };
}


export interface CheckInPayload {
  driver_id: string;
  /** Omit when the driver already reported sleep for today's logical day. */
  horas_sueno?: number;
  kss_level: number;
  /** Coordenadas capturadas con navigator.geolocation al iniciar la prueba. */
  latitude?: number;
  longitude?: number;
}

export interface VoiceMetrics {
  pitch_mean: number;
  pitch_range: number;
  energy_rms: number;
  speech_rate: number;
  pause_ratio: number;
}

export interface VoiceUploadResult {
  ok: boolean;
  voice_metrics: VoiceMetrics;
  drift_score: number | null; // null on first upload (no baseline yet)
  baseline: VoiceMetrics | null;
}

// US4: Tactile event capture
export interface TouchEventPayload {
  tracking_id: string;
  action: "entregado" | "no_entregado";
  reaction_time_ms: number;
  misfires: number;
}

// US4+: respuesta del gate de re-test en ruta
export interface TestEligibilityResponse {
  require_test: boolean;
  reason?: "tactile_and_time" | "trip_start" | "stopped_too_long" | "checkpoint";
}

export interface TestEligibilityParams {
  /** Inicio de viaje inter-sucursal → siempre require_test: true */
  is_trip_start?: boolean;
  /** Minutos detenido en ruta inter-sucursal → require_test si >= 6 */
  stopped_minutes?: number;
  /** Geocerca de checkpoint (peaje, balanza, estación) → require_test: true */
  checkpoint?: boolean;
  /** Última milla: misfires del paquete actual (enviado antes del reseteo) */
  misfires?: number;
}

// US6: PVT (Psychomotor Vigilance Task)
export interface PVTPayload {
  latencia_promedio_ms: number;
  aciertos: number;
  errores: number;
  game_errors: number;
}

export interface PVTResult {
  latencia_promedio_ms: number;
  aciertos: number;
  errores: number;
  game_errors?: number;
  /** Composite quality score 0–100 (higher = better). Null/absent for legacy records. */
  pvt_score?: number | null;
  recorded_at: string;
}

export type PersonalHistoryStatus = "pending" | "approved" | "rejected" | "sin_solicitud";

// Solicitud de gobernanza de datos (acceso o eliminación de historial). Misma
// forma para ambos tipos — se distinguen por el campo `type` en el backend.
export interface HistoryGovernanceRequest {
  driver_id: string;
  status: PersonalHistoryStatus;
  request_date: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_note?: string;
}

export interface PersonalHistoryResult {
  ok: boolean;
  request_status?: PersonalHistoryStatus;
  history?: import("./supervisorFatigue").CheckinRecord[];
  total?: number;
  request?: HistoryGovernanceRequest;
  /** Solicitud de eliminación/revocación — solo puede crearse cuando `request`
   *  (de acceso) está en estado "approved". Null/undefined si nunca se pidió. */
  deletion_request?: HistoryGovernanceRequest | null;
}

export const driverApi = {
  getRoute: () => api.get<DriverRouteResponse>("/driver/route").then((r) => r.data),
  startRoute: () => api.post<{ route: DriverRoute }>("/driver/route/start").then((r) => r.data),
  getTodayCheckin: () =>
    api.get<{ ok: boolean; requires_sleep_data: boolean; requires_fatigue_test?: boolean }>("/driver/checkin/today").then((r) => r.data),
  /** Resolves whether the driver must pass the fatigue gate before their next route.
   *  Handles both 200 (check-in válido vigente) y 404 (sin check-in válido hoy).
   *  Never throws — always returns a safe result.
   *
   *  needs_checkin es true cuando NO existe un check-in válido para hoy (404):
   *    - primera ruta del día (todavía no hizo el check-in matutino), o
   *    - el check-in fue invalidado (reset de admin, o venció la gracia de un salto).
   *  Es el caso del primer check-in con horas de sueño.
   *
   *  needs_test (requires_fatigue_test) es ortogonal: true cuando ya inició ≥1 ruta
   *  desde el último check-in (re-test de 2ª ruta en adelante). Puede ser true aun
   *  con check-in válido vigente (200). */
  getCheckinGateStatus: async (): Promise<{ needs_test: boolean; needs_checkin: boolean; requires_sleep_data: boolean }> => {
    try {
      const data = await api
        .get<{ ok: boolean; requires_sleep_data: boolean; requires_fatigue_test?: boolean }>("/driver/checkin/today")
        .then((r) => r.data);
      // 200 → existe un check-in válido vigente. Solo falta gate si requiere re-test.
      return {
        needs_test: !!data.requires_fatigue_test,
        needs_checkin: false,
        requires_sleep_data: !!data.requires_sleep_data,
      };
    } catch (err: unknown) {
      // 404 → no hay check-in válido hoy: el chofer debe completarlo antes de la ruta.
      // El cuerpo incluye requires_fatigue_test y requires_sleep_data.
      const body = (err as { response?: { data?: { requires_fatigue_test?: boolean; requires_sleep_data?: boolean } } })?.response?.data;
      return {
        needs_test: !!body?.requires_fatigue_test,
        needs_checkin: true,
        requires_sleep_data: body?.requires_sleep_data ?? true,
      };
    }
  },
  submitCheckin: (payload: CheckInPayload) =>
    api.post("/driver/checkin", payload).then((r) => r.data),
  /** Registra que el chofer eligió saltear el check-in de fatiga.
   *  El gate queda suprimido 3 horas; el salto queda en el historial. */
  skipCheckin: () =>
    api.post<{ ok: boolean }>("/driver/checkin/skip").then((r) => r.data),
  /** Registra en segundo plano un evento táctil de entrega (US4).
   *  Se llama de forma asíncrona — la UI no espera la respuesta. */
  submitTouchEvent: (payload: TouchEventPayload) =>
    api.post<{ ok: boolean }>("/driver/touch-events", payload).then((r) => r.data),
  /** Envía el resultado del minijuego PVT (US6). Opcional — el backend acepta
   *  la llamada incluso si no hay un KSS registrado en el día. */
  submitPVT: (payload: PVTPayload) =>
    api.post<{ ok: boolean; pvt: PVTResult }>("/driver/pvt-test", payload).then((r) => r.data),
  /** Consulta si el chofer debe realizar las pruebas de fatiga.
   *  · Última milla: evalúa misfires del paquete actual y tiempo desde check-in.
   *  · Inter-sucursal: evalúa inicio de viaje o tiempo detenido >= 6 min. */
  getTestEligibility: (params?: TestEligibilityParams) =>
    api.get<TestEligibilityResponse>("/driver/test-eligibility", { params }).then((r) => r.data),
  /** Resetea el contador de misfires del último touch event del día.
   *  Se llama después de confirmar una entrega para que el próximo paquete
   *  arranque con contador limpio. */
  resetMisfires: () =>
    api.post<{ ok: boolean }>("/driver/reset-misfires").then((r) => r.data),
  /** DEV: resta 2h01m al timestamp del check-in del día para simular paso de tiempo. */
  fastForwardCheckinTime: () =>
    api.post<{ ok: boolean; new_recorded_at: string }>("/dev/simulator/fast-forward-time").then((r) => r.data),
  getControlPhrase: () =>
    api.get<{ phrase: string }>("/driver/control-phrase").then((r) => r.data),
  uploadVoice: (audioBlob: Blob) => {
    const form = new FormData();
    form.append("audio", audioBlob, "checkin.webm");
    return api.post<VoiceUploadResult>("/driver/voice-upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  /** Incrementa CompletedRoutesToday en el check-in del chofer.
   *  Llamar justo después de que un claim de vehículo es exitoso (QR o patente),
   *  antes de navegar a la ruta. Es la única señal confiable: si se espera
   *  a detectar la finalización, AddShipmentToDriverRoute ya puede haber
   *  reseteado el estado de la ruta y la detección falla. */
  markRouteStarted: () =>
    api.post<{ ok: boolean; routes_started_today?: number }>("/driver/route/mark-started").then((r) => r.data),
  requestHistory: () =>
    api.post<{ ok: boolean; request: NonNullable<PersonalHistoryResult["request"]> }>("/driver/history-request")
      .then((r) => r.data),
  /** Solicita la eliminación/revocación del historial compartido. Solo válida
   *  cuando la solicitud de acceso del chofer está en estado "approved"
   *  (el backend devuelve 409 en caso contrario). */
  requestHistoryDeletion: () =>
    api.post<{ ok: boolean; request: HistoryGovernanceRequest }>("/driver/history-deletion-request")
      .then((r) => r.data),
  getPersonalHistory: (): Promise<PersonalHistoryResult> =>
    api.get("/driver/history")
      .then((r) => ({ ok: true as const, ...r.data }))
      .catch((err) => ({
        ok: false as const,
        request_status: (err?.response?.data?.request_status ?? "sin_solicitud") as PersonalHistoryStatus,
        deletion_request: (err?.response?.data?.deletion_request ?? null) as HistoryGovernanceRequest | null,
      })),
  getFatigueBlockStatus: (): Promise<{ blocked: boolean; recently_unblocked?: boolean; unblocked_by?: string; unblocked_at?: string }> =>
    api.get("/driver/fatigue/block-status").then((r) => r.data),
};
