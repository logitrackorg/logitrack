import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

export type Role = "operator" | "supervisor" | "manager" | "admin" | "driver";
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
  role: Role;
  branch_id?: string;
  status: UserStatus;
  address?: UserAddress;
  updated_by?: string;
  updated_at?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { username, password }).then((r) => r.data),
  logout: (token: string) =>
    api.post("/auth/logout", {}, { headers: { Authorization: `Bearer ${token}` } }),
};
