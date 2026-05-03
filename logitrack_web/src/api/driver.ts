import axios from "axios";
import type { Shipment } from "./shipments";

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

export interface DriverRoute {
  id: string;
  date: string;
  driver_id: string;
  shipment_ids: string[];
  created_by: string;
  created_at: string;
  status: "pendiente" | "en_curso" | "finalizada";
  started_at?: string;
}

export interface DriverRouteResponse {
  route: DriverRoute;
  shipments: Shipment[];
}

export const driverApi = {
  getRoute: () => api.get<DriverRouteResponse>("/driver/route").then((r) => r.data),
  startRoute: () => api.post<{ route: DriverRoute }>("/driver/route/start").then((r) => r.data),
};
