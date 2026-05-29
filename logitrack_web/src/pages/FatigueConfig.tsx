import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
} from "lucide-react";
import {
  fatigueConfigApi,
  type AuditLog,
  type FatigueConfig as FatigueConfigType,
} from "../api/fatigueConfig";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";

// ── helpers ──────────────────────────────────────────────────────────────────

function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

// Sum of active-test weights, rounded to avoid float noise.
function activeWeightsSum(draft: FatigueConfigType): number {
  return Math.round((
    (draft.kss_enabled     ? draft.kss_weight     : 0) +
    (draft.voice_enabled   ? draft.voice_weight   : 0) +
    (draft.tactile_enabled ? draft.tactile_weight : 0) +
    (draft.pvt_enabled     ? draft.pvt_weight     : 0)
  ) * 1e4) / 1e4;
}

// ── test definitions ─────────────────────────────────────────────────────────

interface TestDef {
  id: "kss" | "voice" | "tactile" | "pvt";
  label: string;
  description: string;
  enabledKey: keyof FatigueConfigType;
  weightKey:  keyof FatigueConfigType;
}

const TESTS: TestDef[] = [
  {
    id: "kss",
    label: "Escala KSS",
    description: "Check-in de somnolencia Karolinska (KSS 1–9). Mapeado internamente: 1-4 = 0, 5-7 = 50, 8-9 = 100.",
    enabledKey: "kss_enabled",
    weightKey:  "kss_weight",
  },
  {
    id: "voice",
    label: "Grabación de voz",
    description: "Drift acústico respecto a la línea base del chofer (0–100). Requiere historial de voz previo.",
    enabledKey: "voice_enabled",
    weightKey:  "voice_weight",
  },
  {
    id: "tactile",
    label: "Eventos táctiles",
    description: "Suma de toques erróneos durante la gestión de entregas, normalizada (10+ = 100).",
    enabledKey: "tactile_enabled",
    weightKey:  "tactile_weight",
  },
  {
    id: "pvt",
    label: "PVT — Prueba psicomotriz",
    description: "Latencia promedio de reacción (0 ms = 0, ≥500 ms = 100). Requiere que el chofer complete el minijuego.",
    enabledKey: "pvt_enabled",
    weightKey:  "pvt_weight",
  },
];

// ── componente principal ─────────────────────────────────────────────────────

