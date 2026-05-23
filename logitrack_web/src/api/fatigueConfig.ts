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

export interface FatigueConfig {
  risk_thresholds: RiskThresholds;

  // Per-test weights (0.0–1.0). Sum of enabled-test weights must equal 1.0.
  kss_weight:     number;
  voice_weight:   number;
  tactile_weight: number;
  pvt_weight:     number;

  // Per-test enable flags. Disabled tests are excluded from the composite score.
  kss_enabled:     boolean;
  voice_enabled:   boolean;
  tactile_enabled: boolean;
  pvt_enabled:     boolean;

  /** Hour (0–23, ART) at which a new logical day begins for the check-in gate. Default 0 = midnight. */
  daily_reset_hour: number;

  /** ISO timestamp; null/absent when no reset has been triggered yet. */
  last_checkin_reset?: string | null;
}

// ── Audit logs (US13) ────────────────────────────────────────────────────────

/** Immutable audit record. Naming mirrors MLConfig (created_at / created_by). */
export interface AuditLog {
  id: string;
  created_at: string;   // ISO 8601
  created_by: string;   // username of the actor (admin or driver)
  action: "UPDATE_FATIGUE_CONFIG" | "SUBMIT_CHECKIN" | "SKIP_CHECKIN";
  details: Record<string, unknown>; // JSON snapshot of what changed
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
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
  /** Returns all audit records newest-first. Strictly read-only (AC2). */
  getAuditLogs: () =>
    api.get<AuditLogsResponse>("/admin/audit-logs").then((r) => r.data),
};
