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

export interface SLAMetrics {
  sla_health_rate: number;   // 0–100
  active_total: number;
  delayed_total: number;
  bottlenecks: SLABottleneck[];
  delay_trend: SLADayCount[];
}

export const slaMetricsApi = {
  get: () =>
    api.get<SLAMetrics>("/stats/sla-metrics").then((r) => r.data),
};