export function FatigueConfig() {
  const [config, setConfig] = useState<FatigueConfigType | null>(null);
  const [draft,  setDraft]  = useState<FatigueConfigType | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  // historial de auditoría (US13)
  const [auditOpen,    setAuditOpen]    = useState(false);
  const [auditLogs,    setAuditLogs]    = useState<AuditLog[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError,   setAuditError]   = useState("");

  const reloadAuditLogs = () => {
    setAuditLoading(true);
    setAuditError("");
    fatigueConfigApi
      .getAuditLogs()
      .then((r) => setAuditLogs(r.logs))
      .catch(() => setAuditError("No se pudo cargar el historial de auditoría."))
      .finally(() => setAuditLoading(false));
  };

  const handleToggleAudit = () => {
    const next = !auditOpen;
    setAuditOpen(next);
    if (next && auditLogs === null) reloadAuditLogs();
  };

  useEffect(() => {
    fatigueConfigApi
      .get()
      .then((cfg) => { setConfig(cfg); setDraft(cfg); })
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
      reloadAuditLogs();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo guardar la configuración.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── validation ───────────────────────────────────────────────────────────

  const isDirty = draft !== null && config !== null &&
    JSON.stringify(draft) !== JSON.stringify(config);

  const wSum       = draft ? activeWeightsSum(draft) : 0;
  const noneEnabled = draft
    ? !draft.kss_enabled && !draft.voice_enabled && !draft.tactile_enabled && !draft.pvt_enabled
    : false;
  // Valid when: all disabled (neutral state), OR active weights sum to 100%.
  const weightsOk  = noneEnabled || Math.abs(wSum - 1.0) <= 0.01;
  const canSave    = isDirty && weightsOk;

  // ── loading / error states ───────────────────────────────────────────────

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

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      {/* ── Hora de inicio del día (daily_reset_hour) ─────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Hora de inicio del día para check-in</CardTitle>
          <CardDescription>
            Define a partir de qué hora (ART, 0–23) empieza un nuevo "día lógico"
            para el gate de check-in. Con valor 0 el día comienza a medianoche
            (comportamiento por defecto). Con valor 6, un check-in hecho a las 05:00
            ya no es válido una vez que pasan las 06:00.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldRow
            label="Hora de reset diario (daily_reset_hour)"
            hint="Entero de 0 a 23. 0 = medianoche (default). Ejemplo: 6 = los check-ins se renuevan a las 6 AM."
          >
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              value={draft.daily_reset_hour ?? 0}
              onChange={(e) =>
                setDraft({ ...draft, daily_reset_hour: Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)) })
              }
              className={inputClass}
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* ── Umbrales de riesgo ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Umbrales de riesgo</CardTitle>
          <CardDescription>
            El score compuesto (0–100) se clasifica según estos límites.
            Verde ≤ <strong>green_max</strong> · Rojo ≥ <strong>red_min</strong> · Amarillo en el medio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <FieldRow
              label="Límite superior verde (green_max)"
              hint="Puntuación máxima para badge verde (sin riesgo). Rango 0–99."
            >
              <input
                type="number"
                min={0} max={99} step={1}
                value={draft.risk_thresholds.green_max}
                onChange={(e) =>
                  setDraft({ ...draft, risk_thresholds: { ...draft.risk_thresholds, green_max: num(e.target.value) } })
                }
                className={inputClass}
              />
              <ScoreBadge color="emerald" label={`≤ ${draft.risk_thresholds.green_max}`} />
            </FieldRow>

            <FieldRow
              label="Límite inferior rojo (red_min)"
              hint="Puntuación mínima para badge rojo (riesgo alto). Debe ser mayor que green_max."
            >
              <input
                type="number"
                min={1} max={100} step={1}
                value={draft.risk_thresholds.red_min}
                onChange={(e) =>
                  setDraft({ ...draft, risk_thresholds: { ...draft.risk_thresholds, red_min: num(e.target.value) } })
                }
                className={inputClass}
              />
              <ScoreBadge color="rose" label={`≥ ${draft.risk_thresholds.red_min}`} />
            </FieldRow>

            <RiskBandBar greenMax={draft.risk_thresholds.green_max} redMin={draft.risk_thresholds.red_min} />
          </div>
        </CardContent>
      </Card>

      {/* ── Pruebas activas y pesos ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Pruebas activas y pesos</CardTitle>
          <CardDescription>
            Activá o desactivá cada prueba individualmente y asigná su porcentaje de peso.
            La suma de los pesos de las pruebas <strong>activas</strong> debe ser exactamente 100%.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {TESTS.map((test) => {
              const enabled = draft[test.enabledKey] as boolean;
              const weight  = draft[test.weightKey]  as number;
              return (
                <TestRow
                  key={test.id}
                  label={test.label}
                  description={test.description}
                  enabled={enabled}
                  weight={weight}
                  onToggle={(v) => setDraft({ ...draft, [test.enabledKey]: v })}
                  onWeight={(v) => setDraft({ ...draft, [test.weightKey]: v })}
                />
              );
            })}
          </div>

          {/* Indicador de suma */}
          <ActiveWeightsBadge sum={wSum} ok={weightsOk} noneEnabled={noneEnabled} />
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
        {!weightsOk && isDirty && !noneEnabled && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            La suma de los pesos de las pruebas activas debe ser 100% (actual: {(wSum * 100).toFixed(1)}%).
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

      {/* ── Historial de auditoría (US13) ──────────────────────────── */}
      <Card>
        <button
          type="button"
          onClick={handleToggleAudit}
          className="w-full flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50/80 transition-colors rounded-xl text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ClipboardList className="w-4 h-4 text-[#1e3a5f]" />
            Historial de auditoría
            {auditLogs !== null && (
              <span className="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                {auditLogs.length}
              </span>
            )}
          </span>
          {auditOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {auditOpen && (
          <div className="border-t border-slate-100 px-5 pb-5 pt-3">
            {auditLoading && <p className="text-sm text-slate-400 py-6 text-center">Cargando historial…</p>}
            {auditError && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700 mb-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {auditError}
              </div>
            )}
            {!auditLoading && auditLogs !== null && auditLogs.length === 0 && (
              <p className="text-sm text-slate-400 italic py-6 text-center">
                Sin registros todavía. Los cambios se irán acumulando aquí.
              </p>
            )}
            {!auditLoading && auditLogs && auditLogs.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "var(--bg-subtle)" }}>
                        <th style={thStyle}>Fecha / hora</th>
                        <th style={thStyle}>Usuario</th>
                        <th style={thStyle}>Acción</th>
                        <th style={thStyle}>Detalles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <AuditRow key={log.id} log={log} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-400 text-center">
                  Registro de solo lectura — los cambios no pueden editarse ni eliminarse (AC2).
                </p>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── sub-componentes ───────────────────────────────────────────────────────────

const inputClass =
  "h-10 w-32 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        checked ? "bg-[#1e3a5f]" : "bg-slate-200"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ── TestRow — one row per fatigue test ────────────────────────────────────────

function TestRow({
  label,
  description,
  enabled,
  weight,
  onToggle,
  onWeight,
}: {
  label: string;
  description: string;
  enabled: boolean;
  weight: number;
  onToggle: (v: boolean) => void;
  onWeight: (v: number) => void;
}) {
  return (
    <div className={`flex items-start gap-4 px-4 py-3.5 rounded-xl border transition-colors ${
      enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/60"
    }`}>
      {/* Toggle */}
      <div className="pt-0.5 shrink-0">
        <Toggle checked={enabled} onChange={onToggle} />
      </div>

      {/* Label + description */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-snug ${enabled ? "text-slate-800" : "text-slate-400"}`}>
          {label}
        </p>
        <p className="text-xs text-slate-400 leading-snug mt-0.5">{description}</p>
      </div>

      {/* Weight input */}
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={Math.round(weight * 100)}
          onChange={(e) => onWeight(Math.min(1, Math.max(0, num(e.target.value) / 100)))}
          disabled={!enabled}
          className={`h-10 w-20 px-3 rounded-lg border text-sm tabular-nums text-right focus:outline-none transition-all ${
            enabled
              ? "border-slate-200 bg-white text-slate-900 focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb]"
              : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
          }`}
        />
        <span className={`text-sm font-medium w-4 ${enabled ? "text-slate-500" : "text-slate-300"}`}>%</span>
      </div>
    </div>
  );
}

// ── ActiveWeightsBadge ────────────────────────────────────────────────────────

function ActiveWeightsBadge({ sum, ok, noneEnabled }: { sum: number; ok: boolean; noneEnabled: boolean }) {
  if (noneEnabled) {
    return (
      <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
        <span>Todas las pruebas desactivadas — el score de riesgo no se calculará.</span>
      </div>
    );
  }
  return (
    <div className={`mt-4 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-semibold ${
      ok
        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
        : "bg-rose-50 border-rose-200 text-rose-700"
    }`}>
      {ok ? (
        <CheckCircle2 className="w-4 h-4 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 shrink-0" />
      )}
      <span>
        Suma de pesos activos:{" "}
        <span className="tabular-nums font-bold">{(sum * 100).toFixed(1)}%</span>
        {ok ? " ✓ válido" : " — debe ser 100%"}
      </span>
    </div>
  );
}

// ── FieldRow ──────────────────────────────────────────────────────────────────

function FieldRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
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

// ── ScoreBadge ────────────────────────────────────────────────────────────────

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

// ── RiskBandBar ───────────────────────────────────────────────────────────────

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
        <div className="bg-emerald-400 flex items-center justify-center text-white" style={{ width: `${gPct}%` }} title={`Verde: 0–${greenMax}`}>
          {gPct >= 8 ? "Verde" : ""}
        </div>
        <div className="bg-amber-400 flex items-center justify-center text-white" style={{ width: `${aPct}%` }} title={`Amarillo: ${greenMax + 1}–${redMin - 1}`}>
          {aPct >= 8 ? "Amarillo" : ""}
        </div>
        <div className="bg-rose-500 flex items-center justify-center text-white" style={{ width: `${rPct}%` }} title={`Rojo: ${redMin}–100`}>
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

// ── Audit log sub-components ──────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: 11,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

const ACTION_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  UPDATE_FATIGUE_CONFIG: { label: "Config. fatiga", bg: "var(--brand-tint)", color: "var(--brand)" },
  SUBMIT_CHECKIN:        { label: "Check-in",        bg: "var(--ok-bg)", color: "var(--ok-text)" },
  SKIP_CHECKIN:          { label: "Salteado",         bg: "var(--warn-bg)", color: "var(--warn-text)" },
};

function formatAuditDate(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function AuditRow({ log }: { log: AuditLog }) {
  const badge = ACTION_BADGE[log.action] ?? { label: log.action, bg: "var(--bg-muted)", color: "var(--text-strong)" };
  const d = log.details;

  let detailText = "—";
  if (log.action === "UPDATE_FATIGUE_CONFIG" && d.risk_thresholds) {
    const rt = d.risk_thresholds as { green_max?: number; red_min?: number };
    const active = (["kss", "voice", "tactile", "pvt"] as const)
      .filter((k) => d[`${k}_enabled`])
      .map((k) => `${k}: ${((d[`${k}_weight`] as number ?? 0) * 100).toFixed(0)}%`)
      .join(" · ");
    detailText = `verde≤${rt.green_max ?? "?"} · rojo≥${rt.red_min ?? "?"}${active ? ` · [${active}]` : ""}`;
  } else if (log.action === "SUBMIT_CHECKIN") {
    detailText = `KSS ${d.kss_level ?? "?"} · ${d.horas_sueno ?? "?"}h sueño`;
  } else if (log.action === "SKIP_CHECKIN") {
    detailText = `Fecha ${d.date ?? "?"}`;
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "var(--text-strong)" }}>
        {formatAuditDate(log.created_at)}
      </td>
      <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>{log.created_by}</td>
      <td style={tdStyle}>
        <span style={{ background: badge.bg, color: badge.color, borderRadius: 4, padding: "2px 8px", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap" }}>
          {badge.label}
        </span>
      </td>
      <td style={{ ...tdStyle, color: "var(--text-secondary)", fontSize: 12 }}>{detailText}</td>
    </tr>
  );
}
