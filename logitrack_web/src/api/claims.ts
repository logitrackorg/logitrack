import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export type ClaimStatus =
  | "open"
  | "in_review"
  | "pending_customer"
  | "derived"
  | "resolved_operativa"
  | "resolved_comercial"
  | "resolved_rrhh"
  | "resolved_improcedente";

export type ClaimType =
  | "damage"
  | "missing"
  | "delay"
  | "not_delivered"
  | "bad_treatment"
  | "wrong_data"
  | "other";

export type ClaimCategory =
  | "operaciones"
  | "comercial"
  | "rrhh"
  | "legales"
  | "seguros"
  | "administracion";

export type ClaimResolutionType = "operativa" | "comercial" | "rrhh" | "improcedente";

export interface Claim {
  id: string;
  tracking_id: string;
  claim_type: ClaimType;
  status: ClaimStatus;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  assigned_category?: ClaimCategory;
  resolution_type?: ClaimResolutionType;
  is_automatic: boolean;
}

export type ClaimEventType = "claim_created" | "claim_category_updated" | "claim_resolved";

export interface ClaimEvent {
  id: string;
  claim_id: string;
  event_type: ClaimEventType;
  changed_by: string;
  timestamp: string;
  notes?: string;
  claim_type?: ClaimType;
  assigned_category?: ClaimCategory;
  resolution_type?: ClaimResolutionType;
  from_status?: ClaimStatus;
  to_status?: ClaimStatus;
}

export const CLAIM_EVENT_LABELS: Record<ClaimEventType, string> = {
  claim_created: "Reclamo registrado",
  claim_category_updated: "Derivado a área",
  claim_resolved: "Reclamo resuelto",
};

export const claimsApi = {
  list: () => api.get<Claim[]>("/claims").then((r) => r.data),
  get: (id: string) => api.get<Claim>(`/claims/${id}`).then((r) => r.data),
  getEvents: (id: string) => api.get<ClaimEvent[]>(`/claims/${id}/events`).then((r) => r.data),
  updateCategory: (id: string, category: ClaimCategory) =>
    api.patch<Claim>(`/claims/${id}/category`, { assigned_category: category }).then((r) => r.data),
  resolve: (id: string, resolution: ClaimResolutionType) =>
    api.post<Claim>(`/claims/${id}/resolve`, { resolution_type: resolution }).then((r) => r.data),
};
