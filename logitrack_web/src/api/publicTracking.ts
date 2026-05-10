import axios from "axios";
import type {
  ShipmentStatus,
  ShipmentType,
  TimeWindow,
  DeliveryMethod,
  IncidentType,
} from "./shipments";
import type { Branch } from "./branches";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

// Public-safe view of a shipment served by /public/track/:id. Carries no
// personal data — names, DNI, phone, email and full address are stripped
// server-side. Origin/destination expose only city + province.
export interface PublicLocation {
  city: string;
  province: string;
}

export interface PublicShipment {
  tracking_id: string;
  status: ShipmentStatus;
  created_at: string;
  updated_at: string;
  estimated_delivery_at: string | null;
  delivered_at?: string;
  origin: PublicLocation;
  destination: PublicLocation;
  current_location?: string;
  final_branch_id?: string;
  shipment_type?: ShipmentType;
  time_window?: TimeWindow;
  delivery_method?: DeliveryMethod;
  is_fragile?: boolean;
  is_returning?: boolean;
  delivery_attempts?: number;
  has_incident?: boolean;
  incident_type?: IncidentType;
}

export interface PublicShipmentEvent {
  id: string;
  tracking_id: string;
  from_status?: ShipmentStatus;
  to_status: ShipmentStatus;
  location?: string;
  timestamp: string;
}

export interface PublicStats {
  total_shipments: number;
  in_transit: number;
  active_branches: number;
}

export const publicTrackingApi = {
  getShipment: (trackingId: string) =>
    api.get<PublicShipment>(`/public/track/${trackingId}`).then((r) => r.data),
  getEvents: (trackingId: string) =>
    api.get<PublicShipmentEvent[]>(`/public/track/${trackingId}/events`).then((r) => r.data),
  getBranches: () =>
    api.get<Branch[]>("/public/branches").then((r) => r.data),
  getStats: () =>
    api.get<PublicStats>("/public/stats").then((r) => r.data),
};
