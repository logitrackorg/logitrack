import { useState, useEffect } from "react";
import { Building, AlertCircle, CheckCircle2 } from "lucide-react";
import { organizationApi, type OrganizationConfig as OrganizationConfigType } from "../api/organizationApi";
import { fmtDateTime } from "../utils/date";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

const inputClass =
  "w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

const labelClass = "text-sm font-semibold text-slate-700";

export function OrganizationConfig() {
  const [config, setConfig] = useState<OrganizationConfigType | null>(null);
  const [form, setForm] = useState({ name: "", cuit: "", address: "", phone: "", email: "", business_hours: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    organizationApi.get().then((cfg) => {
      setConfig(cfg);
      setForm({
        name: cfg.name ?? "",
        cuit: cfg.cuit ?? "",
        address: cfg.address ?? "",
        phone: cfg.phone ?? "",
        email: cfg.email ?? "",
        business_hours: cfg.business_hours ?? "",
      });
    }).catch(() => {
      setError("No se pudo cargar la configuración de la organización.");
    }).finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const updated = await organizationApi.update(form);
      setConfig(updated);
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
      <PageHeader
        title="Organización"
        description="Información que aparece en los comprobantes de alta de envíos generados por el sistema."
        icon={<Building className="w-5 h-5" />}
      />

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
              <label className={labelClass}>Horarios de atención</label>
              <input
                className={inputClass}
                value={form.business_hours}
                onChange={(e) => setForm({ ...form, business_hours: e.target.value })}
                placeholder="Ej: Lun a Vie 9–18 hs, Sáb 9–13 hs"
              />
              <p className="text-xs text-slate-400">Se incluye en el email de notificación de retiro en sucursal.</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors w-fit"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </CardContent>
        </Card>
      </form>

      {config?.updated_at && config.updated_by && (
        <p className="mt-3 text-xs text-slate-400">
          Última actualización: {fmtDateTime(config.updated_at)} por <strong className="text-slate-600">{config.updated_by}</strong>
        </p>
      )}
    </div>
  );
}
