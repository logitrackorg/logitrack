import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, User, Lock } from "lucide-react";
import { fmtDateTime } from "../utils/date";
import { usersApi, type UserProfile, type ChangePasswordRequest } from "../api/users";
import { dataAccessRequestsApi, type DataAccessRequest } from "../api/dataAccessRequests";
import { useAuth } from "../context/AuthContext";
import { toast } from "../utils/toast";

type Tab = "profile" | "security" | "privacy";

const BASE_TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "profile",  label: "Mi Perfil",  icon: User },
  { id: "security", label: "Seguridad",  icon: Lock },
];
const DRIVER_TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  ...BASE_TABS,
  { id: "privacy",  label: "Privacidad", icon: ShieldCheck },
];

export function UserProfile() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [dataRequestLoading, setDataRequestLoading] = useState(false);
  const [dataRequestSent, setDataRequestSent] = useState(false);
  const [myRequests, setMyRequests] = useState<DataAccessRequest[]>([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);
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
        setProfileError(
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            "Error al cargar el perfil"
        );
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
      toast.error(
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          "Error al cambiar la contraseña"
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleChange = (field: keyof ChangePasswordRequest, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDataRequest = async () => {
    setDataRequestLoading(true);
    try {
      const res = await dataAccessRequestsApi.create();
      setDataRequestSent(true);
      setMyRequests((prev) => [res.request, ...prev]);
      toast.success(res.message || "Solicitud enviada correctamente");
    } catch (error: unknown) {
      toast.error(
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          "Error al enviar la solicitud"
      );
    } finally {
      setDataRequestLoading(false);
    }
  };

  const isDriver = authUser?.role === "driver";
  const TAB_ITEMS = isDriver ? DRIVER_TABS : BASE_TABS;

  // Load driver's request history when Privacy tab is opened
  useEffect(() => {
    if (activeTab !== "privacy" || !isDriver) return;
    setMyRequestsLoading(true);
    dataAccessRequestsApi.listMine()
      .then(setMyRequests)
      .catch(() => {})
      .finally(() => setMyRequestsLoading(false));
  }, [activeTab, isDriver]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ background: "#e0e7ef", borderRadius: "50%", padding: 10, display: "flex" }}>
          <User size={24} color="#1e3a5f" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f2744" }}>
            Perfil de usuario
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            Tus datos personales y configuracion de seguridad
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* Sidebar */}
        <div style={{ flex: "0 0 200px", minWidth: 180 }}>
          <p style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>
            Secciones
          </p>
          {TAB_ITEMS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  border: "none",
                  borderRadius: 8,
                  background: active ? "#1e3a5f" : "transparent",
                  color: active ? "#fff" : "#334155",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 500,
                  fontSize: 14,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "background 0.15s",
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* --- Mi Perfil --- */}
          {activeTab === "profile" && (
            <div>
              <h2 style={{ marginBottom: 16, color: "#0f2744" }}>Mi Perfil</h2>
              {loadingProfile ? (
                <p style={{ color: "#64748b" }}>Cargando perfil...</p>
              ) : profileError ? (
                <p style={{ color: "#b91c1c" }}>{profileError}</p>
              ) : (
                <div style={{ display: "grid", gap: 16, maxWidth: 520 }}>
                  {[
                    { label: "Nombre Completo", value: profile?.full_name },
                    { label: "Email", value: profile?.email },
                    { label: "Rol de Usuario", value: profile?.role },
                    ...(profile?.branch_name || profile?.branch_id
                      ? [{ label: "Sucursal Asignada", value: profile?.branch_name || profile?.branch_id }]
                      : []),
                  ].map((field) => (
                    <div key={field.label}>
                      <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                        {field.label}
                      </label>
                      <input
                        type="text"
                        value={field.value || ""}
                        readOnly
                        disabled
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          background: "#f8fafc",
                          color: "#334155",
                          fontSize: 14,
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* --- Seguridad --- */}
          {activeTab === "security" && (
            <div>
              <h2 style={{ marginBottom: 16, color: "#0f2744" }}>Seguridad</h2>
              <form onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
                {(
                  [
                    { field: "current_password", label: "Contraseña Actual" },
                    { field: "new_password",     label: "Nueva Contraseña" },
                    { field: "confirm_password", label: "Confirmar Nueva Contraseña" },
                  ] as { field: keyof ChangePasswordRequest; label: string }[]
                ).map(({ field, label }, i) => (
                  <div key={field} style={{ marginBottom: i === 2 ? 24 : 16 }}>
                    <label style={{ display: "block", marginBottom: 4, fontWeight: 500, fontSize: 14 }}>
                      {label}
                    </label>
                    <input
                      type="password"
                      value={form[field]}
                      onChange={(e) => handleChange(field, e.target.value)}
                      required
                      minLength={field !== "current_password" ? 6 : undefined}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        fontSize: 14,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                ))}
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

          {/* --- Privacidad --- */}
          {activeTab === "privacy" && (
            <div>
              <h2 style={{ marginBottom: 6, color: "#0f2744" }}>Privacidad</h2>
              <p style={{ marginBottom: 20, fontSize: 13, color: "#64748b" }}>
                Tus derechos sobre los datos personales recopilados durante tu actividad.
              </p>

              {/* Info box: qué datos se recopilan */}
              <div style={{ background: "#f0f6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "16px 20px", marginBottom: 24 }}>
                <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14, color: "#1e3a5f" }}>
                  Datos que recopila el sistema
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#334155", display: "grid", gap: 6 }}>
                  {isDriver ? (
                    <>
                      <li>Ubicacion GPS durante los viajes activos</li>
                      <li>Registro de envios escaneados y entregados</li>
                      <li>Eventos de inicio y fin de ruta</li>
                      <li>Indicadores de fatiga y estado de descanso</li>
                      <li>Historial de verificaciones de estado fisico (check-in de fatiga)</li>
                    </>
                  ) : (
                    <>
                      <li>Acciones realizadas sobre envios y flota</li>
                      <li>Registro de inicio de sesion y actividad</li>
                      <li>Cambios de estado aplicados</li>
                    </>
                  )}
                </ul>
              </div>

              {/* Derecho de acceso */}
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 20px", marginBottom: 16 }}>
                <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 14, color: "#0f2744" }}>
                  Solicitar mis datos (Ley 25.326)
                </p>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>
                  Podes solicitar una copia completa de todos los datos recopilados sobre tu perfil.
                  El administrador recibira una notificacion y se comunicara con vos a la brevedad.
                </p>

                {dataRequestSent ? (
                  <div style={{
                    background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8,
                    padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <ShieldCheck size={18} color="#16a34a" />
                    <span style={{ fontSize: 13, color: "#15803d", fontWeight: 500 }}>
                      Solicitud enviada. El administrador fue notificado.
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDataRequest}
                    disabled={dataRequestLoading}
                    style={{
                      background: "#1e3a5f",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      cursor: dataRequestLoading ? "not-allowed" : "pointer",
                      fontSize: 14,
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <ShieldCheck size={16} />
                    {dataRequestLoading ? "Enviando solicitud..." : "Solicitar mis datos"}
                  </button>
                )}
              </div>

              <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 24px" }}>
                Ley 25.326 de Proteccion de los Datos Personales — Argentina
              </p>

              {/* Historial de solicitudes */}
              <div>
                <p style={{ fontWeight: 700, fontSize: 14, color: "#0f2744", marginBottom: 10 }}>
                  Historial de solicitudes
                </p>
                {myRequestsLoading ? (
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>Cargando...</p>
                ) : myRequests.length === 0 ? (
                  <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 8, padding: "20px 16px", textAlign: "center" }}>
                    <ShieldCheck size={28} color="#cbd5e1" style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>
                      Tus solicitudes apareceran aqui una vez que las envies.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {myRequests.map((req) => (
                      <DataRequestCard key={req.id} req={req} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DataRequestCard ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { text: string; bg: string; color: string; border: string }> = {
  pending:  { text: "Pendiente",  bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
  accepted: { text: "Aceptada",   bg: "#f0fdf4", color: "#15803d", border: "#86efac" },
  rejected: { text: "Rechazada",  bg: "#fff1f2", color: "#9f1239", border: "#fda4af" },
};

function DataRequestCard({ req }: { req: DataAccessRequest }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_LABEL[req.status] ?? STATUS_LABEL.pending;

  return (
    <div style={{ border: `1px solid ${st.border}`, borderRadius: 10, background: st.bg, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: st.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {st.text}
          </span>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
            Solicitado el {fmtDateTime(req.requested_at)}
            {req.reviewed_by && ` · Revisado por ${req.reviewed_by}`}
          </p>
        </div>
        {req.status === "accepted" && req.checkin_data && (
          <button
            onClick={() => setOpen((v) => !v)}
            style={{ fontSize: 12, fontWeight: 600, color: "#15803d", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            {open ? "Ocultar datos" : "Ver check-in"}
          </button>
        )}
      </div>

      {open && req.checkin_data && (
        <div style={{ borderTop: `1px solid ${st.border}`, padding: "12px 16px", background: "#fff" }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#0f2744" }}>
            Ultimo check-in ({req.checkin_data.date})
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
            {[
              { label: "KSS (somnolencia)", value: req.checkin_data.kss_level },
              { label: "Horas de sueno", value: `${req.checkin_data.horas_sueno}h` },
              { label: "Score de voz", value: req.checkin_data.drift_score ?? "—" },
              {
                label: "Latencia PVT",
                value: req.checkin_data.pvt_metrics
                  ? `${req.checkin_data.pvt_metrics.latencia_promedio_ms.toFixed(0)} ms`
                  : "—",
              },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ margin: 0, fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{label}</p>
                <p style={{ margin: 0, fontSize: 13, color: "#334155", fontWeight: 700 }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
