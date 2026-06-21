import { useEffect, useState } from "react";
import { NeuralBranchNetwork } from "@/components/NeuralBranchNetwork";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useOrganizationTheme } from "@/context/OrganizationThemeContext";
import { authApi } from "@/api/auth";
import { AlertCircle, CheckCircle2, ChevronDown, Truck, Package, MapPin } from "lucide-react";
import { publicTrackingApi, type PublicStats } from "@/api/publicTracking";
import { passwordResetApi } from "@/api/passwordReset";
import { Button } from "@/components/ui/button";

const STAT_LABELS: { key: keyof PublicStats; label: string }[] = [
  { key: "total_shipments", label: "Envíos gestionados" },
  { key: "in_transit", label: "En tránsito" },
  { key: "active_branches", label: "Sucursales activas" },
];

const TEST_USERS = [
  { u: "op_caba", p: "op_caba123", r: "Operador", branch: "CABA" },
  { u: "sup_caba", p: "sup_caba123", r: "Supervisor", branch: "CABA" },
  { u: "op_cordoba", p: "op_cordoba123", r: "Operador", branch: "Córdoba" },
  { u: "sup_cordoba", p: "sup_cordoba123", r: "Supervisor", branch: "Córdoba" },
  { u: "op_mendoza", p: "op_mendoza123", r: "Operador", branch: "Mendoza" },
  { u: "sup_mendoza", p: "sup_mendoza123", r: "Supervisor", branch: "Mendoza" },
  { u: "op_posadas", p: "op_posadas123", r: "Operador", branch: "Posadas" },
  { u: "sup_santa_cruz", p: "sup_santacruz123", r: "Supervisor", branch: "Santa Cruz" },
  { u: "gerente", p: "gerente123", r: "Gerente", branch: "" },
  { u: "admin", p: "admin123", r: "Admin", branch: "" },
  { u: "chofer_caba", p: "chofer_caba123", r: "Chofer Última milla", branch: "CABA" },
  { u: "chofer_caba2", p: "chofer_caba2123", r: "Chofer Última milla", branch: "CABA" },
  { u: "chofer_cordoba", p: "chofer_cordoba123", r: "Chofer Última milla", branch: "Córdoba" },
  { u: "chofer_mendoza", p: "chofer_mendoza123", r: "Chofer Última milla", branch: "Mendoza" },
  { u: "chofer_posadas", p: "chofer_posadas123", r: "Chofer Última milla", branch: "Posadas" },
  { u: "chofer_inter_1", p: "chofer_inter_1_123", r: "Chofer Intersucursal", branch: "" },
  { u: "chofer_inter_2", p: "chofer_inter_2_123", r: "Chofer Intersucursal", branch: "" },
];

const ROLE_STYLES: Record<string, string> = {
  "Operador": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "Supervisor": "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  "Gerente": "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  "Admin": "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  "Chofer Última milla": "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  "Chofer Intersucursal": "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
};

const FEATURES = [
  { icon: Truck, text: "Seguimiento en tiempo real de envíos" },
  { icon: Package, text: "Gestión de flota y vehículos" },
  { icon: MapPin, text: "Control por sucursal y región" },
];

type ResetStep = "idle" | "username" | "otp";

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const INPUT_CLASS =
  "w-full h-12 px-4 rounded-lg border border-blue-200 dark:bg-gray-800 bg-white dark:border-gray-600 text-sm dark:text-gray-100 text-gray-900 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all";

