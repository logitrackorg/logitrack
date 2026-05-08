import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const client = axios.create({ baseURL: API_BASE });
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ClockState {
  system_now: string;
  real_now: string;
  offset_ms: number;
  is_active: boolean;
}

export const clockApi = {
  get: (): Promise<ClockState> =>
    client.get<ClockState>("/admin/clock").then((r) => r.data),

  setOverride: (overrideAt: string): Promise<ClockState> =>
    client
      .patch<ClockState>("/admin/clock", { override_at: overrideAt })
      .then((r) => r.data),

  clear: (): Promise<ClockState> =>
    client.delete<ClockState>("/admin/clock").then((r) => r.data),
};
