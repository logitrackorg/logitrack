import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type RiskLevel = "verde" | "amarillo" | "rojo" | "pendiente" | "salteado";

export interface VoiceMetricsSnapshot {
  pitch_mean: number;
  pitch_range: number;
  energy_rms: number;
  speech_rate: number;
  pause_ratio: number;
}

export interface CheckinRecord {
  driver_id: string;
  date: string;              // YYYY-MM-DD
  horas_sueno: number;
  kss_level: number;
  recorded_at: string;       // ISO timestamp
  skipped?: boolean;         // true when driver bypassed the gate
  drift_score: number | null;
  has_voice: boolean;
  voice_metrics: VoiceMetricsSnapshot | null;
}

export interface DriverFatigueStatus {
  driver_id: string;
  full_name: string;
  username: string;
  checkin_today: boolean;
  risk_score: number | null;
  risk_level: RiskLevel;
  kss_level: number | null;
  horas_sueno: number | null;
  drift_score: number | null;
  has_voice: boolean;
  checkin_time: string | null; // ISO timestamp
  history: CheckinRecord[];
}

export interface FatigueDashboardResponse {
  branch_id: string;
  date: string;
  drivers: DriverFatigueStatus[];
  green_max: number;
  red_min: number;
}

export const supervisorFatigueApi = {
  getDashboard: (branchId?: string) => {
    const params = branchId ? { branch_id: branchId } : {};
    return api
      .get<FatigueDashboardResponse>("/supervisor/fatigue-dashboard", { params })
      .then((r) => r.data);
  },
};
