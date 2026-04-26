import axios from "axios";
import type { User } from "./auth";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export const usersApi = {
  listDrivers: (branchId?: string) => {
    const params = branchId ? { branch_id: branchId } : {};
    return api.get<{ drivers: User[] }>("/users/drivers", { params }).then((r) => r.data.drivers ?? []);
  },
  changePassword: (data: ChangePasswordRequest) => {
    return api.post<{ message: string }>("/users/me/password", data).then((r) => r.data);
  },
};
