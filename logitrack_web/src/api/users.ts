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
  driver_type?: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

// El endpoint /users/drivers devuelve model.User (first_name + last_name por separado),
// no UserProfile (full_name combinado). Acá normalizamos al shape esperado.
interface RawDriverUser {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role: Role;
  branch_id?: string;
  driver_type?: string;
}

function toUserProfile(u: RawDriverUser): UserProfile {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return {
    id: u.id,
    username: u.username,
    full_name: full || u.username,
    email: u.email,
    role: u.role,
    branch_id: u.branch_id,
    driver_type: u.driver_type,
  };
}

export const usersApi = {
  getMe: () => api.get<UserProfile>("/users/me").then((r) => r.data),
  listDrivers: (branchId?: string) => {
    const params = branchId ? { branch_id: branchId } : {};
    return api
      .get<{ drivers: RawDriverUser[] }>("/users/drivers", { params })
      .then((r) => (r.data.drivers ?? []).map(toUserProfile));
  },
  changePassword: (data: ChangePasswordRequest) => {
    return api.post<{ message: string }>("/users/me/password", data).then((r) => r.data);
  },
};
