import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type EOMCategory =
  | "last_mile_driver"
  | "inter_branch_driver"
  | "operator";

export interface EOMWinner {
  id: string;
  period: string; // ISO date string — first day of month
  category: EOMCategory;
  branch_id: string; // "" for inter_branch_driver (network-wide)
  has_winner: boolean;
  user_id?: string;
  score?: number;
  activity_count?: number;
  computed_at: string;
}

export interface EOMResponse {
  winners: EOMWinner[];
  period: string; // "YYYY-MM"
}

export const categoryLabel = (cat: EOMCategory): string => {
  switch (cat) {
    case "last_mile_driver":
      return "Mejor chofer de última milla";
    case "inter_branch_driver":
      return "Mejor chofer inter-sucursal";
    case "operator":
      return "Mejor operador";
  }
};

export const eomApi = {
  getWinners: (period?: string, branchId?: string) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (branchId) params.set("branch_id", branchId);
    const qs = params.toString();
    return api
      .get<EOMResponse>(`/employee-of-month${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },
  runManual: (period?: string) => {
    const qs = period ? `?period=${period}` : "";
    return api.post(`/admin/employee-of-month/run${qs}`).then((r) => r.data);
  },
};
