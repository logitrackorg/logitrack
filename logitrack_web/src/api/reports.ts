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

export interface DriverPerformanceItem {
  driver_id: string;
  driver_name: string;
  branch_id: string;
  branch_name: string;
  total_assigned: number;
  delivered: number;
  delivery_failed: number;
  success_rate: number | null;
  avg_delivery_hours: number | null;
}

export interface DriverPerformanceResponse {
  drivers: DriverPerformanceItem[];
}

export interface IncidentsByBranchItem {
  branch_id: string;
  branch_name: string;
  total: number;
  by_type: Record<string, number>;
}

export interface IncidentsByBranchResponse {
  branches: IncidentsByBranchItem[];
  total: number;
  grand_total_by_type: Record<string, number>;
}

export interface BranchBilling {
  revenue: number;
  count: number;
  avg_ticket: number;
}

export interface BillingMetricsResponse {
  total_revenue: number;
  avg_ticket: number | null;
  currency: string;
  count: number;
  by_branch: Record<string, BranchBilling>;
  by_period: Record<string, number>;
}

export interface BranchRankingItem {
  rank: number;
  branch_id: string;
  branch_name: string;
  volume_confirmed: number;
  delivered: number;
  success_rate: number | null;
  composite_score: number;
}

export interface BranchRankingResponse {
  ranking: BranchRankingItem[];
  period: {
    date_from: string | null;
    date_to: string | null;
  };
}

export interface TimeWindowBucket {
  time_window: string;
  count: number;
}

export interface VolumeByTimeWindowResponse {
  total: number;
  buckets: TimeWindowBucket[];
}

export interface ReturnBranchMetrics {
  returned: number;
  ready_for_return: number;
  total: number;
}

export interface ReturnMetricsResponse {
  total_returned: number;
  total_ready_for_return: number;
  total_return_eligible: number;
  return_rate: number | null;
  by_branch: Record<string, ReturnBranchMetrics>;
  by_day: Record<string, number>;
}

export interface SuccessRateByBranchItem {
  branch_id: string;
  branch_name: string;
  total: number;
  delivered: number;
  failed: number;
  success_rate: number;
}

export interface SuccessRateByBranchResponse {
  branches: SuccessRateByBranchItem[];
}

export interface ReportsQueryParams {
  date_from?: string;
  date_to?: string;
  branch_id?: string;
}

export const reportsApi = {
  driverPerformance: (params?: ReportsQueryParams) =>
    api.get<DriverPerformanceResponse>("/stats/driver-performance", { params }).then((r) => r.data),
  incidentsByBranch: (params?: ReportsQueryParams) =>
    api.get<IncidentsByBranchResponse>("/stats/incidents-by-branch", { params }).then((r) => r.data),
  billingMetrics: (params?: ReportsQueryParams) =>
    api.get<BillingMetricsResponse>("/stats/billing-metrics", { params }).then((r) => r.data),
  branchRanking: (params?: ReportsQueryParams) =>
    api.get<BranchRankingResponse>("/stats/branch-ranking", { params }).then((r) => r.data),
  volumeByTimeWindow: (params?: ReportsQueryParams) =>
    api.get<VolumeByTimeWindowResponse>("/stats/volume-by-time-window", { params }).then((r) => r.data),
  returnMetrics: (params?: ReportsQueryParams) =>
    api.get<ReturnMetricsResponse>("/stats/return-metrics", { params }).then((r) => r.data),
  successRateByBranch: (params?: ReportsQueryParams) =>
    api.get<SuccessRateByBranchResponse>("/stats/success-rate-by-branch", { params }).then((r) => r.data),
};
