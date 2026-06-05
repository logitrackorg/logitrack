import axios from "axios";
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1",
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expirado o inválido
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export type Role = "operator" | "supervisor" | "manager" | "admin" | "driver";
export type DriverType = "ultima_milla" | "intersucursal";
export type UserStatus = "activo" | "inactivo";

export interface UserAddress {
  street?: string;
  city: string;
  province: string;
  postal_code?: string;
}

export interface User {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role: Role;
  branch_id?: string;
  status: UserStatus;
  address?: UserAddress;
  updated_by?: string;
  updated_at?: string;
  driver_type?: DriverType;
  two_fa_enabled?: boolean;
  two_fa_enrolled_at?: string;
}

export interface LoginResponse {
  token?: string;
  user?: User;
  requires_2fa: boolean;
  session_token?: string;
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { username, password }).then((r) => r.data),
  logout: (token: string) =>
    api.post("/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } }),
};