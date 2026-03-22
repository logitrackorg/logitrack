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

export type ShipmentStatus = "pending" | "in_progress" | "in_transit" | "at_branch" | "delivering" | "delivery_failed" | "delivered" | "ready_for_pickup" | "ready_for_return" | "returned";
export type PackageType = "envelope" | "box" | "pallet" | "fragile";

export interface Address {
  street?: string;
  city: string;
  province: string;
  postal_code?: string;
}

export interface Shipment {
  tracking_id: string;
  sender_name: string;
  sender_phone: string;
  sender_email?: string;
  sender_dni?: string;
  origin: Address;
  recipient_name: string;
  recipient_phone: string;
  recipient_email?: string;
  recipient_dni?: string;
  destination: Address;
  weight_kg: number;
  package_type: PackageType;
  special_instructions?: string;
  receiving_branch_id?: string;
  current_location?: string;
  status: ShipmentStatus;
  created_at: string;
  estimated_delivery_at: string;
  delivered_at?: string;
  corrections?: Record<string, string>;
}

export interface ShipmentEvent {
  id: string;
  tracking_id: string;
  from_status: ShipmentStatus | "";
  to_status: ShipmentStatus;
  changed_by: string;
  location?: string;
  notes?: string;
  timestamp: string;
}

export interface Stats {
  total: number;
  by_status: Record<ShipmentStatus, number>;
}

export interface CreateShipmentPayload {
  sender_name: string;
  sender_phone: string;
  sender_email?: string;
  sender_dni: string;
  origin: Address;
  recipient_name: string;
  recipient_phone: string;
  recipient_email?: string;
  recipient_dni: string;
  destination: Address;
  weight_kg: number;
  package_type: PackageType;
  special_instructions?: string;
  receiving_branch_id: string;
  created_by?: string;
}

// SaveDraftPayload — all fields optional, allows partial data
export interface SaveDraftPayload {
  sender_name?: string;
  sender_phone?: string;
  sender_email?: string;
  sender_dni?: string;
  origin?: Partial<Address>;
  recipient_name?: string;
  recipient_phone?: string;
  recipient_email?: string;
  recipient_dni?: string;
  destination?: Partial<Address>;
  weight_kg?: number;
  package_type?: PackageType;
  special_instructions?: string;
  receiving_branch_id?: string;
  created_by?: string;
}

export interface ShipmentComment {
  id: string;
  tracking_id: string;
  author: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateStatusPayload {
  status: ShipmentStatus;
  changed_by?: string;
  location: string;
  notes?: string;
  driver_id?: string;
  recipient_dni?: string;
  sender_dni?: string;
}

export const shipmentApi = {
  list: (params?: { date_from?: string; date_to?: string }) =>
    api.get<Shipment[]>("/shipments", { params }).then((r) => r.data),
  get: (trackingId: string) =>
    api.get<Shipment>(`/shipments/${trackingId}`).then((r) => r.data),
  create: (payload: CreateShipmentPayload) =>
    api.post<Shipment>("/shipments", payload).then((r) => r.data),
  saveDraft: (payload: SaveDraftPayload) =>
    api.post<Shipment>("/shipments/draft", payload).then((r) => r.data),
  updateDraft: (trackingId: string, payload: SaveDraftPayload) =>
    api.patch<Shipment>(`/shipments/${trackingId}/draft`, payload).then((r) => r.data),
  confirmDraft: (trackingId: string, changedBy: string) =>
    api.post<Shipment>(`/shipments/${trackingId}/confirm`, { changed_by: changedBy }).then((r) => r.data),
  search: (q: string) =>
    api.get<Shipment[]>("/search", { params: { q } }).then((r) => r.data),
  updateStatus: (trackingId: string, payload: UpdateStatusPayload) =>
    api
      .patch<Shipment>(`/shipments/${trackingId}/status`, payload)
      .then((r) => r.data),
  getEvents: (trackingId: string) =>
    api
      .get<ShipmentEvent[]>(`/shipments/${trackingId}/events`)
      .then((r) => r.data),
  getComments: (trackingId: string) =>
    api.get<ShipmentComment[]>(`/shipments/${trackingId}/comments`).then((r) => r.data),
  addComment: (trackingId: string, body: string) =>
    api.post<ShipmentComment>(`/shipments/${trackingId}/comments`, { body }).then((r) => r.data),
  correctShipment: (trackingId: string, corrections: Record<string, string>) =>
    api.patch<Shipment>(`/shipments/${trackingId}/correct`, { corrections }).then((r) => r.data),
  stats: () => api.get<Stats>("/stats").then((r) => r.data),
};
