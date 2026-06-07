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
  status: string;
  avg_hours: number;
  /** false = todavía no hay suficientes transiciones históricas para calcular este promedio */
  has_data: boolean;
}

export type FleetStatus =
  | "CRÍTICO"
  | "ADVERTENCIA"
  | "PREVENTIVO"
  | "OCIOSO"
  | "ESTABLE";

/** Operational metrics collected from DB. Status/message from heuristic (compat). */
export interface FleetSuggestion {
  status: FleetStatus;
  message: string;
  delay_rate_pct: number;
  active_drivers: number;
  idle_drivers: number;
  orphan_shipments: number;
  active_drivers_load: number;
  drivers_needed?: number;
  capacity_used_pct?: number;
}

/** Raw operational numbers shared by both classification engines. */
export interface FleetRawMetrics {
  total_shipments: number;
  sla_delay_pct: number;
  orphan_shipments: number;
  idle_drivers: number;
  active_drivers: number;
  active_drivers_load: number;
  /** Recommended staffing delta. >0 = hire, <0 = deactivate, 0 = no action. */
  suggested_driver_delta: number;
}

/** Result of one fleet classification engine (heuristic or ML). */
export interface FleetDiagnosis {
  status: FleetStatus;
  message: string;
  /** Vote fraction 0–1. Present for ML only; absent for heuristic. */
  confidence?: number;
  /** Raw operational metrics used as input to this engine. Always present. */
  raw_metrics?: FleetRawMetrics;
  /** Per-class vote share (0–100). Present for ML only. */
  vote_distribution?: Record<string, number>;
}

export interface SLAMetrics {
  sla_health_rate: number;
  active_total: number;
  delayed_total: number;
  bottlenecks: SLABottleneck[];
  delay_trend: SLADayCount[];
  current_averages: SLAStateAverage[];
  /** Operational metrics + heuristic status (backward compat). */
  fleet_suggestion: FleetSuggestion;
  /** Pure deterministic heuristic result — always present. */
  heuristic_diagnosis: FleetDiagnosis;
  /** Random Forest result. Null when the model has not been loaded yet. */
  ml_prediction: FleetDiagnosis | null;
}

export const slaMetricsApi = {
  get: () =>
    api.get<SLAMetrics>("/stats/sla-metrics").then((r) => r.data),
};
