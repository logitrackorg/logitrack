import { useEffect, useState } from "react";
import { AlertTriangle, Info, Moon, Shield, SkipForward, Send, X } from "lucide-react";
import { driverApi } from "../api/driver";
import { VoiceCheckIn } from "./VoiceCheckIn";
import { PVTCheckIn } from "./PVTCheckIn";

// ── Escala KSS de 8 puntos ────────────────────────────────────────────────────
// El punto neutro original (nivel 5 "Ni alerta ni somnoliento") fue eliminado
// para obligar al chofer a posicionarse en el lado alerta o en el lado somnoliento.
const KSS_LEVELS = [
  { value: 1, label: "Extremadamente alerta" },
  { value: 2, label: "Muy alerta" },
  { value: 3, label: "Alerta" },
  { value: 4, label: "Bastante alerta" },
  { value: 5, label: "Algunos signos de somnolencia" },
  { value: 6, label: "Somnoliento, sin esfuerzo para mantenerse despierto" },
  { value: 7, label: "Somnoliento, con esfuerzo para mantenerse despierto" },
  { value: 8, label: "Extremadamente somnoliento, gran esfuerzo para no dormirse" },
] as const;

function kssAccentColor(v: number): string {
  if (v <= 3) return "var(--ok)";     // emerald — alerta
  if (v <= 5) return "var(--warn)";   // amber   — leve somnolencia
  if (v <= 7) return "var(--warn)";   // orange  — somnolencia
  return "var(--danger-c)";           // rose    — alto riesgo
}

function kssBandLabel(v: number): { text: string; cls: string } {
  if (v <= 3) return { text: "Alerta",      cls: "text-emerald-400" };
  if (v <= 5) return { text: "Moderado",    cls: "text-amber-400"   };
  if (v <= 7) return { text: "Somnolencia", cls: "text-orange-400"  };
  return               { text: "Alto riesgo", cls: "text-rose-400"  };
}

interface Props {
  driverId: string;
  onDone: () => void;
  /** Cantidad de misfires que dispararon este check-in. Se muestra en el toast de skip. */
  misfireCount?: number;
  /**
   * true  → el driver aún no reportó horas de sueño hoy, mostrar el campo.
   * false → ya existe un registro de sueño para este día logístico, omitir el campo.
   * Default: true (comportamiento seguro ante datos desconocidos).
   */
  requiresSleepData?: boolean;
}

