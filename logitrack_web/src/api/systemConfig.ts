import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const client = axios.create({ baseURL: API_BASE });
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface SystemConfig {
  max_delivery_attempts: number;
  /** Days before a draft is automatically expired (default 7). */
  draft_retention_days: number;
  /** Days after expiration before PII is irreversibly anonymized (default 30). */
  draft_purge_days: number;
  /** Days a shipment can be held at ready_for_pickup before return. 0 = no limit (default). */
  pickup_deadline_days: number;
  /** When true, email notifications are sent to customers. Default: true. */
  email_notifications_enabled: boolean;
  /** When true, WhatsApp notifications are sent to customers. Default: true. */
  whatsapp_notifications_enabled: boolean;
  /** Maximum number of times a customer can reschedule delivery via chatbot. Range: 0-10 (default 2). */
  max_reschedules: number;
  max_reschedule_days: number;
  two_fa_cooldown_minutes: number;
  /** Umbral del detector de cobertura: área máxima (km²) de una celda antes de marcarla como gap. El diagrama usa un bounding box nacional fijo (~6.7M km²). Rango 100–10000000 (default 1000000). */
  max_coverage_area_km2: number;
}

export const systemConfigApi = {
  get: (): Promise<SystemConfig> =>
    client.get<SystemConfig>("/system/config").then((r) => r.data),

  update: (cfg: SystemConfig): Promise<SystemConfig> =>
    client.patch<SystemConfig>("/system/config", cfg).then((r) => r.data),

  getPublicConfig: (): Promise<{ two_fa_cooldown_minutes: number }> =>
    client.get<{ two_fa_cooldown_minutes: number }>("/public/config").then((r) => r.data),
};