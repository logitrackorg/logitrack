import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface SLABottleneck {
  status: string;
  count: number;
}

export interface SLADayCount {
  date: string;   // YYYY-MM-DD
  count: number;
}

export interface SLAStateAverage {
  status: string;     // Spanish display name
  avg_hours: number;  // rounded to 1 decimal
}

export type FleetStatus = "CRÍTICO" | "OCIOSO" | "ESTABLE";

export interface FleetSuggestion {
  status: FleetStatus;
  message: string;
  delay_rate_pct: number;
  volume_change_pct: number;
  this_week_count: number;
  last_week_count: number;
}

export interface SLAMetrics {
  sla_health_rate: number;   // 0–100
  active_total: number;
  delayed_total: number;
  bottlenecks: SLABottleneck[];
  delay_trend: SLADayCount[];
  /** Promedios actuales por estado, del caché en memoria del Collector.
   *  Vacío si el motor aún no corrió desde el último reinicio del servidor. */
  current_averages: SLAStateAverage[];
  /** Resultado del motor heurístico de capacidad de flota. */
  fleet_suggestion: FleetSuggestion;
}

export const slaMetricsApi = {
  get: () =>
    api.get<SLAMetrics>("/stats/sla-metrics").then((r) => r.data),
};
