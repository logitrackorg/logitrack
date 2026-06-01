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
  // Enriched fields (cruzados con el envío en el backend)
  sender_name: string;
  receiver_name: string;
  origin_city: string;
  current_branch: string;     // nombre de sucursal (display)
  current_branch_id: string;  // id de sucursal (para filtrar)
}

export interface PriorityLogsResponse {
  logs: PriorityLog[];
  total: number;
}

export const priorityLogsApi = {
  list: () =>
    api.get<PriorityLogsResponse>("/supervisor/priority-logs").then((r) => r.data),
};
