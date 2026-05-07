import { useEffect, useState } from "react";
import { Route, AlertCircle, CheckCircle2 } from "lucide-react";
import { routingApi, type RoutingConfig as RoutingConfigType } from "../api/routing";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

interface NumberFieldDef {
  key: keyof RoutingConfigType;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
  format: "hours" | "ratio" | "count" | "kg";
}

const FIELDS: NumberFieldDef[] = [
  {
    key: "sla_force_horizon_hours",
    label: "Horizonte SLA (horas)",
    hint: "Si la fecha de entrega prometida está dentro de este lapso, el envío fuerza el despacho aunque el vehículo no esté lleno.",
    step: 1,
    min: 1,
    max: 168,
    format: "hours",
  },
  {
    key: "priority_force_threshold",
    label: "Umbral de prioridad para forzar",
    hint: "Si el priority_score del envío supera este valor, fuerza despacho. 0.75 ≈ alta prioridad.",
    step: 0.05,
    min: 0,
    max: 1,
    format: "ratio",
  },
  {
    key: "min_fill_rate",
    label: "Tasa mínima de carga (%)",
    hint: "Porcentaje mínimo de capacidad del vehículo más grande que debe llenarse para consolidar el viaje. Por debajo, los envíos esperan.",
    step: 0.05,
    min: 0.1,
    max: 1,
    format: "ratio",
  },
  {
    key: "max_shipments_per_driver",
    label: "Envíos máximos por chofer",
    hint: "Tope de envíos asignables a un chofer en su ruta de última milla del día.",
    step: 1,
    min: 1,
    max: 100,
    format: "count",
  },
  {
    key: "max_weight_kg_per_driver",
    label: "Peso máximo por chofer (kg)",
    hint: "Tope de peso total acumulable en la ruta de un chofer.",
    step: 5,
    min: 1,
    max: 5000,
    format: "kg",
  },
];

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all w-36 tabular-nums";

function formatHint(value: number, fmt: NumberFieldDef["format"]): string {
  switch (fmt) {
    case "hours":
      return `${value} h`;
    case "ratio":
      return `${(value * 100).toFixed(0)}%`;
    case "count":
      return `${value} envíos`;
    case "kg":
      return `${value} kg`;
  }
}

export function RoutingConfig() {
  const [config, setConfig] = useState<RoutingConfigType | null>(null);
  const [draft, setDraft] = useState<RoutingConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    routingApi
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setDraft(cfg);
      })
      .catch(() => setError("No se pudo cargar la configuración de ruteo."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const updated = await routingApi.updateConfig(draft);
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
      <PageHeader
        title="Configuración de ruteo"
        description="Parámetros del algoritmo de planificación diario. Los cambios afectan los planes generados a partir de ahora."
        icon={<Route className="w-5 h-5" />}
      />

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : draft && (
        <Card>
          <CardHeader>
            <CardTitle>Reglas del planificador</CardTitle>
            <CardDescription>
              Estos parámetros controlan cuándo el algoritmo despacha un vehículo y cómo bin-packea los envíos por chofer.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {FIELDS.map((field) => {
              const value = draft[field.key] as number;
              return (
                <div key={field.key} className="grid gap-2">
                  <label className="text-sm font-semibold text-slate-700">{field.label}</label>
                  <p className="text-xs text-slate-500 leading-relaxed -mt-1">{field.hint}</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      step={field.step}
                      min={field.min}
                      max={field.max}
                      value={value}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, [field.key]: Number(e.target.value) } : d))
                      }
                      className={inputClass}
                    />
                    <span className="text-xs font-semibold text-[#1e3a5f] tabular-nums">
                      {formatHint(value, field.format)}
                    </span>
                  </div>
                </div>
              );
            })}

            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Configuración actualizada.
              </div>
            )}

            <div className="flex gap-2 pt-2">
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
