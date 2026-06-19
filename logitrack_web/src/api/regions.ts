import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type RegionType = "predefined" | "custom";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Region {
  id: string;
  name: string;
  type: RegionType;
  coordinates: LatLng[];
}

export const regionsApi = {
  list: (): Promise<Region[]> =>
    api.get<Region[]>("/regions").then((r) => r.data),

  create: (payload: { name: string; coordinates: LatLng[] }): Promise<Region> =>
    api.post<Region>("/regions", payload).then((r) => r.data),

  /** Renombra y/o re-dibuja una zona personalizada. Solo aplica a zonas
   *  propias (type "custom"); las predefinidas devuelven 404. */
  update: (id: string, payload: { name: string; coordinates: LatLng[] }): Promise<Region> =>
    api.put<Region>(`/regions/${id}`, payload).then((r) => r.data),
};
