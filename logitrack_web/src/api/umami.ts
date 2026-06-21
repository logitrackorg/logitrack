import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ────────────────────────────────────────────────────────────────
// Tipos — basados en la respuesta del endpoint /v1/websites/:id/stats
// y /v1/websites/:id/pageviews de la API de Umami Cloud.
// ────────────────────────────────────────────────────────────────

// Umami devuelve los totales como números planos, y los valores del período
// anterior agrupados aparte en "comparison" (no como {value, prev} por métrica).
export interface UmamiComparison {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

export interface UmamiStats {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
  comparison: UmamiComparison;
}

export interface UmamiPageviewPoint {
  x: string; // fecha, formato YYYY-MM-DD
  y: number;
}

export interface UmamiPageviews {
  pageviews: UmamiPageviewPoint[];
  sessions: UmamiPageviewPoint[];
}

export const umamiApi = {
  getStats: () =>
    api.get<UmamiStats>("/analytics/umami/stats").then((r) => r.data),
  getPageviews: (days = 30) =>
    api
      .get<UmamiPageviews>("/analytics/umami/pageviews", { params: { days } })
      .then((r) => r.data),
};