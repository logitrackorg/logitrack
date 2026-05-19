import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8080/api/v1";
const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ODForecast {
  origin_branch_id: string;
  destination_branch_id: string;
  date: string; // YYYY-MM-DD
  predicted_count: number;
  predicted_weight_kg: number;
  ci_low: number;
  ci_high: number;
  confidence: "high" | "medium" | "low" | "none";
}

export interface ForecastQuality {
  mape: number;
  sample_size: number;
  od_pairs_covered: number;
  evaluated_from: string;
  evaluated_to: string;
}

export interface RollingHorizonODBucket {
  origin_branch_id: string;
  destination_branch_id: string;
  expected_shipments: number;
  expected_weight_kg: number;
  confidence: "high" | "medium" | "low" | "none";
}

export interface RollingHorizonDaySummary {
  total_expected_shipments: number;
  total_expected_weight_kg: number;
  estimated_vehicles_needed: number;
}

export interface RollingHorizonDay {
  date: string;
  is_firm: boolean;
  summary: RollingHorizonDaySummary;
  expected_by_od_pair: RollingHorizonODBucket[];
}

export interface RollingHorizonPlan {
  generated_at: string;
  horizon_days: number;
  days: RollingHorizonDay[];
}

export const routingForecastApi = {
  getForecast: (days = 7) =>
    api.get<{ horizon_days: number; forecasts: ODForecast[] }>(`/admin/routing/forecast?days=${days}`).then((r) => r.data),
  getQuality: () =>
    api.get<ForecastQuality>("/admin/routing/forecast/quality").then((r) => r.data),
  getRollingPlan: (days = 5) =>
    api.get<RollingHorizonPlan>(`/admin/routing/rolling-plan?days=${days}`).then((r) => r.data),
};
