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
  },
);

export type ReportFrequency = "daily" | "weekly" | "monthly";

export type ReportMetric =
  | "resumen"
  | "tipo_envio"
  | "metodo_entrega"
  | "volumen_ventana"
  | "tasa_exito"
  | "choferes"
  | "facturacion"
  | "ranking"
  | "retorno";

export interface AutoReportSchedule {
  id: string;
  owner_user_id: string;
  name: string;
  frequency: ReportFrequency;
  time_of_day: string;
  day_of_week?: number;
  day_of_month?: number;
  metrics: ReportMetric[];
  branch_id: string;
  email: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
}

export interface GeneratedReport {
  id: string;
  schedule_id: string;
  schedule_name: string;
  frequency: ReportFrequency;
  period_from: string;
  period_to: string;
  branch_id: string;
  email: string;
  generated_at: string;
  has_data: boolean;
  snapshot: Record<string, unknown>;
}

export interface CreateAutoReportScheduleInput {
  name: string;
  frequency: ReportFrequency;
  time_of_day: string;
  day_of_week?: number;
  day_of_month?: number;
  metrics: ReportMetric[];
  branch_id: string;
  email: string;
  active: boolean;
}

export type UpdateAutoReportScheduleInput = Partial<CreateAutoReportScheduleInput>;

export const autoReportsApi = {
  listSchedules: () =>
    api.get<{ schedules: AutoReportSchedule[] }>("/auto-reports/schedules").then((r) => r.data.schedules),
  createSchedule: (input: CreateAutoReportScheduleInput) =>
    api.post<AutoReportSchedule>("/auto-reports/schedules", input).then((r) => r.data),
  updateSchedule: (id: string, input: UpdateAutoReportScheduleInput) =>
    api.patch<AutoReportSchedule>(`/auto-reports/schedules/${id}`, input).then((r) => r.data),
  deleteSchedule: (id: string) => api.delete(`/auto-reports/schedules/${id}`).then(() => undefined),
  runNow: (id: string) =>
    api.post<GeneratedReport>(`/auto-reports/schedules/${id}/run`).then((r) => r.data),
  listGenerated: (limit = 100) =>
    api.get<{ reports: GeneratedReport[] }>("/auto-reports/generated", { params: { limit } }).then(
      (r) => r.data.reports,
    ),
  getGenerated: (id: string) =>
    api.get<GeneratedReport>(`/auto-reports/generated/${id}`).then((r) => r.data),
  downloadCsvUrl: (id: string) => {
    const base = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";
    return `${base}/auto-reports/generated/${id}/csv`;
  },
};
