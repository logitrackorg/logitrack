import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface OrganizationConfig {
  id?: number;
  name: string;
  cuit: string;
  address: string;
  phone: string;
  email: string;
  updated_at?: string;
  updated_by?: string;
}

export const organizationApi = {
  get: () => api.get<OrganizationConfig>("/organization").then((r) => r.data),
  update: (data: Omit<OrganizationConfig, "id" | "updated_at" | "updated_by">) =>
    api.put<OrganizationConfig>("/organization", data).then((r) => r.data),
};
