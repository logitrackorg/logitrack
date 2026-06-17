import { api } from "./auth";

export type AccessEventType =
  | "login_success"
  | "login_failure"
  | "logout"
  | "2fa_required"
  | "password_reset_requested"
  | "password_reset_confirmed";

export interface AccessLog {
  id: string;
  username: string;
  user_id: string;
  role: string;
  event_type: AccessEventType;
  ip_address: string;
  country: string;
  city: string;
  result: string;
  failure_reason?: string;
  timestamp: string;
}

export interface AccessLogFilters {
  username?: string;
  date_from?: string;
  date_to?: string;
}

export const accessLogApi = {
  list: (limit: number, filters?: AccessLogFilters) =>
    api
      .get<AccessLog[]>("/admin/access-logs", {
        params: { limit, ...filters },
      })
      .then((r) => r.data),
};