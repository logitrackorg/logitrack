import { useState } from "react";
import { AlertTriangle, Moon, SkipForward, Send } from "lucide-react";
import { driverApi } from "../api/driver";
import { VoiceCheckIn } from "./VoiceCheckIn";

const KSS_LEVELS = [
  { value: 1, label: "Extremadamente alerta" },
  { value: 2, label: "Muy alerta" },
  { value: 3, label: "Alerta" },
  { value: 4, label: "Bastante alerta" },
  { value: 5, label: "Ni alerta ni somnoliento" },
  { value: 6, label: "Algunos signos de somnolencia" },
  { value: 7, label: "Somnoliento, pero sin esfuerzo para permanecer despierto" },
  { value: 8, label: "Somnoliento, con algo de esfuerzo para permanecer despierto" },
  { value: 9, label: "Extremadamente somnoliento, gran esfuerzo para mantenerse despierto, luchando contra el sueño" },
];

function kssColor(v: number) {
  if (v <= 3) return "bg-emerald-500";
  if (v <= 5) return "bg-amber-400";
  if (v <= 7) return "bg-orange-500";
  return "bg-rose-600";
}

interface Props {
  driverId: string;
  onDone: () => void;
}

export function KssCheckIn({ driverId, onDone }: Props) {
  const [step, setStep] = useState<"kss" | "voice">("kss");
  const [horasSueno, setHorasSueno] = useState<string>("");
  const [kss, setKss] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Estado del modal de confirmación de salto
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const handleSkipConfirmed = async () => {
    setSkipping(true);
    try {
      await driverApi.skipCheckin();
    } catch {
      // Si falla el registro del salto, dejamos pasar de todas formas
      // para no bloquear al chofer — el error es no crítico.
    } finally {
      setSkipping(false);
      setShowSkipConfirm(false);
      onDone();
    }
  };

  const horasNum = parseInt(horasSueno, 10);
  const horasValid = !Number.isNaN(horasNum) && horasNum >= 0 && horasNum <= 10;
  const canSubmit = horasValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await driverApi.submitCheckin({ driver_id: driverId, horas_sueno: horasNum, kss_level: kss });
      // Advance to the voice step instead of calling onDone directly.
      setStep("voice");
    } catch {
      setError("No se pudo registrar el check-in. Intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  // Render the voice step as a full replacement of this screen.
  if (step === "voice") {
    return <VoiceCheckIn onDone={onDone} />;
  }

  return (
    <div className="fixed inset-0 z-[3000] bg-[#0f2744]/95 backdrop-blur-sm flex flex-col">
      {/* Skip button */}
      <div className="flex justify-end px-4 pt-4">
        <button
          onClick={() => setShowSkipConfirm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Saltar test
        </button>
      </div>

      {/* Content */}
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

          {/* Horas de sueño */}
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

          {/* KSS Slider */}
          <div className="mb-8">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
              Escala de somnolencia KSS
            </label>

            {/* Level display */}
            <div className="mb-4 px-4 py-3 rounded-xl bg-slate-800 border border-slate-600">
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-black text-white`}>{kss}</span>
                <span className="text-sm text-slate-300 leading-snug">{KSS_LEVELS[kss - 1].label}</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-200 ${kssColor(kss)}`}
                  style={{ width: `${((kss - 1) / 8) * 100}%` }}
                />
              </div>
            </div>

            {/* Level grid */}
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {KSS_LEVELS.map((lvl) => (
                <button
                  key={lvl.value}
                  onClick={() => setKss(lvl.value)}
                  className={`px-2 py-2 rounded-lg border text-left transition-all cursor-pointer ${
                    kss === lvl.value
                      ? "border-blue-500 bg-blue-500/20 text-white"
                      : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  <span className="block text-xs font-bold">{lvl.value}</span>
                  <span className="block text-[10px] leading-tight mt-0.5 line-clamp-2">{lvl.label}</span>
                </button>
              ))}
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

      {/* ── Modal de confirmación de salto ──────────────────────────── */}
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
