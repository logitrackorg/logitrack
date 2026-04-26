import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usersApi, type ChangePasswordRequest } from "../api/users";
import { toast } from "react-toastify";

export function UserProfile() {
  const navigate = useNavigate();
  const [form, setForm] = useState<ChangePasswordRequest>({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.new_password !== form.confirm_password) {
      toast.error("Las contraseñas nuevas no coinciden");
      return;
    }
    if (form.new_password.length < 6) {
      toast.error("La nueva contraseña debe tener al menos 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      await usersApi.changePassword(form);
      toast.success("Contraseña cambiada exitosamente");
      setForm({ current_password: "", new_password: "", confirm_password: "" });
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Error al cambiar la contraseña");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof ChangePasswordRequest, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: "none",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            padding: "8px 16px",
            cursor: "pointer",
            marginBottom: 16,
          }}
        >
          ← Volver
        </button>
        <h1>Perfil de Usuario</h1>
      </div>

      <div style={{ display: "flex", gap: 32 }}>
        {/* Sidebar */}
        <div style={{ flex: "0 0 200px" }}>
          <h3 style={{ marginBottom: 16 }}>Opciones</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            <li style={{ marginBottom: 8 }}>
              <strong>Cambiar Contraseña</strong>
            </li>
          </ul>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1 }}>
          <h2>Cambiar Contraseña</h2>
          <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                Contraseña Actual
              </label>
              <input
                type="password"
                value={form.current_password}
                onChange={(e) => handleChange("current_password", e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                Nueva Contraseña
              </label>
              <input
                type="password"
                value={form.new_password}
                onChange={(e) => handleChange("new_password", e.target.value)}
                required
                minLength={6}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
                Confirmar Nueva Contraseña
              </label>
              <input
                type="password"
                value={form.confirm_password}
                onChange={(e) => handleChange("confirm_password", e.target.value)}
                required
                minLength={6}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                background: "#1e3a5f",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "10px 20px",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {loading ? "Cambiando..." : "Cambiar Contraseña"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}