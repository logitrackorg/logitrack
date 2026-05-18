import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8080/api/v1";
const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface BranchEdge {
  from_branch_id: string;
  to_branch_id: string;
  distance_km: number;
  avg_transit_hours: number;
  observed_count: number;
  enabled: boolean;
  source: "auto" | "manual";
  updated_at: string;
}

export interface BranchGraph {
  edges: BranchEdge[];
}

export const branchGraphApi = {
  getGraph: () => api.get<BranchGraph>("/admin/branches/graph").then((r) => r.data),
  derive: () => api.post<{ edges_processed: number }>("/admin/branches/graph/derive").then((r) => r.data),
  create: (body: { from_branch_id: string; to_branch_id: string; distance_km: number; avg_transit_hours: number }) =>
    api.post("/admin/branches/graph", body).then((r) => r.data),
  setEnabled: (from: string, to: string, enabled: boolean) =>
    api.patch(`/admin/branches/graph/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, { enabled }).then((r) => r.data),
};
