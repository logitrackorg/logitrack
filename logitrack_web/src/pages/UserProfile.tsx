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
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);
  const [form, setForm] = useState<ChangePasswordRequest>({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  // History tab (driver only)
  const [historyResult, setHistoryResult] = useState<PersonalHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [requestingHistory, setRequestingHistory] = useState(false);
  const [requestingDeletion, setRequestingDeletion] = useState(false);

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

  const handleRequestDeletion = async () => {
    setRequestingDeletion(true);
    try {
      await driverApi.requestHistoryDeletion();
      toast.success("Solicitud de eliminación enviada. Tu supervisor la revisará a la brevedad.");
      await loadHistory();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo enviar la solicitud");
    } finally {
      setRequestingDeletion(false);
    }
  };

  // Caso A: sin permisos activos (incluye "sin_solicitud" y solicitudes rechazadas).
  // Caso B: solicitud de acceso pendiente.
  // Caso C: acceso aprobado — historial compartido.
  // Caso D: solicitud de eliminación pendiente (tiene precedencia visual sobre C).
  const accessStatus = historyResult?.request_status;
  const deletionStatus = historyResult?.deletion_request?.status;
  const privacyCase: "A" | "B" | "C" | "D" =
    deletionStatus === "pending" ? "D"
    : accessStatus === "pending" ? "B"
    : accessStatus === "approved" ? "C"
    : "A";

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
    if (form.new_password.length < 8 || !/\d/.test(form.new_password)) {
      setNewPasswordTouched(true);
      return;
    }
    if (form.new_password !== form.confirm_password) {
      setConfirmPasswordTouched(true);
      return;
    }
    setPasswordLoading(true);
    try {
      await usersApi.changePassword(form);
      toast.success("Contraseña cambiada exitosamente");
      setForm({ current_password: "", new_password: "", confirm_password: "" });
      setNewPasswordTouched(false);
      setConfirmPasswordTouched(false);
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
      <div className="flex gap-6 items-start">
        <div className="flex-none w-60 min-w-[220px]">
          <div className="mb-6">
            <h3 className="mb-3">Secciones</h3>
            <button
              type="button"
              onClick={() => setActiveTab("profile")}
              className={`w-full text-left px-4 py-3 border-none rounded-lg cursor-pointer mb-3 ${
                activeTab === "profile"
                  ? "bg-[#1e3a5f] text-white font-bold"
                  : "bg-[var(--bg-page)] text-[var(--text-primary)] font-medium"
              }`}
            >
              Mi Perfil
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("security")}
              className={`w-full text-left px-4 py-3 border-none rounded-lg cursor-pointer mb-3 ${
                activeTab === "security"
                  ? "bg-[#1e3a5f] text-white font-bold"
                  : "bg-[var(--bg-page)] text-[var(--text-primary)] font-medium"
              }`}
            >
              Seguridad
            </button>
            {isDriver && (
              <button
                type="button"
                onClick={() => setActiveTab("historial")}
                className={`w-full text-left px-4 py-3 border-none rounded-lg cursor-pointer mb-3 ${
                  activeTab === "historial"
                    ? "bg-[#1e3a5f] text-white font-bold"
                    : "bg-[var(--bg-page)] text-[var(--text-primary)] font-medium"
                }`}
              >
                Historial de Fatiga
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {activeTab === "historial" && isDriver ? (
            <div>
              <h2 className="mb-4">Privacidad e Historial de Check-in</h2>
              {historyLoading ? (
                <p className="text-slate-500">Cargando historial...</p>
              ) : (
                <div>
                  <p className="mb-4 text-slate-600 text-sm">
                    Tu historial de check-ins de fatiga es privado. Para que tu supervisor pueda
                    consultarlo, primero tenés que autorizar el acceso — y podés revocarlo cuando quieras.
                  </p>

                  {/* Caso A: sin permisos activos */}
                  {privacyCase === "A" && (
                    <div>
                      {accessStatus === "rejected" && (
                        <div className="px-5 py-4 bg-red-50 border border-red-300 rounded-lg text-red-900 text-sm mb-4">
                          Tu solicitud anterior fue rechazada. Podés volver a solicitar la revisión cuando quieras.
                        </div>
                      )}
                      <button
                        onClick={handleRequestHistory}
                        disabled={requestingHistory}
                        className="bg-[#1e3a5f] text-white border-none rounded-md px-5 py-2.5 text-sm font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {requestingHistory ? "Enviando..." : "Solicitar revisión de historial personal"}
                      </button>
                    </div>
                  )}

                  {/* Caso B: solicitud de acceso pendiente */}
                  {privacyCase === "B" && (
                    <div>
                      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-100 border border-yellow-300 text-amber-900 text-sm font-semibold">
                        Solicitud de acceso pendiente de aprobación
                      </span>
                      <p className="mt-3 text-xs text-slate-500">
                        Tu supervisor revisará la petición a la brevedad. Mientras tanto, los controles quedan deshabilitados.
                      </p>
                      <button
                        disabled
                        className="mt-3 bg-[#1e3a5f] text-white border-none rounded-md px-5 py-2.5 text-sm font-medium opacity-50 cursor-not-allowed"
                      >
                        Solicitar revisión de historial personal
                      </button>
                    </div>
                  )}

                  {/* Caso D: solicitud de eliminación pendiente (precede a C) */}
                  {privacyCase === "D" && (
                    <div>
                      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-100 border border-orange-300 text-orange-900 text-sm font-semibold">
                        Solicitud de eliminación en proceso de revisión
                      </span>
                      <p className="mt-3 text-xs text-slate-500">
                        Tu supervisor revisará la petición de revocación. Cuando se apruebe, el historial dejará de estar compartido.
                      </p>
                    </div>
                  )}

                  {/* Caso C: historial compartido / aprobado */}
                  {privacyCase === "C" && (
                    <div>
                      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-sm font-semibold">
                        Historial compartido con supervisores
                      </span>
                      <div className="mt-3">
                        <button
                          onClick={handleRequestDeletion}
                          disabled={requestingDeletion}
                          className="bg-[#1e3a5f] text-white border-none rounded-md px-5 py-2.5 text-sm font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {requestingDeletion ? "Enviando..." : "Solicitar eliminación / Revocar acceso de historial"}
                        </button>
                      </div>

                      {historyResult?.ok && historyResult.history && (
                        <div className="mt-6">
                          <p className="text-xs text-slate-500 mb-3">
                            Acceso aprobado · {historyResult.total} registro{historyResult.total !== 1 ? "s" : ""}
                          </p>
                          {historyResult.history.length === 0 ? (
                            <p className="text-slate-400 text-sm">Sin check-ins registrados aún.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse text-xs">
                                <thead>
                                  <tr className="bg-slate-50">
                                    <th className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">Fecha</th>
                                    <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-slate-200">KSS</th>
                                    <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-slate-200">Sueño</th>
                                    <th className="px-3 py-2 text-center font-semibold text-slate-600 border-b border-slate-200">Estado</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {historyResult.history.map((rec) => {
                                    const [yy, mm, dd] = rec.date.split("-");
                                    return (
                                      <tr key={rec.recorded_at || rec.date} className="border-b border-slate-100">
                                        <td className="px-3 py-2 text-slate-700">
                                          {dd}/{mm}/{yy}
                                          {rec.recorded_at && (
                                            <span className="ml-1.5 text-slate-400 text-[11px]">
                                              {new Date(rec.recorded_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {rec.skipped ? (
                                            <span className="text-amber-600 font-semibold text-[11px]">Saltado</span>
                                          ) : (
                                            <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${
                                              rec.kss_level <= 4 ? "bg-emerald-100 text-emerald-800" : rec.kss_level <= 7 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                                            }`}>
                                              {rec.kss_level}
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-center text-slate-700">
                                          {rec.skipped ? "—" : `${rec.horas_sueno}h`}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                          {rec.skipped ? (
                                            <span className="text-amber-600 text-[11px]">Salteado</span>
                                          ) : rec.drift_score != null ? (
                                            <span className={`text-[11px] font-semibold ${
                                              rec.drift_score <= 29 ? "text-emerald-600" : rec.drift_score < 60 ? "text-amber-600" : "text-red-600"
                                            }`}>
                                              Score: {rec.drift_score}
                                            </span>
                                          ) : (
                                            <span className="text-slate-300 text-[11px]">—</span>
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
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTab === "profile" ? (
            <div>
              <h2 className="mb-4">Mi Perfil</h2>
              {loadingProfile ? (
                <p>Cargando perfil...</p>
              ) : profileError ? (
                <p className="text-[var(--danger-text)]">{profileError}</p>
              ) : (
                <div className="grid gap-4 max-w-[520px]">
                  <div>
                    <label className="block mb-1.5 font-medium">
                      Nombre Completo
                    </label>
                    <input
                      type="text"
                      value={profile?.full_name || ""}
                      readOnly
                      disabled
                      className="w-full px-3 py-2.5 border border-[var(--border-strong)] rounded-md bg-[var(--bg-page)] text-[var(--text-strong)]"
                    />
                  </div>

                  <div>
                    <label className="block mb-1.5 font-medium">
                      Email
                    </label>
                    <input
                      type="email"
                      value={profile?.email || ""}
                      readOnly
                      disabled
                      className="w-full px-3 py-2.5 border border-[var(--border-strong)] rounded-md bg-[var(--bg-page)] text-[var(--text-strong)]"
                    />
                  </div>

                  <div>
                    <label className="block mb-1.5 font-medium">
                      Rol de Usuario
                    </label>
                    <input
                      type="text"
                      value={profile?.role || ""}
                      readOnly
                      disabled
                      className="w-full px-3 py-2.5 border border-[var(--border-strong)] rounded-md bg-[var(--bg-page)] text-[var(--text-strong)]"
                    />
                  </div>

                  {(profile?.branch_name || profile?.branch_id) && (
                    <div>
                      <label className="block mb-1.5 font-medium">
                        Sucursal Asignada
                      </label>
                      <input
                        type="text"
                        value={profile.branch_name || profile.branch_id}
                        readOnly
                        disabled
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-md bg-slate-50 text-slate-700"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="mb-4">Seguridad</h2>
              <form onSubmit={handleSubmit} className="max-w-[520px]">
                <div className="mb-4">
                  <label className="block mb-1 font-medium">
                    Contraseña Actual
                  </label>
                  <input
                    type="password"
                    value={form.current_password}
                    onChange={(e) => handleChange("current_password", e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-[var(--border-strong)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div className="mb-4">
                  <label className="block mb-1 font-medium">
                    Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={form.new_password}
                    onChange={(e) => handleChange("new_password", e.target.value)}
                    onBlur={() => setNewPasswordTouched(true)}
                    required
                    minLength={8}
                    className={`w-full px-3 py-2 rounded-md text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
                      newPasswordTouched && (form.new_password.length < 8 || !/\d/.test(form.new_password))
                        ? "border-red-500"
                        : "border-[var(--border-strong)]"
                    }`}
                  />
                  {form.new_password.length > 0 && (() => {
                    const ok8 = form.new_password.length >= 8;
                    const okNum = /\d/.test(form.new_password);
                    const item = (met: boolean, text: string) => (
                      <div className={`flex items-center gap-1.5 text-[0.78rem] ${met ? "text-[var(--ok-text)]" : "text-[var(--danger-text)]"}`}>
                        <span className="font-bold">{met ? "✓" : "✗"}</span>
                        {text}
                      </div>
                    );
                    return (
                      <div className="flex flex-col gap-1 mt-1.5 px-2.5 py-2 bg-[var(--bg-subtle)] rounded-md border border-[var(--border)]">
                        {item(ok8, "Al menos 8 caracteres")}
                        {item(okNum, "Al menos un número")}
                      </div>
                    );
                  })()}
                </div>

                <div className="mb-6">
                  <label className="block mb-1 font-medium">
                    Confirmar Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={form.confirm_password}
                    onChange={(e) => handleChange("confirm_password", e.target.value)}
                    onBlur={() => setConfirmPasswordTouched(true)}
                    required
                    minLength={8}
                    className={`w-full px-3 py-2 rounded-md text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
                      confirmPasswordTouched && form.confirm_password.length > 0 && form.new_password !== form.confirm_password
                        ? "border-red-500"
                        : "border-[var(--border-strong)]"
                    }`}
                  />
                  {confirmPasswordTouched && form.confirm_password.length > 0 && form.new_password !== form.confirm_password && (
                    <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden.</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="bg-[#1e3a5f] text-white border-none rounded-md px-5 py-2.5 text-sm font-medium cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
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
