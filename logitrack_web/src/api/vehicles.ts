import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type VehicleType = "motocicleta" | "furgoneta" | "camion" | "camion_grande";
export type VehicleStatus = "disponible" | "mantenimiento" | "en_transito" | "inactivo";

export interface Vehicle {
  id: string;
  license_plate: string;
  type: VehicleType;
  capacity_kg: number;
  status: VehicleStatus;
  assigned_shipment?: string | null;
  assigned_branch?: string | null;
}

export interface CreateVehicleRequest {
  license_plate: string;
  type: VehicleType;
  capacity_kg: number;
}

export interface VehicleStatusResponse {
  id: string;
  license_plate: string;
  type: VehicleType;
  capacity_kg: number;
  status: VehicleStatus;
  status_label: string;
  updated_at: string;
  updated_by?: string;
  assigned_shipment: string | null;
  assigned_branch?: string | null;
}

export interface UpdateVehicleStatusRequest {
  status: VehicleStatus;
  notes?: string;
  force?: boolean;
}

export interface UpdateVehicleStatusResponse extends VehicleStatusResponse {}

export interface AvailableVehiclesFilters {
  type?: VehicleType;
  min_capacity?: number;
}

export interface AssignVehicleRequest {
  tracking_id: string;
}

export interface AssignVehicleResponse extends VehicleStatusResponse {
  message: string;
}

export interface AssignBranchRequest {
  branch_id: string;
}

export const vehicleApi = {
  list: () => api.get<Vehicle[]>("/vehicles").then((r) => r.data),
  create: (data: CreateVehicleRequest) =>
    api.post<Vehicle>("/vehicles", data).then((r) => r.data),
  getByPlate: (plate: string) =>
    api.get<VehicleStatusResponse>(`/vehicles/by-plate/${plate}`).then((r) => r.data),
  updateStatus: (plate: string, data: UpdateVehicleStatusRequest) =>
    api.patch<UpdateVehicleStatusResponse>(`/vehicles/by-plate/${plate}/status`, data).then((r) => r.data),
  listAvailable: (filters?: AvailableVehiclesFilters) => {
    const params = new URLSearchParams();
    if (filters?.type) params.append("type", filters.type);
    if (filters?.min_capacity) params.append("min_capacity", filters.min_capacity.toString());
    return api.get<Vehicle[]>(`/vehicles/available?${params.toString()}`).then((r) => r.data);
  },
  assignToShipment: (plate: string, data: AssignVehicleRequest) =>
    api.post<AssignVehicleResponse>(`/vehicles/by-plate/${plate}/assign`, data).then((r) => r.data),
  assignBranch: (plate: string, data: AssignBranchRequest) =>
    api.post<AssignVehicleResponse>(`/vehicles/by-plate/${plate}/assign-branch`, data).then((r) => r.data),
  getByShipment: (trackingId: string) =>
    api.get<VehicleStatusResponse>(`/vehicles/by-shipment/${trackingId}`).then((r) => r.data),
};
