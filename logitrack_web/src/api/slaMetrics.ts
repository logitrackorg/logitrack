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

/** Raw operational numbers shared by both classification engines. */
export interface FleetRawMetrics {
  total_shipments: number;
  sla_delay_pct: number;
  orphan_shipments: number;
  idle_drivers: number;
  active_drivers: number;
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

/** Heuristic + ML diagnosis for a single branch — both engines evaluate each
 *  branch's operation independently. */
export interface BranchFleetDiagnosis {
  branch_id: string;
  branch_name: string;
  heuristic_diagnosis: FleetDiagnosis;
  ml_prediction: FleetDiagnosis | null;
}

export interface SLAMetrics {
  sla_health_rate: number;
  active_total: number;
  delayed_total: number;
  bottlenecks: SLABottleneck[];
  delay_trend: SLADayCount[];
  current_averages: SLAStateAverage[];
  /** One heuristic+ML diagnosis per active branch. */
  fleet_diagnoses: BranchFleetDiagnosis[];
}

export const slaMetricsApi = {
  get: () =>
    api.get<SLAMetrics>("/stats/sla-metrics").then((r) => r.data),
};
