import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface SLASettings {
  tolerance_multiplier: number;
  priority_ceiling: "media" | "alta";
  enabled_states: string[];
  cache_interval_minutes: number;
  /** Kill-switch: cuando es false el motor detecta demoras y las registra en
   *  el log pero NO modifica la prioridad en la base de datos. Default: true. */
  auto_escalate: boolean;
  /** Hora de Argentina (24 h, "HH:MM") en la que el Executor dispara la
   *  repriorización diaria. Default: "23:00". */
  escalation_time: string;
  /** Pre-formatted Argentina-time string sent by the server (e.g. "14/06/2026, 23:05:12").
   *  Empty string when no calculation has run yet. Display verbatim — no date parsing. */
  last_calculated_at?: string;
  /** Estado actual del Collector: "sin medicion" | "en proceso" | "completado" */
  calculation_status?: string;
  /** Duración del último ciclo del Collector (ej. "45ms", "2.3s"). Vacío si no corrió. */
  last_calculation_duration?: string;
  /** Modo de ejecución del Collector: "periodic" | "daily". Default "periodic". */
  calculation_mode?: "periodic" | "daily";
}

export const slaSettingsApi = {
  get: () =>
    api.get<SLASettings>("/admin/sla-settings").then((r) => r.data),
  update: (settings: SLASettings) =>
    api.put<SLASettings>("/admin/sla-settings", settings).then((r) => r.data),
};
