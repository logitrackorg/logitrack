import axios from "axios";
import type { DashboardMetricPref, SavePrefItem } from "./dashboardPrefs";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const api = axios.create({ baseURL: BASE_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface DashboardProfile {
  id: string;
  user_id: string;
  name: string;
  preferences: DashboardMetricPref[];
  created_at: string;
}

export const dashboardProfilesApi = {
  list: () =>
    api.get<DashboardProfile[]>("/profiles").then((r) => r.data),

  create: (name: string, preferences: SavePrefItem[]) =>
    api.post<DashboardProfile>("/profiles", { name, preferences }).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/profiles/${id}`).then((r) => r.data),
};
