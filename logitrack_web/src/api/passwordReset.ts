const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

export type ResetChannel = "email" | "whatsapp";

export const passwordResetApi = {
  request: (username: string, channel: ResetChannel) =>
    fetch(`${API_BASE}/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, channel }),
    }).then(async (r) => {
      if (r.status === 429) throw new Error("rate_limited");
      return r.json();
    }),

  confirm: (username: string, otp: string, newPassword: string) =>
    fetch(`${API_BASE}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, otp, new_password: newPassword }),
    }).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "invalid_otp");
      }
      return r.json();
    }),
};
