import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  resource_id?: string;
  read_at?: string;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  limit: number;
  offset: number;
}

/** Retorna el offset en ms entre el reloj del servidor y el reloj real.
 *  Si el admin no activó ningún override, devuelve 0. */
export async function fetchServerClockOffsetMs(): Promise<number> {
  try {
    const r = await api.get<{ offset_ms: number }>("/admin/clock");
    return r.data.offset_ms ?? 0;
  } catch {
    return 0;
  }
}

export const notificationApi = {
  list: (params?: {
    search?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }) =>
    api
      .get<NotificationsResponse>("/notifications", { params })
      .then((r) => r.data),

  unreadCount: () =>
    api.get<{ count: number }>("/notifications/unread-count").then((r) => r.data),

  markRead: (id: string) =>
    api.patch(`/notifications/${id}/read`).then((r) => r.data),

  markAllRead: () =>
    api.patch("/notifications/read-all").then((r) => r.data),
};
