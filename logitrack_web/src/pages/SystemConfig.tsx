import { useState, useEffect } from "react";
import { Settings, AlertCircle, CheckCircle2, Minus, Plus } from "lucide-react";
import { systemConfigApi, type SystemConfig as SystemConfigType } from "../api/systemConfig";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

export function SystemConfig() {
  const [config, setConfig] = useState<SystemConfigType | null>(null);
  const [draft, setDraft] = useState<SystemConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    systemConfigApi
      .get()
      .then((cfg) => {
        setConfig(cfg);
        setDraft(cfg);
      })
      .catch(() => setError("No se pudo cargar la configuración."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const updated = await systemConfigApi.update(draft);
      setConfig(updated);
      setDraft(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo guardar la configuración.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    draft !== null && config !== null &&
    draft.max_delivery_attempts !== config.max_delivery_attempts;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PageHeader
        title="Configuración del sistema"
        description="Parámetros operativos globales del sistema logístico."
        icon={<Settings className="w-5 h-5" />}
      />

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : draft && (
        <Card>
          <CardHeader>
            <CardTitle>Intentos de entrega</CardTitle>
            <CardDescription>
              Cantidad máxima de intentos fallidos antes de que el envío pase automáticamente a <strong>Listo para retiro en mostrador</strong>. Rango permitido: 1–10.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-5">
              <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                Máximo de intentos fallidos
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      d ? { ...d, max_delivery_attempts: Math.max(1, d.max_delivery_attempts - 1) } : d
                    )
                  }
                  disabled={draft.max_delivery_attempts <= 1}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                >
                  <Minus className="w-4 h-4 text-slate-700" />
                </button>
                <span className="min-w-[40px] text-center text-2xl font-extrabold text-[#1e3a5f] tabular-nums">
                  {draft.max_delivery_attempts}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      d ? { ...d, max_delivery_attempts: Math.min(10, d.max_delivery_attempts + 1) } : d
                    )
                  }
                  disabled={draft.max_delivery_attempts >= 10}
                  className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                >
                  <Plus className="w-4 h-4 text-slate-700" />
                </button>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={draft.max_delivery_attempts}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, max_delivery_attempts: Number(e.target.value) } : d
                    )
                  }
                  className="w-32 accent-[#1e3a5f]"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 mb-3 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 mb-3 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Configuración guardada correctamente.
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {isDirty && (
                <button
                  onClick={() => setDraft(config)}
                  disabled={saving}
                  className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
                >
                  Descartar
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
