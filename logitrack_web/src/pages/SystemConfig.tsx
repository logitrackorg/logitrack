import { useState, useEffect, useMemo } from "react";
import { Settings, AlertCircle, CheckCircle2, Minus, Plus, Clock, RotateCcw } from "lucide-react";
import { systemConfigApi, type SystemConfig as SystemConfigType } from "../api/systemConfig";
import { clockApi, type ClockState } from "../api/clock";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { fmtDateTimeSeconds } from "../utils/date";

const pad = (n: number) => String(n).padStart(2, "0");

// Convierte un Date a string apto para <input type="datetime-local"> (hora local).
const dateToLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Interpreta el valor de un datetime-local como hora local del navegador y lo
// serializa a ISO con timezone, que es lo que el backend espera (RFC3339).
const localInputToIso = (local: string): string => new Date(local).toISOString();

export function SystemConfig() {
  const [config, setConfig] = useState<SystemConfigType | null>(null);
  const [draft, setDraft] = useState<SystemConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reloj del sistema
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [clockSaving, setClockSaving] = useState(false);
  const [clockError, setClockError] = useState("");
  const [overrideInput, setOverrideInput] = useState("");
  const [overrideInputInitialized, setOverrideInputInitialized] = useState(false);
  const [tick, setTick] = useState(0);

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

  // Carga inicial del reloj + refresh periódico (por si otro admin lo cambió).
  useEffect(() => {
    const fetchClock = () => {
      clockApi
        .get()
        .then(setClockState)
        .catch(() => setClockError("No se pudo cargar el estado del reloj."));
    };
    fetchClock();
    const id = setInterval(fetchClock, 30000);
    return () => clearInterval(id);
  }, []);

  // Tick para refrescar el display del reloj cada segundo.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Pre-popula el input con la hora actual del sistema la primera vez que cargamos.
  useEffect(() => {
    if (!overrideInputInitialized && clockState) {
      const initial = new Date(Date.now() + clockState.offset_ms);
      setOverrideInput(dateToLocalInput(initial));
      setOverrideInputInitialized(true);
    }
  }, [clockState, overrideInputInitialized]);

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

  const handleSetOverride = async () => {
    if (!overrideInput) return;
    setClockSaving(true);
    setClockError("");
    try {
      const iso = localInputToIso(overrideInput);
      const next = await clockApi.setOverride(iso);
      setClockState(next);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo aplicar el override.";
      setClockError(msg);
    } finally {
      setClockSaving(false);
    }
  };

  const handleClearOverride = async () => {
    setClockSaving(true);
    setClockError("");
    try {
      const next = await clockApi.clear();
      setClockState(next);
      // Reset input al ahora real para futuros usos.
      setOverrideInput(dateToLocalInput(new Date()));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo limpiar el override.";
      setClockError(msg);
    } finally {
      setClockSaving(false);
    }
  };

  // Display del reloj: usa el offset conocido + Date.now() local para que el
  // segundero avance sin tener que repollear el backend.
  const { displayedSystemNow, displayedRealNow } = useMemo(() => {
    void tick;
    if (!clockState) return { displayedSystemNow: null, displayedRealNow: null };
    const realNow = new Date();
    const systemNow = new Date(realNow.getTime() + clockState.offset_ms);
    return { displayedSystemNow: systemNow, displayedRealNow: realNow };
  }, [tick, clockState]);

  const isDirty =
    draft !== null && config !== null &&
    draft.max_delivery_attempts !== config.max_delivery_attempts;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#1e3a5f]" />
            Reloj del sistema (testing)
          </CardTitle>
          <CardDescription>
            Permite simular una fecha y hora distintas para que todo el sistema (ruteo, SLA, timestamps) se comporte como si fuese ese momento. El override vive solo en memoria: si reiniciás el backend se limpia automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clockState?.is_active && (
            <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-lg border-2 border-rose-300 bg-rose-50 text-sm text-rose-800">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">Override activo —</strong> el sistema NO está usando el reloj real. Acordate de restaurarlo cuando termines.
              </div>
            </div>
          )}

          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Hora del sistema
            </div>
            <div
              className={`text-3xl font-extrabold tabular-nums ${
                clockState?.is_active ? "text-rose-700" : "text-[#1e3a5f]"
              }`}
            >
              {displayedSystemNow ? fmtDateTimeSeconds(displayedSystemNow) : "—"}
            </div>
            {clockState?.is_active && displayedRealNow && (
              <div className="text-xs text-slate-500 mt-1 tabular-nums">
                Hora real: {fmtDateTimeSeconds(displayedRealNow)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-600">
                Nueva fecha y hora
              </label>
              <input
                type="datetime-local"
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                disabled={clockSaving}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all tabular-nums"
              />
            </div>
            <button
              onClick={handleSetOverride}
              disabled={clockSaving || !overrideInput}
              className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
            >
              {clockSaving ? "Aplicando…" : "Aplicar override"}
            </button>
          </div>

          {clockState?.is_active && (
            <button
              onClick={handleClearOverride}
              disabled={clockSaving}
              className="h-10 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Restaurar hora real
            </button>
          )}

          {clockError && (
            <div className="flex items-center gap-2 mt-3 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {clockError}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
