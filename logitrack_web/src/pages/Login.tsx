import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, ChevronDown, Truck, Package, MapPin } from "lucide-react";

const TEST_USERS = [
  { u: "op_caba",        p: "op_caba123",        r: "Operador",    branch: "CABA" },
  { u: "sup_caba",       p: "sup_caba123",        r: "Supervisor",  branch: "CABA" },
  { u: "op_cordoba",     p: "op_cordoba123",      r: "Operador",    branch: "Córdoba" },
  { u: "sup_cordoba",    p: "sup_cordoba123",      r: "Supervisor",  branch: "Córdoba" },
  { u: "op_mendoza",     p: "op_mendoza123",      r: "Operador",    branch: "Mendoza" },
  { u: "sup_mendoza",    p: "sup_mendoza123",      r: "Supervisor",  branch: "Mendoza" },
  { u: "gerente",        p: "gerente123",          r: "Gerente",     branch: "" },
  { u: "admin",          p: "admin123",            r: "Admin",       branch: "" },
  { u: "chofer_caba",    p: "chofer_caba123",      r: "Chofer",      branch: "CABA" },
  { u: "chofer_cordoba", p: "chofer_cordoba123",   r: "Chofer",      branch: "Córdoba" },
  { u: "chofer_mendoza", p: "chofer_mendoza123",   r: "Chofer",      branch: "Mendoza" },
];

const ROLE_STYLES: Record<string, string> = {
  "Operador":   "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "Supervisor": "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  "Gerente":    "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  "Admin":      "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  "Chofer":     "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
};

const FEATURES = [
  { icon: Truck,   text: "Seguimiento en tiempo real de envíos" },
  { icon: Package, text: "Gestión de flota y vehículos" },
  { icon: MapPin,  text: "Control por sucursal y región" },
];

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTestUsers, setShowTestUsers] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      navigate("/");
    } catch (e: unknown) {
      const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(code === "account_inactive" ? "inactive" : "credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_480px] bg-[#eff6ff]">

      {/* ── Panel izquierdo — branding ── */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#1e3a5f] relative overflow-hidden">

        {/* Grid decorativo */}
        <div className="absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "48px 48px"
          }}
        />

        {/* Círculos de fondo */}
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-blue-500/5 -translate-x-1/2 translate-y-1/2" />
        <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-[#f97316]/5 translate-x-1/2 -translate-y-1/2" />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-9 h-9 bg-[#f97316] rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-white text-lg tracking-tight">LogiTrack</span>
            <div className="text-[10px] text-blue-300 font-medium tracking-widest uppercase -mt-0.5">Sistema logístico</div>
          </div>
        </div>

        {/* Copy */}
        <div className="relative space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-white leading-[1.15] tracking-tight">
              Gestión logística<br />
              <span className="text-[#f97316]">centralizada</span>
            </h1>
            <p className="text-slate-400 text-base leading-relaxed max-w-sm">
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
            {[
              { n: "6",  label: "Sucursales" },
              { n: "12", label: "Estados" },
              { n: "5",  label: "Roles" },
            ].map(({ n, label }) => (
              <div key={label}>
                <div className="text-2xl font-bold text-white">{n}</div>
                <div className="text-xs text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-slate-600">
          UNGS · Laboratorio de Construcción de Software · 2026
        </p>
      </div>

      {/* ── Panel derecho — formulario ── */}
      <div className="flex items-center justify-center p-6 bg-white border-l border-slate-200">
        <div className="w-full max-w-[360px] space-y-7">

          {/* Logo mobile */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="w-8 h-8 bg-[#f97316] rounded-xl flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-[#1e3a5f] text-base">LogiTrack</span>
          </div>

          {/* Encabezado */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Bienvenido</h2>
            <p className="text-sm text-gray-500">Ingresá tus credenciales para continuar</p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1.5">
              <label htmlFor="username" className="text-sm font-semibold text-gray-700">
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
                className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] focus:bg-white transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-semibold text-gray-700">
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
                className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] focus:bg-white transition-all"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-sm shadow-blue-500/20 cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Ingresando...
                </span>
              ) : "Ingresar"}
            </button>
          </form>

          {/* Cuentas de prueba */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowTestUsers(!showTestUsers)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Cuentas de prueba
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showTestUsers ? "rotate-180" : ""}`} />
            </button>

            {showTestUsers && (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {TEST_USERS.map(({ u, p, r, branch }) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => { setUsername(u); setPassword(p); }}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors text-left cursor-pointer group"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-gray-800 group-hover:text-[#2563eb] transition-colors">{u}</span>
                      <span className="text-xs text-gray-400 ml-2">{p}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${ROLE_STYLES[r]}`}>
                        {r}
                      </span>
                      {branch && <span className="text-[10px] text-slate-400">{branch}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
