import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, User, Lock, ClipboardList, Loader2 } from "lucide-react";
import { usersApi, type UserProfile, type ChangePasswordRequest } from "../api/users";
import { driverApi, type PersonalHistoryResult } from "../api/driver";
import { useAuth } from "../context/AuthContext";

import { Button } from "@/components/ui/button";
import { useIsMobile } from "../hooks/useIsMobile";
import { toast } from "../utils/toast";
import { cn } from "@/lib/utils";

type Tab = "profile" | "security" | "historial";

const TABS: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Mi Perfil", icon: User },
  { id: "security", label: "Seguridad", icon: Lock },
];

export function UserProfile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isDriver = user?.role === "driver";
  const [activeTab, setActiveTab] = useState<Tab>("profile");
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

  const driverTabs: { id: Tab; label: string; icon: typeof User }[] = isDriver
    ? [...TABS, { id: "historial", label: "Historial de Fatiga", icon: ClipboardList }]
    : TABS;

  const content = (
    <div className={cn("mx-auto", isDriver ? "px-4" : "p-6 max-w-2xl")}>
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4 cursor-pointer min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver
      </button>

      <div className={cn("gap-6", isMobile ? "flex flex-col" : "flex items-start")}>
        {/* Tabs — vertical on desktop, horizontal scrollable on mobile */}
        {isMobile ? (
          <nav className="flex gap-1 overflow-x-auto pb-2 -mx-4 px-4" role="tablist">
            {driverTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors min-h-[44px]",
                    active
                      ? "bg-[var(--sidebar-bg)] text-white"
                      : "bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
                  )}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        ) : (
          <nav className="flex-none w-52" role="tablist">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
              Secciones
            </p>
            <div className="flex flex-col gap-1">
              {driverTabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors",
                      active
                        ? "bg-[var(--sidebar-bg)] text-white"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <Icon size={18} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {activeTab === "historial" && isDriver ? (
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Historial de Fatiga</h2>
              {historyLoading ? (
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Cargando historial...
                </div>
              ) : !historyResult || historyResult.request_status === "sin_solicitud" ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-5">
                  <p className="text-sm text-[var(--text-secondary)] mb-4">
                    Tu historial de check-ins de fatiga es privado. Para consultarlo, solicitá acceso a tu supervisor.
                  </p>
                  <Button
                    variant="default"
                    onClick={handleRequestHistory}
                    disabled={requestingHistory}
                    className="h-11 rounded-xl font-semibold text-sm"
                  >
                    {requestingHistory ? "Enviando..." : "Solicitar acceso a mi historial"}
                  </Button>
                </div>
              ) : historyResult.request_status === "pending" ? (
                <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-4 text-sm text-[var(--warn-text)]">
                  Solicitud pendiente — tu supervisor revisará tu petición a la brevedad.
                </div>
              ) : historyResult.request_status === "rejected" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger-text)]">
                    Tu solicitud fue rechazada. Podés volver a solicitarla si necesitás acceso.
                  </div>
                  <Button
                    variant="default"
                    onClick={handleRequestHistory}
                    disabled={requestingHistory}
                    className="h-11 rounded-xl font-semibold text-sm"
                  >
                    {requestingHistory ? "Enviando..." : "Volver a solicitar acceso"}
                  </Button>
                </div>
              ) : historyResult.ok && historyResult.history ? (
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-4">
                    Acceso aprobado · {historyResult.total} registro{historyResult.total !== 1 ? "s" : ""}
                  </p>
                  {historyResult.history.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">Sin check-ins registrados aún.</p>
                  ) : isMobile ? (
                    /* Mobile: stacked cards */
                    <div className="flex flex-col gap-3">
                      {historyResult.history.map((rec) => {
                        const [yy, mm, dd] = rec.date.split("-");
                        return (
                          <div key={rec.recorded_at || rec.date} className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-semibold text-[var(--text-primary)]">
                                {dd}/{mm}/{yy}
                              </p>
                              {rec.skipped ? (
                                <span className="text-xs font-semibold text-[var(--warn-text)] bg-[var(--warn-bg)] px-2.5 py-0.5 rounded-full">
                                  Saltado
                                </span>
                              ) : (
                                <span className={cn(
                                  "inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold",
                                  rec.kss_level <= 4
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                                    : rec.kss_level <= 7
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                                      : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                                )}>
                                  KSS {rec.kss_level}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-xs text-[var(--text-muted)]">Horas de sueño</p>
                                <p className="font-semibold text-[var(--text-primary)]">{rec.skipped ? "—" : `${rec.horas_sueno}h`}</p>
                              </div>
                              <div>
                                <p className="text-xs text-[var(--text-muted)]">Estado</p>
                                {rec.skipped ? (
                                  <p className="text-xs text-[var(--warn-text)]">Salteado</p>
                                ) : rec.drift_score != null ? (
                                  <p className={cn(
                                    "text-xs font-semibold",
                                    rec.drift_score <= 29 ? "text-emerald-600 dark:text-emerald-400" : rec.drift_score < 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                                  )}>
                                    Score: {rec.drift_score}
                                  </p>
                                ) : (
                                  <p className="text-xs text-[var(--text-muted)]">—</p>
                                )}
                              </div>
                            </div>
                            {rec.recorded_at && (
                              <p className="text-[11px] text-[var(--text-muted)] mt-2">
                                {new Date(rec.recorded_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Desktop: table */
                    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--bg-subtle)]">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Fecha</th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">KSS</th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Sueño</th>
                            <th className="px-4 py-2.5 text-center text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {historyResult.history.map((rec) => {
                            const [yy, mm, dd] = rec.date.split("-");
                            return (
                              <tr key={rec.recorded_at || rec.date} className="hover:bg-[var(--bg-hover)] transition-colors">
                                <td className="px-4 py-3 text-[var(--text-primary)]">
                                  {dd}/{mm}/{yy}
                                  {rec.recorded_at && (
                                    <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                                      {new Date(rec.recorded_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {rec.skipped ? (
                                    <span className="text-xs font-semibold text-[var(--warn-text)]">Saltado</span>
                                  ) : (
                                    <span className={cn(
                                      "inline-flex px-2 py-0.5 rounded text-xs font-bold",
                                      rec.kss_level <= 4
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                                        : rec.kss_level <= 7
                                          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                                          : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                                    )}>
                                      {rec.kss_level}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center text-[var(--text-primary)]">
                                  {rec.skipped ? "—" : `${rec.horas_sueno}h`}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {rec.skipped ? (
                                    <span className="text-xs text-[var(--warn-text)]">Salteado</span>
                                  ) : rec.drift_score != null ? (
                                    <span className={cn(
                                      "text-xs font-semibold",
                                      rec.drift_score <= 29 ? "text-emerald-600 dark:text-emerald-400" : rec.drift_score < 60 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                                    )}>
                                      Score: {rec.drift_score}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-[var(--text-muted)]">—</span>
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
              <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Mi Perfil</h2>
              {loadingProfile ? (
                <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Cargando perfil...
                </div>
              ) : profileError ? (
                <p className="text-[var(--danger-text)] text-sm">{profileError}</p>
              ) : (
                <div className="grid gap-4 max-w-lg">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                      Nombre Completo
                    </label>
                    <input
                      type="text"
                      value={profile?.full_name || ""}
                      readOnly
                      disabled
                      className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-sm disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      value={profile?.email || ""}
                      readOnly
                      disabled
                      className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-sm disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                      Rol de Usuario
                    </label>
                    <input
                      type="text"
                      value={profile?.role || ""}
                      readOnly
                      disabled
                      className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-sm disabled:opacity-60"
                    />
                  </div>
                  {(profile?.branch_name || profile?.branch_id) && (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                        Sucursal Asignada
                      </label>
                      <input
                        type="text"
                        value={profile.branch_name || profile.branch_id}
                        readOnly
                        disabled
                        className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] text-sm disabled:opacity-60"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Seguridad</h2>
              <form onSubmit={handleSubmit} className="max-w-lg">
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                    Contraseña Actual
                  </label>
                  <input
                    type="password"
                    value={form.current_password}
                    onChange={(e) => handleChange("current_password", e.target.value)}
                    required
                    className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                    Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={form.new_password}
                    onChange={(e) => handleChange("new_password", e.target.value)}
                    onBlur={() => setNewPasswordTouched(true)}
                    required
                    minLength={8}
                    className={cn(
                      "w-full h-12 px-4 rounded-xl border bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]",
                      newPasswordTouched && (form.new_password.length < 8 || !/\d/.test(form.new_password))
                        ? "border-[var(--danger-c)]"
                        : "border-[var(--border)]"
                    )}
                  />
                  {form.new_password.length > 0 && (
                    <div className="flex flex-col gap-1 mt-2 px-3 py-2 bg-[var(--bg-subtle)] rounded-lg border border-[var(--border)]">
                      <Requirement met={form.new_password.length >= 8} text="Al menos 8 caracteres" />
                      <Requirement met={/\d/.test(form.new_password)} text="Al menos un número" />
                    </div>
                  )}
                </div>
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                    Confirmar Nueva Contraseña
                  </label>
                  <input
                    type="password"
                    value={form.confirm_password}
                    onChange={(e) => handleChange("confirm_password", e.target.value)}
                    onBlur={() => setConfirmPasswordTouched(true)}
                    required
                    minLength={8}
                    className={cn(
                      "w-full h-12 px-4 rounded-xl border bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20 focus:border-[var(--brand)]",
                      confirmPasswordTouched && form.confirm_password.length > 0 && form.new_password !== form.confirm_password
                        ? "border-[var(--danger-c)]"
                        : "border-[var(--border)]"
                    )}
                  />
                  {confirmPasswordTouched && form.confirm_password.length > 0 && form.new_password !== form.confirm_password && (
                    <p className="text-xs text-[var(--danger-text)] mt-1.5">Las contraseñas no coinciden.</p>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={passwordLoading}
                  className="h-11 px-6 rounded-xl font-semibold text-sm"
                >
                  {passwordLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Cambiando...
                    </>
                  ) : (
                    "Guardar Cambios"
                  )}
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return content;
}

function Requirement({ met, text }: { met: boolean; text: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", met ? "text-[var(--ok-text)]" : "text-[var(--danger-text)]")}>
      <span className="font-bold">{met ? "✓" : "✗"}</span>
      {text}
    </div>
  );
}
