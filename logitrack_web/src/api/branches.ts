import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface Branch {
  id: string;
  name: string;
  address: { street: string; city: string; province: string; postal_code: string };
  province: string;
  status: "activo" | "inactivo" | "fuera_de_servicio";
  created_at: string;
  updated_at: string;
  updated_by?: string;
}

export interface CreateBranchPayload {
  name: string;
  street: string;
  city: string;
  province: string;
  postal_code: string;
}

export interface UpdateBranchPayload {
  name: string;
  street: string;
  city: string;
  province: string;
  postal_code: string;
}

export const branchApi = {
  list: (status?: string) => {
    const url = status ? `/branches?status=${status}` : "/branches";
    return api.get<Branch[]>(url).then((r) => r.data);
  },
  listActive: () => api.get<Branch[]>("/branches?status=activo").then((r) => r.data),
  search: (q: string) => api.get<Branch[]>(`/branches/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
  create: (data: CreateBranchPayload) => api.post<Branch>("/branches", data).then((r) => r.data),
  update: (id: string, data: UpdateBranchPayload) => api.patch<Branch>(`/branches/${id}`, data).then((r) => r.data),
  updateStatus: (id: string, status: string) => api.patch<Branch>(`/branches/${id}/status`, { status }).then((r) => r.data),
};

// branchLabel looks up a branch by city string (used for event locations).
export const branchLabel = (city: string, branches: Branch[]): string => {
  const branch = branches.find((b) => b.address.city === city);
  return branch ? branch.name : city;
};

// branchLabelById looks up a branch by its ID (used for shipment.current_location).
export const branchLabelById = (id: string, branches: Branch[]): string => {
  const branch = branches.find((b) => b.id === id);
  return branch ? branch.name : id;
};

export const statusLabel = (status: Branch["status"]): string => {
  switch (status) {
    case "activo": return "Active";
    case "inactivo": return "Inactive";
    case "fuera_de_servicio": return "Out of Service";
    default: return status;
  }
};

export const statusColor = (status: Branch["status"]): string => {
  switch (status) {
    case "activo": return "#16a34a";
    case "inactivo": return "#ca8a04";
    case "fuera_de_servicio": return "#dc2626";
    default: return "#6b7280";
  }
};
