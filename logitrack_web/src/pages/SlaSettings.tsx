import { useEffect, useState } from "react";
import { Gauge, AlertCircle, CheckCircle2, RefreshCw, Power, Clock, Loader2 } from "lucide-react";
import { slaSettingsApi, type SLASettings } from "../api/slaSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

// All active (non-terminal) status codes with their Spanish display names,
// matching the backend's anomalyStatusNames map.
const ALL_STATES: { code: string; label: string }[] = [
  { code: "at_origin_hub",        label: "En sucursal de origen" },
  { code: "at_hub",               label: "En sucursal (intermedia/destino)" },
  { code: "loaded",               label: "Cargado en vehículo" },
  { code: "in_transit",           label: "En tránsito" },
  { code: "out_for_delivery",     label: "Última milla" },
  { code: "delivery_failed",      label: "Entrega fallida" },
  { code: "redelivery_scheduled", label: "Reentrega agendada" },
  { code: "no_entregado",         label: "No entregado" },
  { code: "rechazado",            label: "Rechazado por destinatario" },
  { code: "ready_for_pickup",     label: "Listo para retiro en sucursal" },
  { code: "ready_for_return",     label: "Listo para devolución" },
];

const CEILING_OPTIONS: { value: "media" | "alta"; label: string }[] = [
  { value: "media", label: "Media — detiene el escalado en prioridad Media" },
  { value: "alta",  label: "Alta — permite escalar hasta prioridad Alta (máximo)" },
];

type SaveState = "idle" | "saving" | "success" | "error";

