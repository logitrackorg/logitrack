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
}

export const slaSettingsApi = {
  get: () =>
    api.get<SLASettings>("/admin/sla-settings").then((r) => r.data),
  update: (settings: SLASettings) =>
    api.put<SLASettings>("/admin/sla-settings", settings).then((r) => r.data),
};
