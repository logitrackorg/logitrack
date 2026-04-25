import axios from "axios";
import type { User, Role } from "./auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface UserUpdatePayload {
  username?: string;
  role?: Role;
  branch_id?: string;
}

export interface UserCreatePayload {
  username: string;
  password: string;
  role: Role;
  branch_id?: string;
}

export const adminApi = {
  listUsers: () =>
    api.get<{ users: User[] }>("/admin/users").then((r) => r.data.users ?? []),
  createUser: (data: UserCreatePayload) =>
    api.post<User>("/admin/users", data).then((r) => r.data),
  updateUser: (id: string, data: UserUpdatePayload) =>
    api.patch<User>(`/admin/users/${id}`, data).then((r) => r.data),
};