const SPINNER = (
  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
  </svg>
);

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTestUsers, setShowTestUsers] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const navigate = useNavigate();
  const { setToken, setUser } = useAuth();
  const { config } = useOrganizationTheme();
  const logoUrl = config?.logo_url?.trim();
  const orgName = config?.name?.trim() || "LogiTrack";

  const [resetStep, setResetStep] = useState<ResetStep>("idle");
  const [resetUsername, setResetUsername] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(300);
  const [confirmTouched, setConfirmTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicTrackingApi.getStats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => { /* el panel muestra "—" si falla */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (resetStep !== "otp") return;
    setOtpSecondsLeft(300);
    const interval = setInterval(() => {
      setOtpSecondsLeft((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resetStep]);

  // En el handleSubmit, reemplaza TODO el bloque de 2FA (línea ~113-170)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      console.log('🔵 Intentando login...');
      const response = await authApi.login(username, password);
      console.log('🔵 Response completa:', response);

      // ══════════════════════════════════════════════
      // CASO 1: Usuario SIN 2FA (debe activarlo) — chequear ANTES que requires_2fa
      // ══════════════════════════════════════════════
      if (response && response.user) {
        const user = response.user;
        const adminRoles = ['admin', 'manager', 'supervisor', 'operator'];

        if (adminRoles.includes(user.role) && !user.two_fa_enabled) {
          
          sessionStorage.removeItem("pending_2fa_setup");
          sessionStorage.removeItem("temp_token");
          sessionStorage.removeItem("temp_user");
          sessionStorage.removeItem("2fa_setup_cooldown");

          sessionStorage.setItem("pending_2fa_setup", "true");
          sessionStorage.setItem("temp_token", response.token!);
          sessionStorage.setItem("temp_user", JSON.stringify(user));
          navigate("/2fa/setup-required");
          return;
        }
      }

      // ══════════════════════════════════════════════
      // CASO 2: Usuario CON 2FA ya activado
      // ══════════════════════════════════════════════
      if (response && response.requires_2fa) {
        console.log('✅ Usuario tiene 2FA activo - redirigiendo a verificación');
        navigate("/2fa/verify", {
          state: { session_token: response.session_token }
        });
        return;
      }

      // ══════════════════════════════════════════════
      // CASO 3: Login normal (drivers o usuarios sin 2FA requerido)
      // ══════════════════════════════════════════════
      console.log('✅ Login normal - guardando en context');
      localStorage.setItem("token", response.token!);
      localStorage.setItem("user", JSON.stringify(response.user));
      setToken(response.token!);
      setUser(response.user!);
      navigate("/");

    } catch (e: unknown) {
      console.error('❌ Error en login:', e);
      const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(code === "account_inactive" ? "inactive" : "credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    setResetLoading(true);
    setResetError("");
    let advance = true;
    try {
      await passwordResetApi.request(resetUsername, "email");
    } catch (e: unknown) {
      if ((e as Error).message === "rate_limited") {
        setResetError("Demasiados intentos. Esperá unos minutos antes de volver a intentarlo.");
        advance = false;
      }
      // otros errores: avanzar igual (mensaje genérico)
    } finally {
      setResetLoading(false);
    }
    if (advance) setResetStep("otp");
  };

  const handleConfirmReset = async () => {
    setResetLoading(true);
    setResetError("");
    try {
      await passwordResetApi.confirm(resetUsername, resetOtp, resetNewPassword);
      setResetSuccess(true);
      setTimeout(() => {
        setResetStep("idle");
        setResetUsername("");
        setResetOtp("");
        setResetNewPassword("");
        setResetConfirmPassword("");
        setResetError("");
        setResetSuccess(false);
        setConfirmTouched(false);
      }, 2000);
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("inválido") || msg.includes("expirado") || msg.includes("utilizado")) {
        setResetError("El código es incorrecto, ya fue utilizado o expiró. Solicitá uno nuevo.");
      } else if (msg.includes("8 caracteres") || msg.includes("weak")) {
        setResetError("La contraseña debe tener al menos 8 caracteres.");
      } else {
        setResetError("Ocurrió un error. Intentá de nuevo.");
      }
    } finally {
      setResetLoading(false);
    }
  };

  const passwordsMatch = resetNewPassword === resetConfirmPassword;
  const confirmValidationMsg: string | null = confirmTouched
    ? resetConfirmPassword.length > 0 && !passwordsMatch
      ? "Las contraseñas no coinciden."
      : null
    : null;

  const canConfirm =
    resetOtp.length === 6 &&
    resetNewPassword.length >= 8 &&
    /\d/.test(resetNewPassword) &&
    passwordsMatch &&
    !resetLoading;

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_480px] bg-gradient-to-br from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">

      {/* ── Panel izquierdo — branding ── */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[var(--sidebar-bg)] relative overflow-hidden">

        {/* Red neuronal interactiva — sucursales interconectadas que siguen al mouse */}
        <NeuralBranchNetwork />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:48px_48px]" />

        {/* Círculos de fondo */}
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-[var(--brand)]/5 -translate-x-1/2 translate-y-1/2" />
        <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-[var(--accent)]/5 translate-x-1/2 -translate-y-1/2" />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={orgName}
              className="w-9 h-9 rounded-xl object-contain bg-white/10 shadow-lg"
            />
          ) : (
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Truck className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <span className="font-bold text-white text-lg tracking-tight">{orgName}</span>
            <div className="text-[10px] text-blue-300 font-medium tracking-widest uppercase -mt-0.5">Sistema logístico</div>
          </div>
        </div>

        {/* Copy */}
        <div className="relative space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-white leading-[1.15] tracking-tight">
              Gestión logística<br />
              <span className="text-orange-500">centralizada</span>
            </h1>
            <p className="dark:text-gray-500 text-slate-400 text-base leading-relaxed max-w-sm">
              Coordiná envíos, flota y sucursales desde una sola plataforma con control de acceso por rol.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-blue-300" />
                </div>
                <span className="text-sm text-slate-300">{text}</span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/10">
            {STAT_LABELS.map(({ key, label }) => (
              <div key={key}>
                <div className="text-2xl font-bold text-white tabular-nums">
                  {stats ? stats[key].toLocaleString("es-AR") : "—"}
                </div>
                <div className="text-xs dark:text-gray-400 text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs dark:text-gray-400 text-slate-600">
          UNGS · Laboratorio de Construcción de Software · 2026
        </p>
      </div>

      {/* ── Panel derecho ── */}
      <div className="flex items-center justify-center p-6 dark:bg-gray-800 bg-white border-l dark:border-gray-700 border-slate-200">
        <div className="w-full max-w-[360px] space-y-7">

          {/* Logo mobile */}
          <div className="flex items-center gap-2.5 lg:hidden">
            {logoUrl ? (
              <img src={logoUrl} alt={orgName} className="w-8 h-8 rounded-xl object-contain" />
            ) : (
              <div className="w-8 h-8 bg-orange-500 rounded-xl flex items-center justify-center">
                <Truck className="w-4 h-4 text-white" />
              </div>
            )}
            <span className="font-bold text-[var(--text-heading)] text-base">{orgName}</span>
          </div>

          {/* ─── Login ─── */}
          {resetStep === "idle" && (
            <>
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold text-[var(--text-heading)] tracking-tight">Bienvenido</h2>
                <p className="text-sm dark:text-gray-400 text-gray-500">Ingresá tus credenciales para continuar</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="username" className="text-sm font-semibold dark:text-gray-300 text-gray-700">
                    Usuario
                  </label>
                  <input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="ej. op_caba"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-sm font-semibold dark:text-gray-300 text-gray-700">
                    Contraseña
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={INPUT_CLASS}
                  />
                </div>

                {error === "credentials" && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-sm text-red-700">Usuario o contraseña incorrectos.</p>
                  </div>
                )}

                {error === "inactive" && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-700">Cuenta inactiva</p>
                      <p className="text-xs text-red-600 mt-0.5">Contactá con un administrador para reactivarla.</p>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  variant="default"
                  className="w-full h-12 rounded-xl text-sm font-semibold shadow-sm shadow-blue-500/20"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      {SPINNER}
                      Ingresando...
                    </span>
                  ) : "Ingresar"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => { setResetStep("username"); setResetError(""); }}
                className="w-full text-sm text-blue-600 dark:text-blue-400 hover:underline text-center mt-1 cursor-pointer"
              >
                ¿Olvidaste tu contraseña?
              </button>

              {/* Cuentas de prueba */}
              <div className="rounded-xl border dark:border-gray-700 border-slate-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowTestUsers(!showTestUsers)}
                  className="w-full flex items-center justify-between px-4 py-3 dark:bg-gray-800/50 bg-slate-50 dark:hover:bg-gray-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <span className="text-xs font-semibold dark:text-gray-400 text-slate-500 uppercase tracking-wider">
                    Cuentas de prueba
                  </span>
                  <ChevronDown className={`w-4 h-4 dark:text-gray-500 text-slate-400 transition-transform duration-200 ${showTestUsers ? "rotate-180" : ""}`} />
                </button>

                {showTestUsers && (
                  <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {TEST_USERS.map(({ u, p, r }) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => { setUsername(u); setPassword(p); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 dark:hover:bg-gray-700 hover:bg-slate-50 transition-colors text-left cursor-pointer group"
                      >
                        <span className="text-xs font-semibold dark:text-gray-300 text-gray-800 group-hover:text-blue-600 transition-colors">{u}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${ROLE_STYLES[r]}`}>
                          {r}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ─── Paso 1: Usuario ─── */}
          {resetStep === "username" && (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold text-[var(--text-heading)] tracking-tight">Recuperar contraseña</h2>
                <p className="text-sm dark:text-gray-400 text-gray-500">Ingresá tu nombre de usuario</p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSendCode(); }} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="reset-username" className="text-sm font-semibold dark:text-gray-300 text-gray-700">
                    Usuario
                  </label>
                  <input
                    id="reset-username"
                    value={resetUsername}
                    onChange={(e) => setResetUsername(e.target.value)}
                    autoFocus
                    autoComplete="username"
                    placeholder="ej. op_caba"
                    className={INPUT_CLASS}
                  />
                </div>

                {resetError && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-sm text-red-700">{resetError}</p>
                  </div>
                )}

                <Button
                  type="button"
                  disabled={!resetUsername.trim() || resetLoading}
                  onClick={handleSendCode}
                  variant="default"
                  className="w-full h-12 rounded-xl text-sm font-semibold shadow-sm shadow-blue-500/20"
                >
                  {resetLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      {SPINNER}
                      Enviando...
                    </span>
                  ) : "Enviar código"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => setResetStep("idle")}
                className="w-full text-sm dark:text-gray-400 text-slate-500 dark:hover:text-gray-200 hover:text-slate-700 text-center cursor-pointer"
              >
                ← Volver al login
              </button>
            </div>
          )}

          {/* ─── Paso 3: OTP ─── */}
          {resetStep === "otp" && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold text-[var(--text-heading)] tracking-tight">Ingresá el código</h2>
                <p className="text-sm dark:text-gray-400 text-gray-500">
                  Revisá tu casilla de correo
                </p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm text-blue-700">
                  Te enviamos un código a tu casilla de correo. Revisá también la carpeta de spam.
                </p>
              </div>

              {resetSuccess ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-700">¡Contraseña actualizada! Ya podés iniciar sesión.</p>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (canConfirm) handleConfirmReset(); }} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="otp-code" className="text-sm font-semibold dark:text-gray-300 text-gray-700">
                      Código de verificación
                    </label>
                    <input
                      id="otp-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={resetOtp}
                      onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      autoFocus
                      className="w-full h-14 px-4 rounded-lg border border-blue-200 dark:border-gray-600 dark:bg-gray-800 bg-white font-mono text-center text-2xl tracking-widest dark:text-gray-100 text-gray-900 placeholder:text-gray-300 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                    />
                  </div>

                  <p className={`text-xs text-center ${otpSecondsLeft === 0 ? "text-red-600 font-medium" : "dark:text-gray-500 text-slate-400"}`}>
                    {otpSecondsLeft > 0
                      ? `El código expira en ${formatCountdown(otpSecondsLeft)}`
                      : "El código expiró."}
                  </p>

                  <div className="space-y-1.5">
                    <label htmlFor="new-password" className="text-sm font-semibold dark:text-gray-300 text-gray-700">
                      Nueva contraseña
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className={INPUT_CLASS}
                    />
                    {resetNewPassword.length > 0 && (() => {
                      const ok8 = resetNewPassword.length >= 8;
                      const okNum = /\d/.test(resetNewPassword);
                      const item = (met: boolean, text: string) => (
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${met ? "text-green-700" : "text-red-600"}`}>
                          <span className="font-bold">{met ? "✓" : "✗"}</span>
                          {text}
                        </div>
                      );
                      return (
                        <div className="flex flex-col gap-1 mt-1.5 px-3 py-2 dark:bg-gray-800/50 bg-slate-50 border dark:border-gray-700 border-slate-200 rounded-lg">
                          {item(ok8, "Al menos 8 caracteres")}
                          {item(okNum, "Al menos un número")}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="confirm-password" className="text-sm font-semibold dark:text-gray-300 text-gray-700">
                      Confirmar contraseña
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      value={resetConfirmPassword}
                      onChange={(e) => setResetConfirmPassword(e.target.value)}
                      onBlur={() => setConfirmTouched(true)}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className={`${INPUT_CLASS} ${confirmValidationMsg ? "border-red-300 focus:border-red-400 focus:ring-red-200/30" : ""}`}
                    />
                    {confirmValidationMsg && (
                      <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 mt-1.5">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                        <p className="text-sm text-red-700">{confirmValidationMsg}</p>
                      </div>
                    )}
                  </div>

                  {resetError && (
                    <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                      <p className="text-sm text-red-700">{resetError}</p>
                    </div>
                  )}

                  <Button
                    type="button"
                    disabled={!canConfirm}
                    onClick={handleConfirmReset}
                    variant="default"
                    className="w-full h-12 rounded-xl text-sm font-semibold shadow-sm shadow-blue-500/20"
                  >
                    {resetLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        {SPINNER}
                        Confirmando...
                      </span>
                    ) : "Confirmar"}
                  </Button>

                  <button
                    type="button"
                    disabled={otpSecondsLeft > 0}
                    onClick={() => { setResetError(""); setResetStep("username"); }}
                    className="w-full text-sm text-center disabled:text-slate-300 disabled:cursor-not-allowed text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Reenviar código
                  </button>
                </form>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
