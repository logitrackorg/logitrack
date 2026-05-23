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

export interface EventLocation {
  type: 'ORIGIN_BRANCH' | 'DESTINATION_BRANCH' | 'IN_TRANSIT';
  branch_code: string;
  branch_name: string;
  status: string;
}

export interface PublicShipmentEvent {
  id: string;
  tracking_id: string;
  event_type?: string;
  from_status?: ShipmentStatus;
  to_status: ShipmentStatus;
  location?: string;
  notes?: string;
  timestamp: string;
  current_location?: EventLocation;
  rescheduled_date?: string;
  via?: string;
  claim_status?: ClaimStatus;
  claim_updated_at?: string;
}

export interface PublicStats {
  total_shipments: number;
  in_transit: number;
  active_branches: number;
}

export type ClaimStatus =
  | "open"
  | "in_review"
  | "pending_customer"
  | "derived"
  | "resolved_operativa"
  | "resolved_comercial"
  | "resolved_rrhh"
  | "resolved_improcedente";

export type ClaimType =
  | "damage"
  | "missing"
  | "delay"
  | "not_delivered"
  | "bad_treatment"
  | "wrong_data"
  | "other";

export interface PublicClaim {
  id: string;
  tracking_id: string;
  claim_type: ClaimType;
  status: ClaimStatus;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  assigned_category?: string;
  resolution_type?: string;
  is_automatic: boolean;
  evidence_file_name?: string;
  evidence_mime_type?: string;
  evidence_upload_date?: string;
}

export interface CreatePublicClaimPayload {
  tracking_id: string;
  claim_type: ClaimType;
  description: string;
  created_by: string;
  dni: string;
  damage_subtypes: string;
  evidence?: File | null;
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
  createClaim: (payload: CreatePublicClaimPayload) => {
    const formData = new FormData();
    formData.append("tracking_id", payload.tracking_id);
    formData.append("claim_type", payload.claim_type);
    formData.append("description", payload.description);
    formData.append("created_by", payload.created_by);
    formData.append("dni", payload.dni);
    formData.append("damage_subtypes", payload.damage_subtypes);
    if (payload.evidence) {
      formData.append("evidence", payload.evidence);
    }
    return api.post<PublicClaim>("/public/claims", formData).then((r) => r.data);
  },
  getClaim: (id: string) =>
    api.get<PublicClaim>(`/public/claims/${id}`).then((r) => r.data),
};
