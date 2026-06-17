import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const api = axios.create({ baseURL: BASE_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const adminResetApi = {
  /** Reset a single user's dashboard preferences. */
  resetUser: (userId: string) =>
    api.post("/admin/reset-dashboard", { user_id: userId }).then((r) => r.data),

  /** Reset all supervisor/manager dashboard preferences in one transaction. */
  resetAll: () =>
    api.post("/admin/reset-dashboard", { reset_all: true }).then((r) => r.data),
};
