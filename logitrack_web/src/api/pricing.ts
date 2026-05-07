import axios from "axios";
import type { Address, PackageType, PriceBreakdown, ShipmentType, TimeWindow } from "./shipments";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface QuoteRequest {
  weight_kg: number;
  package_type: PackageType;
  shipment_type?: ShipmentType;
  time_window?: TimeWindow;
  is_fragile?: boolean;
  delivery_method?: string;
  origin: Address;
  destination: Address;
}

export interface QuoteResponse {
  total: number;
  currency: string;
  breakdown: PriceBreakdown;
}

export interface PricingConfig {
  base_fare: number;
  cost_per_km: number;
  weight_surcharge_mid: number;
  weight_surcharge_high: number;
  last_mile_surcharge: number;
  shipment_express_multiplier: number;
  time_window_restrictive_multiplier: number;
  fragile_multiplier: number;
}

export const pricingApi = {
  quote: (req: QuoteRequest) =>
    api.post<QuoteResponse>("/pricing/quote", req).then((r) => r.data),
  getConfig: () =>
    api.get<PricingConfig>("/pricing/config").then((r) => r.data),
  updateConfig: (cfg: PricingConfig) =>
    api.patch<PricingConfig>("/pricing/config", cfg).then((r) => r.data),
};

export function formatCurrencyARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
