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
  /** Prioridad de reclamos: tope de "urgentes" por sucursal como fracción (0,1]. Default 0.20. */
  urgent_claims_cap_pct: number;
  /** Prioridad de reclamos: umbral del priority_score ML para clasificar alta. (0,1]. Default 0.65. */
  claims_high_priority_threshold: number;
  /** Prioridad de reclamos: umbral del priority_score ML para clasificar media. (0,1] y < high. Default 0.35. */
  claims_medium_priority_threshold: number;
  /** Escalado automático de prioridad: si está habilitado, un job sube de nivel los reclamos no terminales inactivos. Default true. */
  claim_escalation_enabled: boolean;
  /** Días de inactividad para escalar baja → media. Rango UI 1–5. Default 3. */
  claim_escalation_baja_days: number;
  /** Días de inactividad para escalar media → alta. Rango UI 1–5. Default 2. */
  claim_escalation_media_days: number;
  /** Días de inactividad para escalar alta → urgente. Rango UI 1–5. Default 1. */
  claim_escalation_alta_days: number;
  /** Días desde la entrega hasta que la foto de evidencia deja de ser accesible (410 Gone). Default 365. Rango 1–3650. */
  photo_retention_days: number;
  /** Días después de la expiración hasta que el archivo de foto es eliminado físicamente. Default 30. Rango 1–1825. */
  photo_purge_days: number;
}

export const systemConfigApi = {
  get: (): Promise<SystemConfig> =>
    client.get<SystemConfig>("/system/config").then((r) => r.data),

  update: (cfg: SystemConfig): Promise<SystemConfig> =>
    client.patch<SystemConfig>("/system/config", cfg).then((r) => r.data),

  getPublicConfig: (): Promise<{ two_fa_cooldown_minutes: number }> =>
    client.get<{ two_fa_cooldown_minutes: number }>("/public/config").then((r) => r.data),
};