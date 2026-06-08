import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw, Clock } from "lucide-react";
import { routingApi, type RoutingConfig as RoutingConfigType, type GlobalPlanLog, type LastMilePackingStrategy } from "../api/routing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

interface NumberFieldDef {
  key: keyof RoutingConfigType;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
  format: "hours" | "ratio" | "count" | "kg" | "minutes" | "speed";
}

const DISPATCH_FIELDS: NumberFieldDef[] = [
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
    label: "Tasa mínima de carga — general (%)",
    hint: "Fallback global: se aplica si las tasas específicas por tipo de viaje están en cero. Porcentaje mínimo de capacidad que debe llenarse para consolidar el viaje.",
    step: 0.05,
    min: 0.1,
    max: 1,
    format: "ratio",
  },
  {
    key: "min_fill_last_mile_rate",
    label: "Tasa mínima — última milla (%)",
    hint: "Porcentaje mínimo de capacidad del vehículo de última milla que debe acumularse para disparar la notificación de despacho. Sobreescribe la tasa general.",
    step: 0.05,
    min: 0.05,
    max: 1,
    format: "ratio",
  },
  {
    key: "min_fill_inter_branch_rate",
    label: "Tasa mínima — intersucursal (%)",
    hint: "Porcentaje mínimo de capacidad del vehículo intersucursal que debe acumularse para disparar la notificación de despacho. Sobreescribe la tasa general.",
    step: 0.05,
    min: 0.05,
    max: 1,
    format: "ratio",
  },
];

const HOUR_KEYS = [
  "morning_window_start_hour",
  "morning_window_end_hour",
  "afternoon_window_start_hour",
  "afternoon_window_end_hour",
] as const satisfies ReadonlyArray<keyof RoutingConfigType>;

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] transition-all w-36 tabular-nums";

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
    case "minutes":
      return `${value} min`;
    case "speed":
      return `${value} km/h`;
  }
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

interface WindowTimelineProps {
  morningStart: number;
  morningEnd: number;
  afternoonStart: number;
  afternoonEnd: number;
  onMorningChange: (start: number, end: number) => void;
  onAfternoonChange: (start: number, end: number) => void;
}

type DragBand = "morning" | "afternoon";
type DragMode = "move" | "left" | "right";

interface DragState {
  band: DragBand;
  mode: DragMode;
  startX: number;
  initialStart: number;
  initialEnd: number;
  railWidth: number;
}

