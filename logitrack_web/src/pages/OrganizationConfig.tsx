import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Palette, RotateCcw } from "lucide-react";
import { organizationApi, type OrganizationConfig as OrganizationConfigType } from "../api/organizationApi";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";
import { fmtDateTime } from "../utils/date";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { ThemePreview } from "../components/ThemePreview";
import { PALETTES } from "../data/palettes";

const inputClass =
  "w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500";

const labelClass = "text-sm font-semibold text-slate-700 dark:text-slate-300";

const colorPickerClass =
  "w-full h-10 px-2 rounded-lg border border-slate-200 bg-white cursor-pointer dark:bg-slate-800 dark:border-slate-600";

export function OrganizationConfig() {
  const [config, setConfig] = useState<OrganizationConfigType | null>(null);
  const [form, setForm] = useState({
    name: "", cuit: "", address: "", phone: "", email: "", track_url: "",
    primary_color: "", accent_color: "", sidebar_color: "", logo_url: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { refreshTheme, resetTheme } = useOrganizationTheme();

  useEffect(() => {
    organizationApi.get().then((cfg) => {
      setConfig(cfg);
      setForm({
        name: cfg.name ?? "",
        cuit: cfg.cuit ?? "",
        address: cfg.address ?? "",
        phone: cfg.phone ?? "",
        email: cfg.email ?? "",
        track_url: cfg.track_url ?? "",
        primary_color: cfg.primary_color ?? "",
        accent_color: cfg.accent_color ?? "",
        sidebar_color: cfg.sidebar_color ?? "",
        logo_url: cfg.logo_url ?? "",
      });
    }).catch(() => {
      setError("No se pudo cargar la configuración de la organización.");
    }).finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (form.track_url) {
      try {
        const parsed = new URL(form.track_url);
        if (parsed.protocol !== "https:") throw new Error();
      } catch {
        setError("La URL del portal de tracking debe ser una URL válida y comenzar con https://");
        return;
      }
    }
    setSaving(true);
    try {
      const updated = await organizationApi.update(form);
      setConfig(updated);
      await refreshTheme();
      setSuccess("Configuración guardada correctamente.");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <form onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle>Datos de la empresa</CardTitle>
            <CardDescription>Solo el nombre es obligatorio. Los demás campos son opcionales.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <label className={labelClass}>Nombre de la organización *</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Transportes García S.A."
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <label className={labelClass}>CUIT</label>
                <input
                  className={inputClass}
                  value={form.cuit}
                  onChange={(e) => setForm({ ...form, cuit: e.target.value })}
                  placeholder="Ej: 30-12345678-9"
                />
              </div>
              <div className="grid gap-1.5">
                <label className={labelClass}>Teléfono</label>
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Ej: +54 11 1234-5678"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className={labelClass}>Dirección</label>
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Ej: Av. Corrientes 1234, Buenos Aires"
              />
            </div>

            <div className="grid gap-1.5">
              <label className={labelClass}>Email</label>
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Ej: contacto@empresa.com.ar"
              />
            </div>

            <div className="grid gap-1.5">
              <label className={labelClass}>URL del portal de tracking</label>
              <input
                className={inputClass}
                type="url"
                value={form.track_url}
                onChange={(e) => setForm({ ...form, track_url: e.target.value })}
                placeholder="https://tudominio.com"
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Si está vacío, se usa el valor de la variable de entorno <code className="font-mono">TRACK_BASE_URL</code>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ─── White-labeling ─── */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Apariencia
            </CardTitle>
            <CardDescription>
              Personalizá los colores de la plataforma. Si dejás un campo vacío, se usa el color por defecto de LogiTrack.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <ThemePreview
              primaryColor={form.primary_color || undefined}
              accentColor={form.accent_color || undefined}
              sidebarColor={form.sidebar_color || undefined}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <label className={labelClass}>Color primario</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    className={`${colorPickerClass} w-12 shrink-0`}
                    value={form.primary_color || "#2563eb"}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    placeholder="#2563eb"
                    maxLength={7}
                  />
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Botones, links, focus rings. Default: azul #2563eb</p>
              </div>

              <div className="grid gap-1.5">
                <label className={labelClass}>Color de acento</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    className={`${colorPickerClass} w-12 shrink-0`}
                    value={form.accent_color || "#f97316"}
                    onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    value={form.accent_color}
                    onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                    placeholder="#f97316"
                    maxLength={7}
                  />
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Badges de prioridad, indicadores. Default: naranja #f97316</p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className={labelClass}>Color del sidebar</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  className={`${colorPickerClass} w-12 shrink-0`}
                    value={form.sidebar_color || "#1e3a5f"}
                    onChange={(e) => setForm({ ...form, sidebar_color: e.target.value })}
                  />
                  <input
                    className={inputClass}
                    value={form.sidebar_color}
                    onChange={(e) => setForm({ ...form, sidebar_color: e.target.value })}
                    placeholder="#1e3a5f"
                    maxLength={7}
                  />
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Fondo de la barra lateral. Default: azul oscuro #1e3a5f</p>
            </div>

            {/* Palette selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Paletas sugeridas
              </label>
              <div className="flex flex-wrap gap-3">
                {PALETTES.map((palette) => {
                  const isActive =
                    form.primary_color === palette.primary_color &&
                    form.accent_color === palette.accent_color &&
                    form.sidebar_color === palette.sidebar_color;
                  return (
                    <button
                      key={palette.name}
                      type="button"
                      onClick={() => setForm({
                        ...form,
                        primary_color: palette.primary_color,
                        accent_color: palette.accent_color,
                        sidebar_color: palette.sidebar_color,
                      })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                        isActive
                          ? 'ring-2 ring-offset-1 ring-blue-500 border-blue-500'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      }`}
                      title={palette.name}
                    >
                      <span className="flex -space-x-1">
                        <span className="w-5 h-5 rounded-full border border-white" style={{ background: palette.primary_color }} />
                        <span className="w-5 h-5 rounded-full border border-white" style={{ background: palette.accent_color }} />
                        <span className="w-5 h-5 rounded-full border border-white" style={{ background: palette.sidebar_color }} />
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">{palette.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className={labelClass}>URL del logo</label>
              <input
                className={inputClass}
                value={form.logo_url}
                onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                placeholder="https://tudominio.com/logo.png"
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">Imagen PNG o SVG. Se muestra en el sidebar y la página de login.</p>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setForm({ ...form, primary_color: "", accent_color: "", sidebar_color: "" });
                  resetTheme();
                  setSuccess("Colores restablecidos a los valores por defecto de LogiTrack.");
                  setTimeout(() => setSuccess(null), 3000);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Restablecer colores por defecto
              </button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          className="mt-4 h-10 px-5 rounded-lg bg-[var(--brand-strong)] hover:brightness-110 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-all w-fit"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>

      {config?.updated_at && config.updated_by && (
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Última actualización: {fmtDateTime(config.updated_at)} por <strong className="text-slate-600 dark:text-slate-300">{config.updated_by}</strong>
        </p>
      )}
    </div>
  );
}
