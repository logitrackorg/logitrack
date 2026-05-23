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
  }
);

export interface Payment {
  id: string;
  tracking_id: string;
  mp_preference_id: string;
  mp_payment_id?: string;
  init_point: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "abandoned";
  created_at: string;
  approved_at?: string;
  abandoned_at?: string;
  abandoned_reason?: string;
}

export const paymentApi = {
  requestPayment(trackingId: string): Promise<Payment> {
    return api.post(`/shipments/${trackingId}/request-payment`).then((r) => r.data);
  },
  backToDraft(trackingId: string): Promise<void> {
    return api.post(`/shipments/${trackingId}/back-to-draft`).then(() => {});
  },
  get(trackingId: string): Promise<Payment> {
    return api.get(`/shipments/${trackingId}/payment`).then((r) => r.data);
  },
  confirmCashPayment(trackingId: string): Promise<{ tracking_id: string }> {
    return api.post(`/shipments/${trackingId}/cash-payment`).then((r) => r.data);
  },
  getQR(trackingId: string): Promise<{ qr_code_base64: string; init_point: string }> {
    return api.get(`/shipments/${trackingId}/payment/qr`).then((r) => r.data);
  },
};
