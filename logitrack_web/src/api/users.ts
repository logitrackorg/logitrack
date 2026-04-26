import axios from "axios";
import type { Role } from "./auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  email?: string;
  role: Role;
  branch_id?: string;
  branch_name?: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export const usersApi = {
  getMe: () => api.get<UserProfile>("/users/me").then((r) => r.data),
  listDrivers: (branchId?: string) => {
    const params = branchId ? { branch_id: branchId } : {};
    return api.get<{ drivers: UserProfile[] }>("/users/drivers", { params }).then((r) => r.data.drivers ?? []);
  },
  changePassword: (data: ChangePasswordRequest) => {
    return api.post<{ message: string }>("/users/me/password", data).then((r) => r.data);
  },
};
