import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { pricingApi, type PricingConfig as PricingConfigType } from "../api/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

interface FieldDef {
  key: keyof PricingConfigType;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
  format: "currency" | "multiplier";
}

const FIELDS: FieldDef[] = [
  { key: "base_fare",                         label: "Tarifa base",                  hint: "Precio inicial fijo aplicado a todo envío.",                                          step: 50, min: 0, max: Number.MAX_SAFE_INTEGER, format: "currency" },
  { key: "cost_per_km",                       label: "Costo por km",                 hint: "Se suma al precio base según los kilómetros entre origen y destino.",                  step: 1,  min: 0, max: Number.MAX_SAFE_INTEGER, format: "currency" },
  { key: "weight_surcharge_mid",              label: "Recargo peso 5–25 kg",         hint: "Suma fija cuando el envío pesa entre 5 y 25 kg.",                                     step: 50, min: 0, max: Number.MAX_SAFE_INTEGER, format: "currency" },
  { key: "weight_surcharge_high",             label: "Recargo peso > 25 kg",         hint: "Suma fija cuando el envío supera los 25 kg.",                                         step: 50, min: 0, max: Number.MAX_SAFE_INTEGER, format: "currency" },
  { key: "last_mile_surcharge",               label: "Costo adicional última milla", hint: "Suma fija cuando el método de entrega es entrega a domicilio (última milla).",         step: 50, min: 0, max: Number.MAX_SAFE_INTEGER, format: "currency" },
  { key: "risky_zone_surcharge",              label: "Recargo por zona peligrosa",   hint: "Suma fija adicional en envíos de última milla cuyo destino esté en una zona de alta severidad. No aplica para retiro en sucursal.", step: 50, min: 0, max: Number.MAX_SAFE_INTEGER, format: "currency" },
  { key: "shipment_express_multiplier",       label: "Multiplicador express",      hint: "Factor aplicado al subtotal cuando el envío es express. Mínimo 1.",                     step: 0.05,  min: 1,   max: 5,      format: "multiplier" },
  { key: "time_window_restrictive_multiplier", label: "Multiplicador ventana restrictiva", hint: "Aplica a ventanas Mañana y Tarde (no a Flexible). Ej: 1.10 = +10% al subtotal.", step: 0.01, min: 1, max: 5, format: "multiplier" },
  { key: "fragile_multiplier",                 label: "Multiplicador frágil",             hint: "Aplica al subtotal cuando el envío está marcado como frágil. Ej: 1.20 = +20%.", step: 0.01, min: 1, max: 5, format: "multiplier" },
];

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] transition-all w-36 tabular-nums";

function formatHint(value: number, fmt: FieldDef["format"]): string {
  if (fmt === "currency") return `$${value.toLocaleString("es-AR")}`;
  return `× ${value.toFixed(2)}`;
}

export function PricingConfig() {
  const [config, setConfig] = useState<PricingConfigType | null>(null);
  const [draft, setDraft] = useState<PricingConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    pricingApi
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setDraft(cfg);
      })
      .catch(() => setError("No se pudo cargar la configuración de precios."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const updated = await pricingApi.updateConfig(draft);
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
    draft !== null &&
    config !== null &&
    FIELDS.some((f) => draft[f.key] !== config[f.key]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : draft && (
        <Card>
          <CardHeader>
            <CardTitle>Parámetros del cálculo</CardTitle>
            <CardDescription>Editá los valores y guardá los cambios. Los envíos ya creados conservan su precio original.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {FIELDS.map((field) => (
              <div key={field.key} className="grid gap-2">
                <label className="text-sm font-semibold text-slate-700">{field.label}</label>
                <p className="text-xs text-slate-500 leading-relaxed -mt-1">{field.hint}</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step={field.step}
                    min={field.min}
                    max={field.max}
                    value={draft[field.key]}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, [field.key]: Number(e.target.value) } : d))
                    }
                    className={inputClass}
                  />
                  <span className="text-xs font-semibold text-[var(--sidebar-bg)] tabular-nums">{formatHint(draft[field.key], field.format)}</span>
                </div>
              </div>
            ))}

            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Tarifario actualizado correctamente.
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="h-10 px-5 rounded-lg bg-[var(--sidebar-bg)] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
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
