import { useEffect, useState } from "react";
import { Route, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { routingApi, type RoutingConfig as RoutingConfigType, type GlobalPlanLog } from "../api/routing";
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
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GlobalPlanLog | null>(null);
  const [generateError, setGenerateError] = useState("");

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
    (FIELDS.some((f) => draft[f.key] !== config[f.key]) ||
      draft.enforce_time_windows !== config.enforce_time_windows);

  const handleGenerateGlobal = async () => {
    setGenerating(true);
    setGenerateError("");
    setGenerateResult(null);
    try {
      const res = await routingApi.regenerateGlobal();
      setGenerateResult(res.log);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo generar el plan.";
      setGenerateError(msg);
    } finally {
      setGenerating(false);
    }
  };

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
            {/* Toggle ventanas duras/blandas */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Cumplimiento estricto de ventanas horarias</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                Si está activo, los envíos cuya hora estimada de llegada cae fuera de su ventana (mañana/tarde) quedan sin asignar.
                Si está inactivo, se incluyen en la ruta con un aviso para que el operador decida.
              </p>
              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={draft?.enforce_time_windows ?? true}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, enforce_time_windows: e.target.checked } : d))
                    }
                  />
                  <div
                    className={`w-10 h-6 rounded-full transition-colors ${
                      draft?.enforce_time_windows ? "bg-[#1e3a5f]" : "bg-slate-200"
                    }`}
                  />
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      draft?.enforce_time_windows ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </div>
                <span className="text-sm text-slate-700">
                  {draft?.enforce_time_windows ? "Activo (ventanas duras)" : "Inactivo (ventanas blandas)"}
                </span>
              </label>
            </div>

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

      {/* Generación manual del plan global — backup por si falla el cron */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Generación manual del plan global</CardTitle>
          <CardDescription>
            El plan se genera automáticamente a las 08:00. Usá este botón solo si el cron
            falló o necesitás forzar una regeneración completa de toda la red.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {generateError && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {generateError}
            </div>
          )}
          {generateResult && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Plan generado: <strong>{generateResult.total_assigned}</strong> envíos asignados,{" "}
              <strong>{generateResult.total_unassigned}</strong> sin asignar en{" "}
              <strong>{generateResult.total_branches}</strong> sucursales.
            </div>
          )}
          <div>
            <button
              onClick={handleGenerateGlobal}
              disabled={generating}
              className="h-10 px-5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Generando plan…" : "Generar plan global ahora"}
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Sobreescribe el plan del día para todas las sucursales activas.
              No deshace lo que ya fue aplicado.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
