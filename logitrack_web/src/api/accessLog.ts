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

export type AccessEventType = "login_success" | "login_failure" | "logout";

export interface AccessLog {
  id: string;
  username: string;
  user_id?: string;
  event_type: AccessEventType;
  timestamp: string;
}

export const accessLogApi = {
  list: (limit = 500): Promise<AccessLog[]> =>
    api.get<{ logs: AccessLog[] }>(`/admin/access-logs?limit=${limit}`).then((r) => r.data.logs ?? []),
};
