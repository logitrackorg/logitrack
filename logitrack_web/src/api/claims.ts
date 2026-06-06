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
  evidence_file_name?: string;
  evidence_mime_type?: string;
  evidence_upload_date?: string;
}

export type ClaimEventType =
  | "claim_created"
  | "claim_category_updated"
  | "claim_resolved"
  | "claim_pending_customer"
  | "claim_in_review"
  | "claim_customer_responded";

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
  evidence_file_name?: string;
  evidence_file_path?: string;
}

export const CLAIM_EVENT_LABELS: Record<ClaimEventType, string> = {
  claim_created: "Reclamo registrado",
  claim_category_updated: "Derivado a área",
  claim_resolved: "Reclamo resuelto",
  claim_pending_customer: "Solicitud de información al cliente",
  claim_in_review: "Reclamo en revisión",
  claim_customer_responded: "Respuesta del cliente",
};

export const claimsApi = {
  list: (branchId?: string, status?: ClaimStatus) => {
    const params = [] as string[];
    if (branchId) params.push(`branch_id=${encodeURIComponent(branchId)}`);
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    const url = params.length ? `/claims?${params.join("&")}` : "/claims";
    return api.get<Claim[]>(url).then((r) => r.data);
  },
  get: (id: string) => api.get<Claim>(`/claims/${id}`).then((r) => r.data),
  getEvents: (id: string) => api.get<ClaimEvent[]>(`/claims/${id}/events`).then((r) => r.data),
  downloadEvidence: async (id: string) => {
    const response = await api.get(`/claims/${id}/evidence/download`, { responseType: "blob" });
    return response.data as Blob;
  },
  updateCategory: (id: string, category: ClaimCategory, notes?: string) =>
    api.patch<Claim>(`/claims/${id}/category`, { assigned_category: category, notes }).then((r) => r.data),
  resolve: (id: string, resolution: ClaimResolutionType, notes?: string) =>
    api.post<Claim>(`/claims/${id}/resolve`, { resolution_type: resolution, notes }).then((r) => r.data),
  requestInfo: (id: string, notes?: string) =>
    api.post<Claim>(`/claims/${id}/request-info`, { notes }).then((r) => r.data),
  markInReview: (id: string) => api.post<Claim>(`/claims/${id}/review`).then((r) => r.data),
};
