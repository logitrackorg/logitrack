import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

export type Role = "operator" | "supervisor" | "manager" | "admin" | "driver";

export interface User {
  id: string;
  username: string;
  role: Role;
  branch_id?: string;
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
