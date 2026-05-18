// API client para las métricas de observabilidad del ruteo (Phase 0).
// Todos los endpoints son admin-only.

import axios from "axios";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8080/api/v1";

const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface PlanMetric {
  id: string;
  branch_id: string;
  generated_at: string;
  generation_time_ms: number;
  last_mile_count: number;
  inter_branch_count: number;
  unassigned_count: number;
  vrp_used: boolean;
  window_coverage_pct?: number;
  created_at: string;
}

export interface ApplyMetric {
  id: string;
  branch_id: string;
  applied_at: string;
  applied_by: string;
  applied_count: number;
  failed_count: number;
  drift_count: number;
  manual_override_count: number;
  created_at: string;
}

export interface ShipmentHopMetric {
  id: string;
  tracking_id: string;
  from_branch_id: string;
  to_branch_id: string;
  departed_at: string;
  arrived_at?: string;
  transit_hours?: number;
  created_at: string;
}

export interface ODPairVolume {
  id: string;
  origin_branch_id: string;
  destination_branch_id: string;
  date: string;
  shipment_count: number;
  total_weight_kg: number;
  updated_at: string;
}

export interface RoutingMetricsSummary {
  date: string;
  branch_id: string;
  avg_gen_time_ms: number;
  avg_unassigned_pct: number;
  avg_window_coverage_pct: number;
  total_applied: number;
  total_failed: number;
  total_drift: number;
  avg_override_count: number;
  plan_count: number;
}

interface Envelope<T> {
  data: T[];
  from: string;
  to: string;
}

interface RangeOpts {
  branchId?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
}

function qs(opts?: RangeOpts & { origin?: string; destination?: string }): string {
  if (!opts) return "";
  const p = new URLSearchParams();
  if (opts.branchId) p.set("branch_id", opts.branchId);
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  if (opts.origin) p.set("origin", opts.origin);
  if (opts.destination) p.set("destination", opts.destination);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const routingMetricsApi = {
  listPlans: (opts?: RangeOpts) =>
    api.get<Envelope<PlanMetric>>(`/admin/routing/metrics/plan${qs(opts)}`).then((r) => r.data),
  listApplies: (opts?: RangeOpts) =>
    api.get<Envelope<ApplyMetric>>(`/admin/routing/metrics/apply${qs(opts)}`).then((r) => r.data),
  listHops: (opts?: RangeOpts) =>
    api.get<Envelope<ShipmentHopMetric>>(`/admin/routing/metrics/hops${qs(opts)}`).then((r) => r.data),
  listODVolume: (opts?: { origin?: string; destination?: string; from?: string; to?: string }) =>
    api.get<Envelope<ODPairVolume>>(`/admin/routing/metrics/od-volume${qs(opts)}`).then((r) => r.data),
  getSummary: (opts?: RangeOpts) =>
    api.get<Envelope<RoutingMetricsSummary>>(`/admin/routing/metrics/summary${qs(opts)}`).then((r) => r.data),
};
