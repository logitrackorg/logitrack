import axios from "axios";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

const client = axios.create({ baseURL: BASE });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface Customer {
  dni: string;
  name: string;
  phone: string;
  email?: string;
  address: {
    street?: string;
    city: string;
    province: string;
    postal_code?: string;
  };
}

export const customerApi = {
  getByDNI: async (dni: string): Promise<Customer | null> => {
    try {
      const res = await client.get<Customer>("/customers", { params: { dni } });
      return res.data;
    } catch {
      return null;
    }
  },
};
