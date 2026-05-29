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

export interface PVTMetricsData {
  latencia_promedio_ms: number;
  aciertos: number;
  errores: number;
  recorded_at: string;
}

export interface TouchEventRecord {
  tracking_id: string;
  action: string;
  reaction_time_ms: number;
  misfires: number;
  recorded_at: string;
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
  pvt_metrics?: PVTMetricsData | null;
  touch_events?: TouchEventRecord[] | null;
}

export interface DriverFatigueStatus {
  driver_id: string;
  full_name: string;
  username: string;
  driver_type: "ultima_milla" | "intersucursal" | "";
  checkin_today: boolean;
  risk_score: number | null;
  risk_level: RiskLevel;
  kss_level: number | null;
  horas_sueno: number | null;
  drift_score: number | null;
  has_voice: boolean;
  pvt_metrics?: PVTMetricsData | null;
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

export interface FatigueDailyMetric {
  date: string;
  verde: number;
  amarillo: number;
  rojo: number;
  salteado: number;
  avg_horas_sueno: number;
  avg_risk_score: number;
}

export interface DriverRankingItem {
  driver_id: string;
  full_name: string;
  username: string;
  avg_risk_score: number;
  avg_horas_sueno: number;
  total_checkins: number;
  risk_level: string;
}

export interface FatigueHistoryResponse {
  branch_id: string;
  daily_metrics: FatigueDailyMetric[];
  driver_ranking: DriverRankingItem[];
  green_max: number;
  red_min: number;
}

export type HistoryRequestStatus = "pending" | "approved" | "rejected";

export interface HistoryAccessRequest {
  driver_id: string;
  status: HistoryRequestStatus;
  request_date: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_note?: string;
  full_name?: string;
  username?: string;
}

export const supervisorFatigueApi = {
  getDashboard: (branchId?: string) => {
    const params = branchId ? { branch_id: branchId } : {};
    return api
      .get<FatigueDashboardResponse>("/supervisor/fatigue-dashboard", { params })
      .then((r) => r.data);
  },
  getHistory: (branchId?: string) => {
    const params = branchId ? { branch_id: branchId } : {};
    return api
      .get<FatigueHistoryResponse>("/supervisor/fatigue-history", { params })
      .then((r) => r.data);
  },
  listHistoryRequests: (status?: HistoryRequestStatus) => {
    const params = status ? { status } : {};
    return api
      .get<{ requests: HistoryAccessRequest[]; total: number }>("/supervisor/history-requests", { params })
      .then((r) => r.data);
  },
  reviewHistoryRequest: (driverID: string, action: "approve" | "reject", note?: string) =>
    api
      .patch<{ ok: boolean; request: HistoryAccessRequest }>(`/supervisor/history-requests/${driverID}`, { action, note })
      .then((r) => r.data),
};
