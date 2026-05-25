import axios from "axios";
import type { CheckinRecord } from "./supervisorFatigue";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type DataAccessRequestStatus = "pending" | "accepted" | "rejected";

export interface DataAccessRequest {
  id: string;
  driver_id: string;
  driver_name: string;
  branch_id: string;
  status: DataAccessRequestStatus;
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  checkin_data?: CheckinRecord;
}

export const dataAccessRequestsApi = {
  /** Chofer: crea una nueva solicitud de acceso a sus datos */
  create: () =>
    api.post<{ message: string; request: DataAccessRequest }>("/users/me/data-request").then((r) => r.data),

  /** Chofer: ve su historial de solicitudes */
  listMine: () =>
    api.get<{ requests: DataAccessRequest[] }>("/users/me/data-requests").then((r) => r.data.requests),

  /** Supervisor: ve todas las solicitudes de su sucursal */
  listPending: () =>
    api.get<{ requests: DataAccessRequest[] }>("/supervisor/data-requests").then((r) => r.data.requests),

  /** Supervisor: aprueba una solicitud */
  accept: (id: string) =>
    api.patch<{ ok: boolean }>(`/supervisor/data-requests/${id}/accept`).then((r) => r.data),

  /** Supervisor: rechaza una solicitud */
  reject: (id: string) =>
    api.patch<{ ok: boolean }>(`/supervisor/data-requests/${id}/reject`).then((r) => r.data),
};
