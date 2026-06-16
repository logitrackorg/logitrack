import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const api = axios.create({ baseURL: BASE_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface DashboardMetricPref {
  metric_id: string;
  metric_label: string;
  sort_order: number;
  is_hidden: boolean;
}

export interface SavePrefItem {
  metric_id: string;
  sort_order: number;
  is_hidden: boolean;
}

export const dashboardPrefsApi = {
  getPreferences: () =>
    api.get<DashboardMetricPref[]>("/preferences/dashboard").then((r) => r.data),

  savePreferences: (preferences: SavePrefItem[]) =>
    api.put("/preferences/dashboard", { preferences }).then((r) => r.data),

  getResetStatus: () =>
    api
      .get<{ was_reset_by_admin: boolean }>("/preferences/dashboard/reset-status")
      .then((r) => r.data),

  clearResetFlag: () =>
    api.patch("/preferences/dashboard/clear-reset").then((r) => r.data),
};