// WindowTimeline dibuja un eje 0–24h con las dos ventanas operativas como
// barras editables: drag del cuerpo mueve el rango, drag de los bordes
// redimensiona. Snap a horas enteras. Los inputs numéricos debajo del
// timeline son una alternativa — el componente padre los mantiene en sync.
function WindowTimeline({
  morningStart,
  morningEnd,
  afternoonStart,
  afternoonEnd,
  onMorningChange,
  onAfternoonChange,
}: WindowTimelineProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const pct = (h: number) => `${(Math.max(0, Math.min(24, h)) / 24) * 100}%`;

  useEffect(() => {
    if (!drag) return;
    const handleMove = (e: MouseEvent) => {
      const dxPx = e.clientX - drag.startX;
      // Snap a horas enteras: redondeo a entero.
      const dxHours = Math.round((dxPx / drag.railWidth) * 24);
      let newStart = drag.initialStart;
      let newEnd = drag.initialEnd;
      const width = drag.initialEnd - drag.initialStart;
      if (drag.mode === "move") {
        newStart = drag.initialStart + dxHours;
        newEnd = drag.initialEnd + dxHours;
        // Mantiene el ancho cuando topea contra los bordes.
        if (newStart < 0) {
          newStart = 0;
          newEnd = width;
        }
        if (newEnd > 24) {
          newEnd = 24;
          newStart = 24 - width;
        }
      } else if (drag.mode === "left") {
        newStart = drag.initialStart + dxHours;
        if (newStart < 0) newStart = 0;
        if (newStart >= newEnd) newStart = newEnd - 1;
      } else if (drag.mode === "right") {
        newEnd = drag.initialEnd + dxHours;
        if (newEnd > 24) newEnd = 24;
        if (newEnd <= newStart) newEnd = newStart + 1;
      }
      if (drag.band === "morning") {
        if (newStart !== morningStart || newEnd !== morningEnd) {
          onMorningChange(newStart, newEnd);
        }
      } else {
        if (newStart !== afternoonStart || newEnd !== afternoonEnd) {
          onAfternoonChange(newStart, newEnd);
        }
      }
    };
    const handleUp = () => setDrag(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [drag, morningStart, morningEnd, afternoonStart, afternoonEnd, onMorningChange, onAfternoonChange]);

  const startDrag = (e: React.MouseEvent, band: DragBand, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect) return;
    const initialStart = band === "morning" ? morningStart : afternoonStart;
    const initialEnd = band === "morning" ? morningEnd : afternoonEnd;
    setDrag({
      band,
      mode,
      startX: e.clientX,
      initialStart,
      initialEnd,
      railWidth: rect.width,
    });
  };

  const renderBand = (
    band: DragBand,
    start: number,
    end: number,
    topClass: string,
    bgClass: string,
    label: string,
  ) => {
    const isDragging = drag?.band === band;
    return (
      <div
        className={`absolute h-5 rounded-md border flex items-center justify-center text-[10px] font-semibold select-none ${topClass} ${bgClass} ${
          isDragging ? "shadow-md" : ""
        } ${drag?.mode === "move" && isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ left: pct(start), width: `${((end - start) / 24) * 100}%` }}
        onMouseDown={(e) => startDrag(e, band, "move")}
        title={`${label}: ${fmtHour(start)}–${fmtHour(end)}. Arrastrá para mover, los bordes para redimensionar.`}
      >
        {/* Handle izquierdo */}
        <span
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/10 rounded-l-md"
          onMouseDown={(e) => startDrag(e, band, "left")}
        />
        {/* Texto + valores */}
        <span className="pointer-events-none px-1 truncate">
          {label} {fmtHour(start)}–{fmtHour(end)}
        </span>
        {/* Handle derecho */}
        <span
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black/10 rounded-r-md"
          onMouseDown={(e) => startDrag(e, band, "right")}
        />
      </div>
    );
  };

  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-5">
      <div ref={railRef} className="relative h-16">
        {/* Eje */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-slate-200" />
        {/* Marcas cada 4h */}
        {[0, 4, 8, 12, 16, 20, 24].map((h) => (
          <div key={h} className="absolute top-0 h-full pointer-events-none" style={{ left: pct(h) }}>
            <div className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-slate-300" />
            <div className="absolute -bottom-0.5 -translate-x-1/2 text-[10px] font-medium text-slate-500 tabular-nums">
              {fmtHour(h)}
            </div>
          </div>
        ))}
        {renderBand("morning", morningStart, morningEnd, "top-1", "bg-amber-200 border-amber-300 text-amber-900", "Mañana")}
        {renderBand("afternoon", afternoonStart, afternoonEnd, "bottom-6", "bg-indigo-200 border-indigo-300 text-indigo-900", "Tarde")}
      </div>
      <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
        Arrastrá las barras para mover el rango. Los bordes (izquierdo/derecho) redimensionan. Snap a horas enteras.
      </p>
    </div>
  );
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
    (DISPATCH_FIELDS.some((f) => draft[f.key] !== config[f.key]) ||
      HOUR_KEYS.some((k) => draft[k] !== config[k]) ||
      draft.enforce_time_windows !== config.enforce_time_windows ||
      draft.last_mile_packing_strategy !== config.last_mile_packing_strategy ||
      draft.inter_branch_dispatch_hour !== config.inter_branch_dispatch_hour ||
      draft.inter_branch_avg_speed_kmh !== config.inter_branch_avg_speed_kmh ||
      draft.inter_branch_stop_minutes !== config.inter_branch_stop_minutes ||
      draft.backhaul_enabled !== config.backhaul_enabled ||
      draft.keep_one_vehicle_per_branch !== config.keep_one_vehicle_per_branch ||
      draft.fleet_projection_horizon_hours !== config.fleet_projection_horizon_hours);

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
                    className="w-10 h-6 rounded-full transition-colors"
                    style={{
                      background: draft?.enforce_time_windows
                        ? "var(--brand)"
                        : "var(--border-strong)",
                    }}
                  />
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full shadow transition-transform ${
                      draft?.enforce_time_windows ? "translate-x-5" : "translate-x-1"
                    }`}
                    style={{ background: "#fff" }}
                  />
                </div>
                <span className="text-sm text-slate-700">
                  {draft?.enforce_time_windows ? "Activo (ventanas duras)" : "Inactivo (ventanas blandas)"}
                </span>
              </label>
            </div>

            {/* Backhauling */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Backhauling (round-trip)</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                Cuando un vehículo va de A→B, si en B hay carga suficiente (min_fill o SLA) que
                debe volver hacia A, el motor arma el retorno A→B→A en el mismo viaje.
              </p>
              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <div
                  className="relative w-11 h-6 rounded-full transition-colors"
                  style={{ background: draft?.backhaul_enabled ? "var(--sidebar-bg)" : "#e5e7eb" }}
                  onClick={() => setDraft((d) => (d ? { ...d, backhaul_enabled: !d.backhaul_enabled } : d))}
                >
                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${draft?.backhaul_enabled ? "translate-x-5" : "translate-x-1"}`} style={{ background: "#fff" }} />
                </div>
                <span className="text-sm text-slate-700">
                  {draft?.backhaul_enabled ? "Activo" : "Inactivo"}
                </span>
              </label>
            </div>

            {/* Despacho proyectado */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Horizonte de despacho proyectado (horas)</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                Ventana en horas para usar vehículos en tránsito hacia la sucursal. Si la ETA cae
                dentro del horizonte, el motor los incluye para planificar envíos varados por falta
                de transporte. 0 = deshabilitado. Rango: 0–168 h.
              </p>
              <input
                type="number"
                min={0}
                max={168}
                value={draft?.fleet_projection_horizon_hours ?? 24}
                onChange={(e) => setDraft((d) => d ? { ...d, fleet_projection_horizon_hours: parseInt(e.target.value) || 0 } : d)}
                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            {/* Balanceo de flota */}
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Balanceo de flota (≥1 vehículo por sucursal)</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                El motor evita vaciar una sucursal activa de vehículos reteniendo el despacho
                de menor prioridad si quedaría sin cobertura. Nunca bloquea despachos con SLA.
              </p>
              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <div
                  className="relative w-11 h-6 rounded-full transition-colors"
                  style={{ background: draft?.keep_one_vehicle_per_branch ? "var(--sidebar-bg)" : "#e5e7eb" }}
                  onClick={() => setDraft((d) => (d ? { ...d, keep_one_vehicle_per_branch: !d.keep_one_vehicle_per_branch } : d))}
                >
                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${draft?.keep_one_vehicle_per_branch ? "translate-x-5" : "translate-x-1"}`} style={{ background: "#fff" }} />
                </div>
                <span className="text-sm text-slate-700">
                  {draft?.keep_one_vehicle_per_branch ? "Activo" : "Inactivo"}
                </span>
              </label>
            </div>

            {DISPATCH_FIELDS.map((field) => {
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
                    <span className="text-xs font-semibold text-[var(--sidebar-bg)] tabular-nums">
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

          </CardContent>
        </Card>
      )}

      {/* Ventanas operativas (Fase 3): definir qué horarios son "morning" y "afternoon" */}
      {!loading && draft && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--sidebar-bg)]" />
              Ventanas operativas
            </CardTitle>
            <CardDescription>
              Definí los horarios que cuentan como ventana de mañana y de tarde para los envíos.
              El motor de ruteo prueba distintas horas de salida del chofer dentro de este rango
              para maximizar las entregas en ventana. Los rangos pueden solaparse.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <WindowTimeline
              morningStart={draft.morning_window_start_hour}
              morningEnd={draft.morning_window_end_hour}
              afternoonStart={draft.afternoon_window_start_hour}
              afternoonEnd={draft.afternoon_window_end_hour}
              onMorningChange={(start, end) =>
                setDraft((d) =>
                  d ? { ...d, morning_window_start_hour: start, morning_window_end_hour: end } : d,
                )
              }
              onAfternoonChange={(start, end) =>
                setDraft((d) =>
                  d ? { ...d, afternoon_window_start_hour: start, afternoon_window_end_hour: end } : d,
                )
              }
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-amber-900">Mañana — desde</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={draft.morning_window_start_hour}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, morning_window_start_hour: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-amber-900">Mañana — hasta</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  value={draft.morning_window_end_hour}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, morning_window_end_hour: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-indigo-900">Tarde — desde</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={draft.afternoon_window_start_hour}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, afternoon_window_start_hour: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-indigo-900">Tarde — hasta</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  value={draft.afternoon_window_end_hour}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, afternoon_window_end_hour: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estrategia de asignación a choferes */}
      {!loading && draft && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Estrategia de asignación a choferes</CardTitle>
            <CardDescription>
              Cómo el motor reparte los envíos entre los choferes disponibles cuando hay más
              de uno en la sucursal.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Modo</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                <strong>Maximizar capacidad:</strong> satura el primer chofer hasta su tope antes de abrir el siguiente.
                Libera choferes para otras tareas.<br />
                <strong>Balanceado:</strong> reparte parejo entre todos los choferes disponibles.
              </p>
              <div className="grid gap-2">
                {(
                  [
                    { value: "maximize_capacity", label: "Maximizar capacidad" },
                    { value: "balanced", label: "Balanceado" },
                  ] as { value: LastMilePackingStrategy; label: string }[]
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                      draft.last_mile_packing_strategy === opt.value
                        ? "border-[var(--brand)] bg-blue-50 ring-1 ring-[var(--brand)]/20"
                        : "border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="packing_strategy"
                      value={opt.value}
                      checked={draft.last_mile_packing_strategy === opt.value}
                      onChange={() =>
                        setDraft((d) => (d ? { ...d, last_mile_packing_strategy: opt.value } : d))
                      }
                      className="accent-[var(--brand)]"
                    />
                    <span
                      className={`text-sm font-semibold ${
                        draft.last_mile_packing_strategy === opt.value
                          ? "text-[var(--brand)]"
                          : "text-slate-700"
                      }`}
                    >
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Hora de salida inter-sucursal</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                Hora fija (0–23, hora local ART) a la que todos los despachos inter-sucursal del día están planificados para salir.
                Se usa para calcular las llegadas estimadas en el calendario.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={draft.inter_branch_dispatch_hour ?? 8}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, inter_branch_dispatch_hour: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
                <span className="text-xs font-semibold text-[var(--sidebar-bg)] tabular-nums">
                  {String(draft.inter_branch_dispatch_hour ?? 8).padStart(2, "0")}:00
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Velocidad de ruta inter-sucursal (km/h)</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                Velocidad usada para estimar la llegada de viajes inter-sucursal cuando no hay tiempo de tránsito
                histórico para el tramo. Es distinta de la velocidad urbana de última milla. Rango 20–120.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={20}
                  max={120}
                  step={5}
                  value={draft.inter_branch_avg_speed_kmh ?? 60}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, inter_branch_avg_speed_kmh: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
                <span className="text-xs font-semibold text-[var(--sidebar-bg)] tabular-nums">
                  {draft.inter_branch_avg_speed_kmh ?? 60} km/h
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-semibold text-slate-700">Tiempo en parada intermedia inter-sucursal (min)</label>
              <p className="text-xs text-slate-500 leading-relaxed -mt-1">
                Dwell de descarga + carga de pallets en una parada intermedia de un viaje multi-hop
                (ej. bajar y subir envíos en Córdoba camino a Mendoza). Independiente del tiempo de
                entrega de última milla. Rango 0–1440 min (hasta 24 h).
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={1440}
                  step={15}
                  value={draft.inter_branch_stop_minutes ?? 240}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, inter_branch_stop_minutes: Number(e.target.value) } : d))
                  }
                  className={inputClass}
                />
                <span className="text-xs font-semibold text-[var(--sidebar-bg)] tabular-nums">
                  {(() => {
                    const m = draft.inter_branch_stop_minutes ?? 240;
                    const h = Math.floor(m / 60);
                    const rem = m % 60;
                    return h > 0 ? `${h}h${rem > 0 ? ` ${rem}min` : ""}` : `${rem}min`;
                  })()}
                </span>
              </div>
            </div>

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
