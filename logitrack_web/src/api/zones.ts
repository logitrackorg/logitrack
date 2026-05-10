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

export interface ZonePoint {
  lat: number;
  lng: number;
}

export interface Zone {
  id: string;
  name: string;
  description: string;
  polygon: ZonePoint[];
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateZoneRequest {
  name: string;
  description?: string;
  polygon: ZonePoint[];
}

export interface UpdateZoneRequest {
  name?: string;
  description?: string;
  polygon?: ZonePoint[];
  active?: boolean;
}

export const zoneApi = {
  list: (includeInactive = false) =>
    api
      .get<{ zones: Zone[] }>("/zones", { params: { include_inactive: includeInactive } })
      .then((r) => r.data.zones ?? []),

  create: (req: CreateZoneRequest) =>
    api.post<{ zone: Zone }>("/zones", req).then((r) => r.data.zone),

  update: (id: string, req: UpdateZoneRequest) =>
    api.patch<{ zone: Zone }>(`/zones/${id}`, req).then((r) => r.data.zone),

  remove: (id: string) =>
    api.delete(`/zones/${id}`).then((r) => r.data),
};

// Color único para todas las zonas peligrosas
export const ZONE_COLOR = {
  fill: "rgba(239,68,68,0.25)",
  stroke: "#ef4444",
  badge: "bg-red-100 text-red-800",
};
