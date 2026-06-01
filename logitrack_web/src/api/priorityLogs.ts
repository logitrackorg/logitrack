import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface PriorityLog {
  tracking_id: string;
  timestamp: string;       // ISO 8601
  priority_from: string;   // "baja" | "media" | "alta"
  priority_to: string;
  reason: string;
}

export interface PriorityLogsResponse {
  logs: PriorityLog[];
  total: number;
}

export const priorityLogsApi = {
  list: () =>
    api.get<PriorityLogsResponse>("/supervisor/priority-logs").then((r) => r.data),
};
