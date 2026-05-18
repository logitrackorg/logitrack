import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Brain, FlaskConical, RotateCcw } from "lucide-react";
import {
  fatigueConfigApi,
  type FatigueConfig as FatigueConfigType,
  type VoiceWeights,
} from "../api/fatigueConfig";
import { PageHeader } from "../components/ui/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";

// ── helpers ──────────────────────────────────────────────────────────────────

const inputClass =
  "h-10 w-32 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function pct(v: number): string {
  return (v * 100).toFixed(1);
}

/** Suma de los cinco pesos de voz, redondeada a 4 decimales para evitar ruido de punto flotante. */
function weightsSum(w: VoiceWeights): number {
  return Math.round((w.pitch_mean + w.pitch_range + w.energy_rms + w.speech_rate + w.pause_ratio) * 1e4) / 1e4;
}

// ── componente principal ─────────────────────────────────────────────────────

export function FatigueConfig() {
  const [config, setConfig] = useState<FatigueConfigType | null>(null);
  const [draft, setDraft] = useState<FatigueConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // reset de check-ins (testing)
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    fatigueConfigApi
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
      const updated = await fatigueConfigApi.update(draft);
      setConfig(updated);
      setDraft(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo guardar la configuración.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetCheckins = async () => {
    setResetting(true);
    setResetError("");
    setResetSuccess(false);
    try {
      const updated = await fatigueConfigApi.resetCheckins();
      // Refresh config so last_checkin_reset timestamp shows in UI immediately.
      setConfig(updated);
      setDraft(updated);
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 5000);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo ejecutar el reset.";
      setResetError(msg);
    } finally {
      setResetting(false);
    }
  };

  const setWeight = (key: keyof VoiceWeights, raw: string) => {
    if (!draft) return;
    const v = Math.min(1, Math.max(0, num(raw) / 100));
    setDraft({ ...draft, voice_weights: { ...draft.voice_weights, [key]: v } });
  };

  const isDirty = draft !== null && config !== null &&
    JSON.stringify(draft) !== JSON.stringify(config);

  // Validación de pesos — 100% ± 1%
  const wSum = draft ? weightsSum(draft.voice_weights) : 0;
  const weightsOk = Math.abs(wSum - 1.0) <= 0.01;
  const canSave = isDirty && weightsOk;

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando configuración…</p>
        </Card>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-10 text-center">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">{error || "Error al cargar."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <PageHeader
        title="Config. modelo de fatiga"
        description="Parámetros del modelo de detección de fatiga. Cambios impactan en todos los check-ins futuros."
        icon={<Brain className="w-5 h-5" />}
      />

      {/* ── Umbrales de riesgo ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Umbrales de riesgo</CardTitle>
          <CardDescription>
            El drift score (0–100) se clasifica en tres zonas según estos límites.
            Verde ≤ <strong>green_max</strong> · Rojo ≥ <strong>red_min</strong> · Ámbar en el medio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <FieldRow
              label="Límite superior verde (green_max)"
              hint="Puntuación máxima para mostrar badge verde (sin riesgo). Rango 0–99."
            >
              <input
                type="number"
                min={0}
                max={99}
                step={1}
                value={draft.risk_thresholds.green_max}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    risk_thresholds: {
                      ...draft.risk_thresholds,
                      green_max: num(e.target.value),
                    },
                  })
                }
                className={inputClass}
              />
              <ScoreBadge color="emerald" label={`≤ ${draft.risk_thresholds.green_max}`} />
            </FieldRow>

            <FieldRow
              label="Límite inferior rojo (red_min)"
              hint="Puntuación mínima para mostrar badge rojo (riesgo alto). Debe ser mayor que green_max."
            >
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={draft.risk_thresholds.red_min}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    risk_thresholds: {
                      ...draft.risk_thresholds,
                      red_min: num(e.target.value),
                    },
                  })
                }
                className={inputClass}
              />
              <ScoreBadge color="rose" label={`≥ ${draft.risk_thresholds.red_min}`} />
            </FieldRow>

            {/* Visualización de las bandas */}
            <RiskBandBar
              greenMax={draft.risk_thresholds.green_max}
              redMin={draft.risk_thresholds.red_min}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Pesos de señal de voz ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Pesos de la señal de voz</CardTitle>
          <CardDescription>
            Contribución de cada característica acústica al drift score. Deben sumar exactamente 100%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(
              [
                { key: "pitch_mean" as const, label: "Tono medio (pitch_mean)", hint: "Frecuencia fundamental promedio — indicador primario de fatiga." },
                { key: "pitch_range" as const, label: "Rango tonal (pitch_range)", hint: "Variación máx-mín de tono — habla monótona indica somnolencia." },
                { key: "energy_rms" as const, label: "Energía RMS (energy_rms)", hint: "Amplitud normalizada — energía baja correlaciona con cansancio." },
                { key: "speech_rate" as const, label: "Velocidad de habla (speech_rate)", hint: "Sílabas por segundo — habla lenta es marcador de fatiga." },
                { key: "pause_ratio" as const, label: "Ratio de pausas (pause_ratio)", hint: "Fracción de silencio — pausas largas indican carga cognitiva." },
              ] as const
            ).map(({ key, label, hint }) => (
              <FieldRow key={key} label={label} hint={hint}>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={pct(draft.voice_weights[key])}
                    onChange={(e) => setWeight(key, e.target.value)}
                    className={inputClass}
                  />
                  <span className="text-sm text-slate-500 w-6">%</span>
                </div>
              </FieldRow>
            ))}
          </div>

          {/* Indicador de suma de pesos */}
          <WeightsSumBadge sum={wSum} ok={weightsOk} />
        </CardContent>
      </Card>

      {/* ── Días mínimos para baseline ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Días mínimos para baseline</CardTitle>
          <CardDescription>
            Cantidad de jornadas de check-in necesarias antes de que el sistema compute un drift score
            significativo. Con menos muestras, se muestra "Sin historial". Rango: 1–90 días.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldRow
            label="Días mínimos (min_baseline_days)"
            hint="Default: 10 días."
          >
            <input
              type="number"
              min={1}
              max={90}
              step={1}
              value={draft.min_baseline_days}
              onChange={(e) =>
                setDraft({ ...draft, min_baseline_days: num(e.target.value) })
              }
              className={inputClass}
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* ── Puntajes KSS ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Puntajes de somnolencia KSS</CardTitle>
          <CardDescription>
            Penalidad adicional sobre el drift score según el nivel KSS declarado por el chofer.
            Deben estar en orden no decreciente (kss_1_4 ≤ kss_5_7 ≤ kss_8_9).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <FieldRow
              label="KSS 1–4 (alerta a moderado)"
              hint="Ejemplo: 0 puntos (sin penalidad)."
            >
              <input
                type="number"
                min={0}
                step={1}
                value={draft.kss_scores.kss_1_4}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kss_scores: { ...draft.kss_scores, kss_1_4: num(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </FieldRow>
            <FieldRow
              label="KSS 5–7 (somnolencia moderada)"
              hint="Ejemplo: 15 puntos."
            >
              <input
                type="number"
                min={0}
                step={1}
                value={draft.kss_scores.kss_5_7}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kss_scores: { ...draft.kss_scores, kss_5_7: num(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </FieldRow>
            <FieldRow
              label="KSS 8–9 (somnolencia alta)"
              hint="Ejemplo: 30 puntos."
            >
              <input
                type="number"
                min={0}
                step={1}
                value={draft.kss_scores.kss_8_9}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kss_scores: { ...draft.kss_scores, kss_8_9: num(e.target.value) },
                  })
                }
                className={inputClass}
              />
            </FieldRow>
          </div>
        </CardContent>
      </Card>

      {/* ── Herramientas de testing ───────────────────────────────────── */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-800">
            <FlaskConical className="w-4 h-4" />
            Herramientas de testing
          </CardTitle>
          <CardDescription>
            Estas acciones están pensadas para pruebas. No afectan datos de producción de envíos ni rutas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700">Resetear check-ins del día</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Fuerza que <strong>todos los choferes</strong> vean la puerta de check-in nuevamente,
                sin importar si ya la completaron hoy. Los datos registrados (KSS, voz, métricas)
                se preservan y se sobrescriben si el chofer rehace el check-in.
              </p>
              {config?.last_checkin_reset && (
                <p className="mt-1.5 text-[11px] text-amber-700 font-medium">
                  Último reset:{" "}
                  {new Date(config.last_checkin_reset).toLocaleString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>
              )}
            </div>

            <button
              onClick={handleResetCheckins}
              disabled={resetting}
              className="shrink-0 h-10 px-4 rounded-lg border-2 border-amber-400 bg-white hover:bg-amber-50 active:bg-amber-100 disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400 text-amber-800 text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-2"
            >
              <RotateCcw className={`w-4 h-4 ${resetting ? "animate-spin" : ""}`} />
              {resetting ? "Reseteando…" : "Resetear ahora"}
            </button>
          </div>

          {resetSuccess && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Reset aplicado. Los choferes verán la puerta de check-in al recargar.
            </div>
          )}
          {resetError && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {resetError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Acciones ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Configuración guardada correctamente.
          </div>
        )}
        {!weightsOk && isDirty && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Los pesos de voz deben sumar 100% antes de guardar (actual: {(wSum * 100).toFixed(1)}%).
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          {isDirty && (
            <button
              onClick={() => { setDraft(config); setError(""); }}
              disabled={saving}
              className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
            >
              Descartar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── sub-componentes ───────────────────────────────────────────────────────────

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-700 leading-snug">{label}</p>
        <p className="text-xs text-slate-400 leading-snug mt-0.5">{hint}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

function ScoreBadge({ color, label }: { color: "emerald" | "rose"; label: string }) {
  const cls =
    color === "emerald"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : "bg-rose-100 text-rose-700 border-rose-200";
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold tabular-nums ${cls}`}>
      {label}
    </span>
  );
}

function RiskBandBar({ greenMax, redMin }: { greenMax: number; redMin: number }) {
  const valid = greenMax < redMin && greenMax >= 0 && redMin <= 100;
  if (!valid) {
    return (
      <p className="text-xs text-rose-500 mt-2">
        ⚠ Los umbrales son inválidos: green_max debe ser menor que red_min.
      </p>
    );
  }
  const gPct = greenMax;
  const rPct = 100 - redMin;
  const aPct = 100 - gPct - rPct;
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
        Vista previa de bandas
      </p>
      <div className="flex h-5 rounded-full overflow-hidden text-[10px] font-bold">
        <div
          className="bg-emerald-400 flex items-center justify-center text-white"
          style={{ width: `${gPct}%` }}
          title={`Verde: 0–${greenMax}`}
        >
          {gPct >= 8 ? "Verde" : ""}
        </div>
        <div
          className="bg-amber-400 flex items-center justify-center text-white"
          style={{ width: `${aPct}%` }}
          title={`Ámbar: ${greenMax + 1}–${redMin - 1}`}
        >
          {aPct >= 8 ? "Ámbar" : ""}
        </div>
        <div
          className="bg-rose-500 flex items-center justify-center text-white"
          style={{ width: `${rPct}%` }}
          title={`Rojo: ${redMin}–100`}
        >
          {rPct >= 8 ? "Rojo" : ""}
        </div>
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-slate-400 tabular-nums">
        <span>0</span>
        <span>{greenMax}</span>
        <span>{redMin}</span>
        <span>100</span>
      </div>
    </div>
  );
}

function WeightsSumBadge({ sum, ok }: { sum: number; ok: boolean }) {
  const pctSum = (sum * 100).toFixed(1);
  return (
    <div
      className={`mt-4 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-semibold ${
        ok
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-rose-50 border-rose-200 text-rose-700"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 shrink-0" />
      )}
      <span>
        Suma de pesos:{" "}
        <span className="tabular-nums font-bold">{pctSum}%</span>
        {ok ? " ✓ válido" : ` — debe ser 100%`}
      </span>

      {/* Barra de progreso proporcional a cada peso */}
      {ok && (
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {(["pitch_mean", "pitch_range", "energy_rms", "speech_rate", "pause_ratio"] as const).map(
            (k, i) => {
              const colors = [
                "bg-violet-500",
                "bg-blue-500",
                "bg-sky-500",
                "bg-teal-500",
                "bg-emerald-500",
              ];
              return (
                <div
                  key={k}
                  title={k}
                  className={`h-4 rounded-sm ${colors[i]}`}
                  style={{ width: `${sum > 0 ? 0 : 0}px` }}
                />
              );
            }
          )}
        </div>
      )}
    </div>
  );
}
