import axios from "axios";
import type { Shipment, ShipmentEvent } from "./shipments";
import type { Branch } from "./branches";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

export const publicTrackingApi = {
  getShipment: (trackingId: string) =>
    api.get<Shipment>(`/public/track/${trackingId}`).then((r) => r.data),
  getEvents: (trackingId: string) =>
    api.get<ShipmentEvent[]>(`/public/track/${trackingId}/events`).then((r) => r.data),
  getBranches: () =>
    api.get<Branch[]>("/public/branches").then((r) => r.data),
};
