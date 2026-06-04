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
  /** ISO timestamp de la última vez que el Collector calculó promedios.
   *  Null si el motor aún no corrió desde el último reinicio. */
  last_calculated_at?: string | null;
}

export const slaSettingsApi = {
  get: () =>
    api.get<SLASettings>("/admin/sla-settings").then((r) => r.data),
  update: (settings: SLASettings) =>
    api.put<SLASettings>("/admin/sla-settings", settings).then((r) => r.data),
};
