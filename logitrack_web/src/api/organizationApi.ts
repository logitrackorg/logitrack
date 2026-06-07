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
  track_url: string;
  primary_color?: string;
  accent_color?: string;
  sidebar_color?: string;
  logo_url?: string;
  updated_at?: string;
  updated_by?: string;
}

/** Branding-only view served by the public endpoint (no auth required). */
export interface OrganizationBranding {
  name?: string;
  primary_color?: string;
  accent_color?: string;
  sidebar_color?: string;
  logo_url?: string;
}

// Cliente público sin interceptor de auth: se usa para aplicar el tema antes
// del login y en el primer render.
const publicClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

export const organizationApi = {
  get: () => api.get<OrganizationConfig>("/organization").then((r) => r.data),
  getPublic: () =>
    publicClient.get<OrganizationBranding>("/public/organization").then((r) => r.data),
  update: (data: Omit<OrganizationConfig, "id" | "updated_at" | "updated_by">) =>
    api.put<OrganizationConfig>("/organization", data).then((r) => r.data),
};