export function SlaSettings() {
  const [settings, setSettings] = useState<SLASettings | null>(null);
  const [draft, setDraft]       = useState<SLASettings | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg]   = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await slaSettingsApi.get();
      setSettings(data);
      setDraft(data);
    } catch {
      setErrorMsg("No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async () => {
    if (!draft) return;
    setSaveState("saving");
    setErrorMsg("");
    try {
      const saved = await slaSettingsApi.update(draft);
      setSettings(saved);
      setDraft(saved);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "No se pudo guardar la configuración.";
      setErrorMsg(msg);
      setSaveState("error");
    }
  };

  const toggleState = (code: string) => {
    if (!draft) return;
    const has = draft.enabled_states.includes(code);
    setDraft({
      ...draft,
      enabled_states: has
        ? draft.enabled_states.filter((s) => s !== code)
        : [...draft.enabled_states, code],
    });
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm dark:text-gray-400 text-slate-500">Cargando configuración…</p>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {errorMsg || "Error al cargar la configuración."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <Gauge className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold dark:text-gray-100 text-slate-900 leading-tight">Motor de Anomalías SLA</h1>
          <p className="text-[12px] dark:text-gray-400 text-slate-500">
            Parámetros del motor de detección y escalado automático de prioridad
          </p>
        </div>
      </div>

      {/* Feedback banners */}
      {saveState === "success" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Configuración guardada exitosamente. Los cambios se aplican en el próximo ciclo del motor.
        </div>
      )}
      {saveState === "error" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* ── Card 1: Umbral de tolerancia ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 border-b dark:border-gray-700 border-slate-100">
          <CardTitle className="text-base">Umbral de tolerancia</CardTitle>
          <CardDescription>
            Multiplicador aplicado al promedio histórico de permanencia en cada estado.
            Un envío es marcado como "Demorado" cuando supera este factor.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1.0}
              max={5.0}
              step={0.1}
              value={draft.tolerance_multiplier}
              onChange={(e) => setDraft({ ...draft, tolerance_multiplier: parseFloat(e.target.value) })}
              className="flex-1 h-2 accent-amber-500"
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min={1.0}
                max={5.0}
                step={0.1}
                value={draft.tolerance_multiplier}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 1.0) setDraft({ ...draft, tolerance_multiplier: v });
                }}
                className="w-20 h-9 text-center text-sm font-semibold border dark:border-gray-700 border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <span className="text-sm dark:text-gray-400 text-slate-500 font-medium">x</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] dark:text-gray-500 text-slate-400">
            Valor actual: el motor actúa cuando el tiempo en estado supera el{" "}
            <strong>{(draft.tolerance_multiplier * 100).toFixed(0)} %</strong> del promedio histórico.
          </p>
        </CardContent>
      </Card>

      {/* ── Card 2: Tope de prioridad ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 border-b dark:border-gray-700 border-slate-100">
          <CardTitle className="text-base">Tope de prioridad</CardTitle>
          <CardDescription>
            Nivel máximo al que el motor puede escalar automáticamente.
            El escalado se detiene cuando un envío alcanza este nivel.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-2">
          {CEILING_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                draft.priority_ceiling === opt.value
                  ? "border-amber-400 bg-amber-50/60"
                  : "dark:border-gray-700 border-slate-200 dark:hover:bg-gray-700 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="priority_ceiling"
                value={opt.value}
                checked={draft.priority_ceiling === opt.value}
                onChange={() => setDraft({ ...draft, priority_ceiling: opt.value })}
                className="mt-0.5 accent-amber-500 shrink-0"
              />
              <div>
                <p className="text-sm font-semibold dark:text-gray-300 text-slate-800 capitalize">{opt.value}</p>
                <p className="text-[11px] dark:text-gray-400 text-slate-500">{opt.label}</p>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* ── Card 3: Estados habilitados ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 border-b dark:border-gray-700 border-slate-100">
          <CardTitle className="text-base">Estados habilitados para evaluación</CardTitle>
          <CardDescription>
            Solo los envíos en los estados marcados serán evaluados por el motor. Debe haber al menos uno seleccionado.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_STATES.map(({ code, label }) => {
              const checked = draft.enabled_states.includes(code);
              return (
                <label
                  key={code}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                    checked
                      ? "border-amber-300 bg-amber-50/50 dark:text-gray-300 text-slate-800"
                      : "dark:border-gray-700 border-slate-200 dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleState(code)}
                    className="accent-amber-500 shrink-0"
                  />
                  <span className="leading-tight">{label}</span>
                </label>
              );
            })}
          </div>
          {draft.enabled_states.length === 0 && (
            <p className="mt-2 text-xs text-rose-600 font-medium">
              ⚠ Debe seleccionar al menos un estado.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Card 4: Modo + Frecuencia de recálculo ──────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 border-b dark:border-gray-700 border-slate-100">
          <CardTitle className="text-base">Modo y frecuencia del Collector</CardTitle>
          <CardDescription>
            Define cómo y cuándo el motor recalcula los promedios históricos de permanencia por estado.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {/* Mode radio buttons */}
          <div className="flex flex-col gap-2">
            {(
              [
                { value: "periodic", label: "Periódico (cada X min)", desc: "El Collector corre en segundo plano cada ciertos minutos, independiente de la repriorización." },
                { value: "daily",    label: "Una vez al día (junto a la repriorización)", desc: "El Collector corre justo antes del Executor a la hora programada. El intervalo de minutos se ignora." },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  (draft.calculation_mode ?? "periodic") === opt.value
                    ? "border-amber-400 bg-amber-50/60"
                    : "dark:border-gray-700 border-slate-200 dark:hover:bg-gray-700 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="calculation_mode"
                  value={opt.value}
                  checked={(draft.calculation_mode ?? "periodic") === opt.value}
                  onChange={() => setDraft({ ...draft, calculation_mode: opt.value })}
                  className="mt-0.5 accent-amber-500 shrink-0"
                />
                <div>
                  <p className="text-sm font-semibold dark:text-gray-300 text-slate-800">{opt.label}</p>
                  <p className="text-[11px] dark:text-gray-400 text-slate-500">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Interval input — disabled when mode == "daily" */}
          <div className={`transition-opacity ${(draft.calculation_mode ?? "periodic") === "daily" ? "opacity-40 pointer-events-none" : ""}`}>
            <p className="text-xs font-semibold dark:text-gray-400 text-slate-600 mb-2">
              Intervalo de recálculo (Modo Periódico)
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={1440}
                disabled={(draft.calculation_mode ?? "periodic") === "daily"}
                value={draft.cache_interval_minutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1) setDraft({ ...draft, cache_interval_minutes: v });
                }}
                className="w-28 h-9 text-center text-sm font-semibold border dark:border-gray-700 border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-slate-100"
              />
              <span className="text-sm dark:text-gray-400 text-slate-500">minutos</span>
              <span className="text-[11px] dark:text-gray-500 text-slate-400 ml-2">
                (equivale a{" "}
                {draft.cache_interval_minutes >= 60
                  ? `${(draft.cache_interval_minutes / 60).toFixed(1)} h`
                  : `${draft.cache_interval_minutes} min`}
                )
              </span>
            </div>
          </div>

          {/* Telemetría del Collector — runtime state devuelto por el GET */}
          <div className="flex flex-col gap-1.5 pt-1 border-t dark:border-gray-700 border-slate-100">
            {/* Última ejecución — string pre-formateado desde el servidor */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 dark:text-gray-500 text-slate-400 shrink-0" />
              <p className="text-xs dark:text-gray-500 text-slate-400">
                Último cálculo:{" "}
                <span className="font-medium dark:text-gray-400 text-slate-500">
                  {settings?.last_calculated_at
                    ? settings.last_calculated_at
                    : "Pendiente"}
                </span>
              </p>
            </div>

            {/* Estado del ciclo actual + duración */}
            <CollectorStatusBadge
              status={settings?.calculation_status}
              duration={settings?.last_calculation_duration}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Card 5: Hora de repriorización ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 border-b dark:border-gray-700 border-slate-100">
          <CardTitle className="text-base">Hora de repriorización diaria</CardTitle>
          <CardDescription>
            El Collector calcula y acumula promedios a lo largo del día. A la hora indicada, el
            Executor consolida esos datos y aplica los saltos de prioridad en la base de datos.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={draft.escalation_time ?? "23:00"}
              onChange={(e) => setDraft({ ...draft, escalation_time: e.target.value })}
              className="h-9 px-3 text-sm font-semibold border dark:border-gray-700 border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 dark:bg-gray-800 bg-white"
            />
            <span className="text-sm dark:text-gray-400 text-slate-500">hora local Argentina (ART, UTC−3)</span>
          </div>
          <p className="text-[11px] dark:text-gray-500 text-slate-400 leading-relaxed">
            Define a qué hora se aplicarán los saltos de prioridad.{" "}
            <span className="text-amber-600 font-medium">
              Nota: El ruteo automático diario se actualiza a las 02:00 AM. Se recomienda
              programar esta repriorización <em>antes</em> de esa hora para que la asignación de
              vehículos tome los valores actualizados.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* ── Card 6: Kill-switch de repriorización ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 border-b dark:border-gray-700 border-slate-100">
          <CardTitle className="text-base">Repriorización automática</CardTitle>
          <CardDescription>
            Cuando está deshabilitado, el motor sigue detectando envíos demorados y los registra
            en el log de auditoría, pero <strong>no modifica la prioridad</strong> en la base de datos.
            Útil para auditar el motor sin efectos secundarios operativos.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {/*
            The <label> wraps the entire row so clicking anywhere — icon, text,
            or the visual switch — toggles the hidden checkbox via the browser's
            native label association. No extra onClick handlers are needed.
          */}
          <label className="flex items-center justify-between gap-4 cursor-pointer select-none group">
            {/* Left: icon + text */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                (draft.auto_escalate ?? true) ? "bg-emerald-50 text-emerald-600" : "dark:bg-gray-700/50 bg-slate-100 dark:text-gray-500 text-slate-400"
              }`}>
                <Power className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold dark:text-gray-300 text-slate-800">
                  {(draft.auto_escalate ?? true) ? "Habilitada" : "Deshabilitada"}
                </p>
                <p className="text-[11px] dark:text-gray-400 text-slate-500">
                  {(draft.auto_escalate ?? true)
                    ? "Las prioridades se actualizan automáticamente al detectar demoras."
                    : "Solo detección y log — sin cambios en la base de datos."}
                </p>
              </div>
            </div>

            {/* Right: toggle switch — uses Tailwind peer pattern for reliable styling */}
            <div className="relative w-12 h-6 shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={draft.auto_escalate ?? true}
                onChange={(e) => setDraft({ ...draft, auto_escalate: e.target.checked })}
              />
              {/* Track */}
              <div className="absolute inset-0 rounded-full bg-slate-300 peer-checked:bg-emerald-500 transition-colors duration-200" />
              {/* Thumb */}
              <div className="absolute top-0.5 left-0.5 w-5 h-5 dark:bg-gray-800 bg-white rounded-full shadow-sm transition-transform duration-200 peer-checked:translate-x-6" />
            </div>
          </label>
          {!(draft.auto_escalate ?? true) && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-snug">
                El motor detectará demoras pero <strong>no aplicará cambios</strong>. Los eventos
                seguirán apareciendo en la Auditoría SLA marcados como "sin cambios en DB".
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Action bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => setDraft(settings)}
          disabled={!isDirty || saveState === "saving"}
          className="text-xs dark:text-gray-400 text-slate-500 dark:hover:text-gray-200 hover:text-slate-700 disabled:opacity-40 transition-colors cursor-pointer"
        >
          Descartar cambios
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saveState === "saving" || !isDirty || draft.enabled_states.length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {saveState === "saving" ? (
            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
          ) : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

// ── Collector telemetry badge ─────────────────────────────────────────────────

function CollectorStatusBadge({
  status,
  duration,
}: {
  status?: string;
  duration?: string;
}) {
  const s = status ?? "sin medicion";

  const dot =
    s === "en proceso"
      ? "bg-amber-400 animate-pulse"
      : s === "completado"
        ? "bg-emerald-500"
        : "bg-slate-300";

  const label =
    s === "en proceso"
      ? "En proceso"
      : s === "completado"
        ? "Completado"
        : "Sin medición";

  const textColor =
    s === "en proceso"
      ? "text-amber-600"
      : s === "completado"
        ? "text-emerald-600"
        : "dark:text-gray-500 text-slate-400";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Estado */}
      <div className="inline-flex items-center gap-1.5">
        {s === "en proceso" ? (
          <Loader2 className="w-3 h-3 text-amber-500 animate-spin shrink-0" />
        ) : (
          <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        )}
        <span className={`text-xs font-medium ${textColor}`}>{label}</span>
      </div>

      {/* Duración — solo visible cuando hay dato */}
      {duration && (
        <span className="text-xs dark:text-gray-500 text-slate-400">
          · Tiempo de ejecución:{" "}
          <span className="font-mono font-semibold dark:text-gray-400 text-slate-500">{duration}</span>
        </span>
      )}
    </div>
  );
}