export function KssCheckIn({ driverId, onDone, misfireCount = 0, requiresSleepData = true }: Props) {
  const [step, setStep] = useState<"kss" | "voice" | "pvt">("kss");
  const [horasSueno, setHorasSueno] = useState<string>("");
  const [kss, setKss] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [showInfo, setShowInfo] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // Toast post-skip con conteo de misfires.
  const [showSkipToast, setShowSkipToast] = useState(false);

  // Toast que aparece cuando el chofer intenta retroceder con el botón atrás.
  const [showBackWarning, setShowBackWarning] = useState(false);

  // ── Bloqueo del botón "Atrás" del navegador / celular ────────────────────
  // Insertamos un estado extra en el historial para siempre tener algo que
  // interceptar. Cuando popstate se dispara, volvemos a insertar el estado y
  // mostramos el aviso — nunca se sale de la pantalla por el botón atrás.
  useEffect(() => {
    window.history.pushState({ fatigueGate: true }, "");

    const handlePopState = () => {
      window.history.pushState({ fatigueGate: true }, "");
      setShowBackWarning(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Auto-ocultar el aviso de retroceso a los 4 segundos.
  useEffect(() => {
    if (!showBackWarning) return;
    const t = setTimeout(() => setShowBackWarning(false), 4000);
    return () => clearTimeout(t);
  }, [showBackWarning]);

  const handleSkipConfirmed = async () => {
    setSkipping(true);
    try {
      await driverApi.skipCheckin();
    } catch {
      // No crítico — registrar el salto puede fallar sin bloquear al chofer.
    } finally {
      setSkipping(false);
      setShowSkipConfirm(false);
      // Mostrar toast informativo con el conteo de misfires, luego cerrar.
      setShowSkipToast(true);
      setTimeout(() => {
        setShowSkipToast(false);
        onDone();
      }, 3000);
    }
  };

  const horasNum = parseInt(horasSueno, 10);
  const horasValid = !Number.isNaN(horasNum) && horasNum >= 0 && horasNum <= 10;
  const canSubmit = (!requiresSleepData || horasValid) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        driver_id: driverId,
        kss_level: kss,
        ...(requiresSleepData ? { horas_sueno: horasNum } : {}),
      };
      const result = await driverApi.submitCheckin(payload);
      // Backend can still ask for sleep data if the record wasn't found
      // (e.g. race condition or first submission without sleep). Show field and retry.
      if (result && (result as { requires_sleep_data?: boolean }).requires_sleep_data) {
        setError("Ingresá tus horas de sueño para continuar.");
        return;
      }
      setStep("voice");
    } catch {
      setError("No se pudo registrar el check-in. Intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "voice") return <VoiceCheckIn onDone={() => setStep("pvt")} />;
  if (step === "pvt")   return <PVTCheckIn onDone={onDone} />;

  const fillPct      = ((kss - 1) / 7) * 100;
  const accent       = kssAccentColor(kss);
  const band         = kssBandLabel(kss);
  const currentLevel = KSS_LEVELS[kss - 1];

  return (
    <div className="fixed inset-0 z-[3000] bg-[#0f2744]/95 backdrop-blur-sm flex flex-col">

      {/* ── Toast: check-in saltado + conteo de misfires ────────────────── */}
      {showSkipToast && (
        <div className="absolute top-4 inset-x-4 z-[5000] flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 shadow-lg backdrop-blur-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300 leading-snug flex-1">
            Check-in omitido.{" "}
            {misfireCount > 0
              ? <>Registraste <strong className="text-amber-200">{misfireCount}</strong> {misfireCount === 1 ? "toque erróneo" : "toques erróneos"} en esta entrega.</>
              : "El salto quedó registrado en tu historial."}
          </p>
        </div>
      )}

      {/* ── Toast: intento de retroceso ──────────────────────────────────── */}
      {showBackWarning && (
        <div className="absolute top-4 inset-x-4 z-[5000] flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 shadow-lg backdrop-blur-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300 leading-snug flex-1">
            Debés completar el registro de seguridad para continuar, o seleccionar{" "}
            <strong className="text-amber-200">Saltar test</strong> si está permitido.
          </p>
          <button
            onClick={() => setShowBackWarning(false)}
            className="shrink-0 text-amber-400 hover:text-amber-200 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Barra superior: info + saltar ────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 shrink-0">
        <button
          onClick={() => setShowInfo(true)}
          aria-label="Información sobre los datos recopilados"
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-blue-300 hover:bg-slate-700/60 transition-colors cursor-pointer"
        >
          <Info className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowSkipConfirm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Saltar test
        </button>
      </div>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="max-w-md mx-auto pt-4">

          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">Check-in de fatiga</h1>
              <p className="text-xs text-slate-400">Completá el test antes de iniciar tu jornada</p>
            </div>
          </div>

          {/* Horas de sueño — solo si no hay registro para el día logístico */}
          {requiresSleepData ? (
            <div className="mb-6">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Horas de sueño (noche anterior)
              </label>
              <input
                type="number"
                min={0}
                max={10}
                value={horasSueno}
                onChange={(e) => setHorasSueno(e.target.value)}
                placeholder="0 – 10"
                className="w-full h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 text-white text-base placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {horasSueno !== "" && !horasValid && (
                <p className="mt-1.5 text-xs text-rose-400">Ingresá un valor entre 0 y 10.</p>
              )}
            </div>
          ) : (
            <div className="mb-6 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700">
              <Moon className="w-4 h-4 text-blue-400 shrink-0" />
              <p className="text-xs text-slate-400 leading-snug">
                Horas de sueño ya registradas para este día logístico.
              </p>
            </div>
          )}

          {/* ── KSS Slider ─────────────────────────────────────────────────── */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Escala de somnolencia KSS
              </label>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 ${band.cls}`}>
                {band.text}
              </span>
            </div>

            {/* Tarjeta del nivel actual */}
            <div className="mb-5 px-4 py-4 rounded-xl bg-slate-800 border border-slate-700">
              <div className="flex items-baseline gap-3 mb-3">
                <span
                  className="text-4xl font-black tabular-nums transition-colors duration-150"
                  style={{ color: accent }}
                >
                  {kss}
                </span>
                <span className="text-sm text-slate-200 leading-snug font-medium">
                  {currentLevel.label}
                </span>
              </div>

              {/* Barra de progreso */}
              <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-150"
                  style={{ width: `${fillPct}%`, background: accent }}
                />
              </div>

              {/* Etiquetas de extremo */}
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-slate-500">Muy alerta</span>
                <span className="text-[10px] text-slate-500">Muy somnoliento</span>
              </div>
            </div>

            {/* Slider nativo — zona táctil de 44 px para mobile */}
            <div className="px-1">
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                value={kss}
                onChange={(e) => setKss(parseInt(e.target.value, 10))}
                className="w-full cursor-pointer"
                style={{
                  accentColor: accent,
                  height: "44px",
                  touchAction: "none",
                }}
              />

              {/* Ticks numéricos bajo el slider */}
              <div className="flex justify-between mt-1 px-0.5">
                {KSS_LEVELS.map((lvl) => (
                  <span
                    key={lvl.value}
                    className="text-[11px] tabular-nums font-bold transition-colors duration-150"
                    style={{ color: lvl.value === kss ? accent : "#475569" }}
                  >
                    {lvl.value}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="mb-4 text-sm text-rose-400 text-center">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-base cursor-pointer disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            {submitting ? "Registrando…" : "Registrar check-in"}
          </button>
        </div>
      </div>

      {/* ── Modal de consentimiento informado (Ley 25.326 art. 6) ──────────── */}
      {showInfo && (
        <div className="fixed inset-0 z-[4000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-[#0d1f38] border border-slate-700 shadow-2xl flex flex-col max-h-[90dvh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-white leading-snug">
                  Privacidad y datos recopilados
                </h2>
              </div>
              <button
                onClick={() => setShowInfo(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4 space-y-4 text-xs text-slate-300 leading-relaxed">
              <Section title="¿Qué datos se recopilan?">
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li>Horas de sueño de la noche anterior</li>
                  <li>Nivel de somnolencia según la Escala KSS (1–8)</li>
                  <li>Métricas acústicas de voz: tono, energía, velocidad de habla y pausas</li>
                  <li>Puntaje de desvío vocal respecto a tu línea base personal</li>
                  <li>Fecha y hora de cada registro</li>
                </ul>
              </Section>

              <Section title="¿Con qué finalidad?">
                <p className="text-slate-400">
                  Evaluar el riesgo de fatiga antes de iniciar una jornada de conducción, prevenir accidentes derivados de somnolencia y generar registros históricos con fines de seguridad vial y laboral.
                </p>
              </Section>

              <Section title="¿Quién tiene acceso?">
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li><span className="text-slate-200 font-medium">Vos</span> — podés consultar tu historial completo</li>
                  <li><span className="text-slate-200 font-medium">El supervisor de tu sucursal</span> — ve el estado del día y el historial de tu sucursal</li>
                  <li><span className="text-slate-200 font-medium">La administración de la empresa</span> — con fines de gestión de seguridad</li>
                </ul>
              </Section>

              <div className="rounded-lg border border-blue-800/50 bg-blue-900/20 px-3 py-2.5">
                <p className="text-[11px] text-blue-300 font-semibold mb-1">
                  Ley N.º 25.326 — Art. 6 (Argentina)
                </p>
                <p className="text-[11px] text-blue-400 leading-relaxed">
                  Los datos se recopilan con tu consentimiento expreso, son utilizados exclusivamente para los fines informados y no serán cedidos a terceros sin autorización. Tenés derecho a acceder, rectificar y suprimir tus datos en cualquier momento comunicándote con el responsable del tratamiento.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-700 shrink-0">
              <button
                onClick={() => setShowInfo(false)}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold cursor-pointer transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación de salto ─────────────────────────────────── */}
      {showSkipConfirm && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-[#0f2744] border border-slate-600 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-white leading-snug">
                ¿Confirmar saltar el check-in?
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed mb-2">
              Tu decisión quedará <strong className="text-white">registrada en el historial</strong> y será visible para tu supervisor.
            </p>
            <p className="text-sm text-slate-400 leading-relaxed mb-6">
              Podrás acceder a tu ruta por las próximas{" "}
              <strong className="text-slate-200">3 horas</strong>. Pasado ese tiempo, el sistema te pedirá completar el check-in nuevamente.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowSkipConfirm(false)}
                disabled={skipping}
                className="h-11 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Volver
              </button>
              <button
                onClick={handleSkipConfirmed}
                disabled={skipping}
                className="h-11 rounded-xl bg-slate-600 hover:bg-slate-500 active:bg-slate-400 disabled:opacity-50 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
              >
                {skipping ? "Registrando…" : "Sí, saltear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{title}</p>
      {children}
    </div>
  );
}
