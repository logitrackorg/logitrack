import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const api = axios.create({ baseURL: BASE_URL });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface KnownMetric {
  id: string;
  label: string;
}

export interface MetricPermissionsMatrix {
  metrics: KnownMetric[];
  roles: string[];
  /** matrix[role][metric_id] = is_visible */
  matrix: Record<string, Record<string, boolean>>;
}

export interface PermissionChange {
  role_name: string;
  metric_id: string;
  is_visible: boolean;
}

export interface PermissionAuditLog {
  id: string;
  created_at: string;
  admin_user_id: string;
  admin_username: string;
  batch_id: string;
  affected_role: string;
  metric_id: string;
  metric_name: string;
  action: string;
  previous_state: boolean;
  new_state: boolean;
}

export const metricPermissionsApi = {
  /** Admin: full roles × metrics matrix. */
  getMatrix: () =>
    api.get<MetricPermissionsMatrix>("/admin/metric-permissions").then((r) => r.data),

  /** Admin: update one role+metric visibility flag (no audit log). */
  setPermission: (roleName: string, metricId: string, isVisible: boolean) =>
    api
      .patch("/admin/metric-permissions", {
        role_name: roleName,
        metric_id: metricId,
        is_visible: isVisible,
      })
      .then((r) => r.data),

  /** Admin: batch update — all changes in one transaction with audit trail. */
  setBatchPermissions: (changes: PermissionChange[]) =>
    api
      .post("/admin/metric-permissions/batch", { changes })
      .then((r) => r.data),

  /** Admin: audit log for permission changes. All params optional. */
  getAuditLogs: (params?: { role?: string; start_date?: string; end_date?: string }) =>
    api
      .get<PermissionAuditLog[]>("/admin/metric-permissions/audit-logs", { params })
      .then((r) => r.data),

  /** Admin: all user-level overrides as { overrides: { user_id: { metric_id: bool } } }. */
  getUserOverrides: () =>
    api
      .get<{ overrides: Record<string, Record<string, boolean>> }>("/admin/user-metric-permissions")
      .then((r) => r.data.overrides),

  /** Admin: create or update a user-level permission override. */
  setUserOverride: (userId: string, metricId: string, isVisible: boolean) =>
    api
      .patch("/admin/user-metric-permissions", {
        user_id: userId,
        metric_id: metricId,
        is_visible: isVisible,
      })
      .then((r) => r.data),

  /** Admin: delete a user-level override (reverts to role default). */
  deleteUserOverride: (userId: string, metricId: string) =>
    api
      .delete("/admin/user-metric-permissions", { params: { user_id: userId, metric_id: metricId } })
      .then((r) => r.data),

  /** Any authenticated user: their own role's metric visibility map. */
  getMyPermissions: () =>
    api.get<Record<string, boolean>>("/metric-permissions/me").then((r) => r.data),
};

/** Base URL used to construct the SSE EventSource URL (includes /api/v1). */
export const METRIC_PERMISSIONS_SSE_URL = `${BASE_URL}/events/permissions`;
