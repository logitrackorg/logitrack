import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface RiskThresholds {
  green_max: number;
  red_min: number;
}

export interface VoiceWeights {
  pitch_mean: number;
  pitch_range: number;
  energy_rms: number;
  speech_rate: number;
  pause_ratio: number;
}

export interface KSSScores {
  kss_1_4: number;
  kss_5_7: number;
  kss_8_9: number;
}

export interface FatigueConfig {
  risk_thresholds: RiskThresholds;
  voice_weights: VoiceWeights;
  min_baseline_days: number;
  kss_scores: KSSScores;
  /** ISO timestamp; null/absent when no reset has been triggered yet. */
  last_checkin_reset?: string | null;
}

export const fatigueConfigApi = {
  get: () =>
    api.get<FatigueConfig>("/admin/fatigue-config").then((r) => r.data),
  update: (cfg: FatigueConfig) =>
    api.put<FatigueConfig>("/admin/fatigue-config", cfg).then((r) => r.data),
  /** Forces every driver to redo (or skip) today's fatigue gate.
   *  Existing check-in data is preserved. */
  resetCheckins: () =>
    api.post<FatigueConfig>("/admin/fatigue-config/reset-checkins").then((r) => r.data),
};
