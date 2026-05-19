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

export type TripStatus = "pendiente" | "en_transito" | "completado" | "cancelado";
export type TripKind = "inter_branch" | "last_mile";

export interface TripStop {
  branch_id: string;
  shipment_ids: string[];
  total_weight_kg: number;
  pickup_shipment_ids?: string[];
  pickup_weight_kg?: number;
  unloaded_at?: string;
  unloaded_by?: string;
  completed_at?: string;
  completed_by_user_id?: string;
}

export interface InterBranchTrip {
  id: string;
  kind: TripKind;
  driver_id?: string;
  vehicle_id: string;
  license_plate: string;
  origin_branch_id: string;
  destination_branch_id?: string; // último stop (null para last_mile)
  shipment_ids: string[];
  status: TripStatus;
  total_weight_kg: number;
  stops?: TripStop[];             // multi-hop (1..3 para inter-sucursal)
  current_stop_index?: number;    // 0..len(stops)
  created_by: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  finished_by_user_id?: string;
}

export interface TripQRResponse {
  trip_id: string;
  qr_code_base64: string;
}

export const interBranchTripsApi = {
  getMyTrip: () =>
    api.get<InterBranchTrip>("/driver/inter-branch-trip").then((r) => r.data),

  startTrip: (tripId: string) =>
    api.post<InterBranchTrip>(`/inter-branch-trips/${tripId}/start`).then((r) => r.data),

  getQR: (tripId: string) =>
    api.get<TripQRResponse>(`/inter-branch-trips/${tripId}/qr`).then((r) => r.data),

  finishByScan: (tripId: string) =>
    api
      .post<{ message: string; trip: InterBranchTrip }>(`/inter-branch-trips/${tripId}/scan/finish`)
      .then((r) => r.data),

  assignDriver: (tripId: string, driverId: string) =>
    api
      .post<InterBranchTrip>(`/inter-branch-trips/${tripId}/assign-driver`, { driver_id: driverId })
      .then((r) => r.data),

  cancel: (tripId: string) =>
    api
      .post<{ message: string; trip: InterBranchTrip }>(`/inter-branch-trips/${tripId}/cancel`)
      .then((r) => r.data),

  // Manager/admin pueden pasar branchId para filtrar; operator/supervisor lo ignoran.
  listByBranch: (branchId?: string) => {
    const url = branchId ? `/inter-branch-trips?branch_id=${branchId}` : "/inter-branch-trips";
    return api.get<InterBranchTrip[]>(url).then((r) => r.data);
  },

  // Operator: get trip by ID (for reception page)
  getById: (tripId: string) =>
    api.get<InterBranchTrip>(`/inter-branch-trips/${tripId}`).then((r) => r.data),

  // Operator: confirm unload at intermediate stop (step 1)
  confirmUnload: (tripId: string, stopIdx: number, body: { delivered: string[]; missing: string[] }) =>
    api.post<{ message: string; trip: InterBranchTrip }>(`/inter-branch-trips/${tripId}/stops/${stopIdx}/unload`, body).then((r) => r.data),

  // Operator: confirm load + close stop (step 2)
  confirmLoad: (tripId: string, stopIdx: number, body: { loaded: string[]; skipped: string[] }) =>
    api.post<{ message: string; trip: InterBranchTrip }>(`/inter-branch-trips/${tripId}/stops/${stopIdx}/load`, body).then((r) => r.data),

  // Driver: scan vehicle QR to claim the trip
  claimByVehicleQR: (qrToken: string) =>
    api.post<InterBranchTrip>("/trips/claim-by-qr", { qr_token: qrToken }).then((r) => r.data),

  // Operator/supervisor: scan vehicle QR when driver returns to close the trip
  closeByVehicleQR: (qrToken: string) =>
    api.post<{ message: string; trip: InterBranchTrip }>("/trips/close-by-qr", { qr_token: qrToken }).then((r) => r.data),
};
