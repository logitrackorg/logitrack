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
  horas_sueno: number;
  kss_level: number;
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

export const driverApi = {
  getRoute: () => api.get<DriverRouteResponse>("/driver/route").then((r) => r.data),
  startRoute: () => api.post<{ route: DriverRoute }>("/driver/route/start").then((r) => r.data),
  submitCheckin: (payload: CheckInPayload) =>
    api.post("/driver/checkin", payload).then((r) => r.data),
  getControlPhrase: () =>
    api.get<{ phrase: string }>("/driver/control-phrase").then((r) => r.data),
  uploadVoice: (audioBlob: Blob) => {
    const form = new FormData();
    form.append("audio", audioBlob, "checkin.webm");
    return api.post<VoiceUploadResult>("/driver/voice-upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
};
