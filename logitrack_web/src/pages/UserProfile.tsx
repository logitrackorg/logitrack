import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { usersApi, type UserProfile, type ChangePasswordRequest } from "../api/users";
import { driverApi, type PersonalHistoryResult } from "../api/driver";
import { useAuth } from "../context/AuthContext";
import { toast } from "../utils/toast";

export function UserProfile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDriver = user?.role === "driver";
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "historial">("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [form, setForm] = useState<ChangePasswordRequest>({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  // History tab (driver only)
  const [historyResult, setHistoryResult] = useState<PersonalHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [requestingHistory, setRequestingHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const result = await driverApi.getPersonalHistory();
    setHistoryResult(result);
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === "historial" && isDriver) loadHistory();
  }, [activeTab, isDriver, loadHistory]);

  const handleRequestHistory = async () => {
    setRequestingHistory(true);
    try {
      await driverApi.requestHistory();
      toast.success("Solicitud enviada. Tu supervisor recibirá la petición.");
      await loadHistory();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo enviar la solicitud");
    } finally {
      setRequestingHistory(false);
    }
  };

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
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver
      </button>
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
                background: activeTab === "profile" ? "#1e3a5f" : "var(--bg-page)",
                color: activeTab === "profile" ? "#fff" : "var(--text-primary)",
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
                background: activeTab === "security" ? "#1e3a5f" : "var(--bg-page)",
                color: activeTab === "security" ? "#fff" : "var(--text-primary)",
                cursor: "pointer",
                fontWeight: activeTab === "security" ? 700 : 500,
                marginBottom: 12,
              }}
            >
              Seguridad
            </button>
            {isDriver && (
              <button
                type="button"
                onClick={() => setActiveTab("historial")}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  border: "none",
                  borderRadius: 8,
                  background: activeTab === "historial" ? "#1e3a5f" : "#f8fafc",
                  color: activeTab === "historial" ? "#fff" : "#0f172a",
                  cursor: "pointer",
                  fontWeight: activeTab === "historial" ? 700 : 500,
                  marginBottom: 12,
                }}
              >
                Historial de Fatiga
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeTab === "historial" && isDriver ? (
            <div>
              <h2 style={{ marginBottom: 16 }}>Historial de Fatiga</h2>
              {historyLoading ? (
                <p style={{ color: "#64748b" }}>Cargando historial...</p>
              ) : !historyResult || historyResult.request_status === "sin_solicitud" ? (
                <div>
                  <p style={{ marginBottom: 16, color: "#475569", fontSize: 14 }}>
                    Tu historial de check-ins de fatiga es privado. Para consultarlo, solicitá acceso a tu supervisor.
                  </p>
                  <button
                    onClick={handleRequestHistory}
                    disabled={requestingHistory}
                    style={{
                      background: "#1e3a5f",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      cursor: requestingHistory ? "not-allowed" : "pointer",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {requestingHistory ? "Enviando..." : "Solicitar acceso a mi historial"}
                  </button>
                </div>
              ) : historyResult.request_status === "pending" ? (
                <div style={{ padding: "16px 20px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, color: "#78350f", fontSize: 14 }}>
                  Solicitud pendiente — tu supervisor revisará tu petición a la brevedad.
                </div>
              ) : historyResult.request_status === "rejected" ? (
                <div>
                  <div style={{ padding: "16px 20px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#7f1d1d", fontSize: 14, marginBottom: 16 }}>
                    Tu solicitud fue rechazada. Podés volver a solicitarla si necesitás acceso.
                  </div>
                  <button
                    onClick={handleRequestHistory}
                    disabled={requestingHistory}
                    style={{
                      background: "#1e3a5f",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      cursor: requestingHistory ? "not-allowed" : "pointer",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {requestingHistory ? "Enviando..." : "Volver a solicitar acceso"}
                  </button>
                </div>
              ) : historyResult.ok && historyResult.history ? (
                <div>
                  <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
                    Acceso aprobado · {historyResult.total} registro{historyResult.total !== 1 ? "s" : ""}
                  </p>
                  {historyResult.history.length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: 14 }}>Sin check-ins registrados aún.</p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Fecha</th>
                            <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>KSS</th>
                            <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Sueño</th>
                            <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {historyResult.history.map((rec) => {
                            const [yy, mm, dd] = rec.date.split("-");
                            return (
                              <tr key={rec.recorded_at || rec.date} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "8px 12px", color: "#334155" }}>
                                  {dd}/{mm}/{yy}
                                  {rec.recorded_at && (
                                    <span style={{ marginLeft: 6, color: "#94a3b8", fontSize: 11 }}>
                                      {new Date(rec.recorded_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                  {rec.skipped ? (
                                    <span style={{ color: "#d97706", fontWeight: 600, fontSize: 11 }}>Saltado</span>
                                  ) : (
                                    <span style={{
                                      display: "inline-block",
                                      padding: "2px 8px",
                                      borderRadius: 4,
                                      fontWeight: 700,
                                      fontSize: 12,
                                      background: rec.kss_level <= 4 ? "#d1fae5" : rec.kss_level <= 7 ? "#fef3c7" : "#fee2e2",
                                      color: rec.kss_level <= 4 ? "#065f46" : rec.kss_level <= 7 ? "#92400e" : "#7f1d1d",
                                    }}>
                                      {rec.kss_level}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: "8px 12px", textAlign: "center", color: "#334155" }}>
                                  {rec.skipped ? "—" : `${rec.horas_sueno}h`}
                                </td>
                                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                                  {rec.skipped ? (
                                    <span style={{ color: "#d97706", fontSize: 11 }}>Salteado</span>
                                  ) : rec.drift_score != null ? (
                                    <span style={{ fontSize: 11, fontWeight: 600, color: rec.drift_score <= 29 ? "#059669" : rec.drift_score < 60 ? "#d97706" : "#dc2626" }}>
                                      Score: {rec.drift_score}
                                    </span>
                                  ) : (
                                    <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : activeTab === "profile" ? (
            <div>
              <h2 style={{ marginBottom: 16 }}>Mi Perfil</h2>
              {loadingProfile ? (
                <p>Cargando perfil...</p>
              ) : profileError ? (
                <p style={{ color: "var(--danger-text)" }}>{profileError}</p>
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
                        border: "1px solid var(--border-strong)",
                        borderRadius: 6,
                        background: "var(--bg-page)",
                        color: "var(--text-strong)",
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
                        border: "1px solid var(--border-strong)",
                        borderRadius: 6,
                        background: "var(--bg-page)",
                        color: "var(--text-strong)",
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
                        border: "1px solid var(--border-strong)",
                        borderRadius: 6,
                        background: "var(--bg-page)",
                        color: "var(--text-strong)",
                      }}
                    />
                  </div>

                  {(profile?.branch_name || profile?.branch_id) && (
                    <div>
                      <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                        Sucursal Asignada
                      </label>
                      <input
                        type="text"
                        value={profile.branch_name || profile.branch_id}
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
                  )}
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
                      border: "1px solid var(--border-strong)",
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
                      border: "1px solid var(--border-strong)",
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
                      border: "1px solid var(--border-strong)",
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