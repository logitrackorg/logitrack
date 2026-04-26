import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usersApi, type UserProfile, type ChangePasswordRequest } from "../api/users";
import { toast } from "../utils/toast";

export function UserProfile() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"profile" | "security">("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [form, setForm] = useState<ChangePasswordRequest>({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  useEffect(() => {
    const fetchProfile = async () => {
      setLoadingProfile(true);
      setProfileError(null);
      try {
        const data = await usersApi.getMe();
        setProfile(data);
      } catch (error: unknown) {
        setProfileError((error as { response?: { data?: { error?: string } } })?.response?.data?.error || "Error al cargar el perfil");
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, []);

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
    setPasswordLoading(true);
    try {
      await usersApi.changePassword(form);
      toast.success("Contraseña cambiada exitosamente");
      setForm({ current_password: "", new_password: "", confirm_password: "" });
    } catch (error: unknown) {
      toast.error((error as { response?: { data?: { error?: string } } })?.response?.data?.error || "Error al cambiar la contraseña");
    } finally {
      setPasswordLoading(false);
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

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 240px", minWidth: 220 }}>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Secciones</h3>
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 16px",
                border: "none",
                borderRadius: 8,
                background: activeTab === "profile" ? "#1e3a5f" : "#f8fafc",
                color: activeTab === "profile" ? "#fff" : "#0f172a",
                cursor: "pointer",
                fontWeight: activeTab === "profile" ? 700 : 500,
                marginBottom: 12,
              }}
            >
              Mi Perfil
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("security")}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "12px 16px",
                border: "none",
                borderRadius: 8,
                background: activeTab === "security" ? "#1e3a5f" : "#f8fafc",
                color: activeTab === "security" ? "#fff" : "#0f172a",
                cursor: "pointer",
                fontWeight: activeTab === "security" ? 700 : 500,
                marginBottom: 12,
              }}
            >
              Seguridad
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeTab === "profile" ? (
            <div>
              <h2 style={{ marginBottom: 16 }}>Mi Perfil</h2>
              {loadingProfile ? (
                <p>Cargando perfil...</p>
              ) : profileError ? (
                <p style={{ color: "#b91c1c" }}>{profileError}</p>
              ) : (
                <div style={{ display: "grid", gap: 16, maxWidth: 520 }}>
                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                      Nombre Completo
                    </label>
                    <input
                      type="text"
                      value={profile?.full_name || ""}
                      readOnly
                      disabled
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        background: "#f8fafc",
                        color: "#334155",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                      Email
                    </label>
                    <input
                      type="email"
                      value={profile?.email || ""}
                      readOnly
                      disabled
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        background: "#f8fafc",
                        color: "#334155",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                      Rol de Usuario
                    </label>
                    <input
                      type="text"
                      value={profile?.role || ""}
                      readOnly
                      disabled
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        background: "#f8fafc",
                        color: "#334155",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                      Sucursal Asignada
                    </label>
                    <input
                      type="text"
                      value={profile?.branch_name || profile?.branch_id || "No asignada"}
                      readOnly
                      disabled
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        background: "#f8fafc",
                        color: "#334155",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 style={{ marginBottom: 16 }}>Seguridad</h2>
              <form onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
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
                  disabled={passwordLoading}
                  style={{
                    background: "#1e3a5f",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "10px 20px",
                    cursor: passwordLoading ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  {passwordLoading ? "Cambiando..." : "Guardar Cambios"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}