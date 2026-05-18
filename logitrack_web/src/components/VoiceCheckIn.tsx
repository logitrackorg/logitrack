import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, SkipForward, Volume2 } from "lucide-react";
import { driverApi, type VoiceUploadResult } from "../api/driver";

type RecordingState = "idle" | "recording" | "recorded" | "uploading" | "done" | "error";

interface Props {
  onDone: () => void;
}

export function VoiceCheckIn({ onDone }: Props) {
  const [phrase, setPhrase] = useState<string>("");
  const [state, setState] = useState<RecordingState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<VoiceUploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the personalised control phrase on mount.
  useEffect(() => {
    driverApi
      .getControlPhrase()
      .then((d) => setPhrase(d.phrase))
      .catch(() => setPhrase("Hoy es un buen día para trabajar con seguridad."));
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopTimer();
      mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    setErrorMsg("");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100); // collect chunks every 100 ms
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setErrorMsg("No se pudo acceder al micrófono. Verificá los permisos.");
    }
  };

  const stopRecording = () => {
    stopTimer();
    mediaRef.current?.stop();
    setState("recorded");
  };

  const handleUpload = async () => {
    if (chunksRef.current.length === 0) return;
    setState("uploading");
    setErrorMsg("");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const data = await driverApi.uploadVoice(blob);
      setResult(data);
      setState("done");
    } catch {
      setErrorMsg("No se pudo enviar el audio. Intentá de nuevo.");
      setState("recorded");
    }
  };

  const driftColor = (score: number | null) => {
    if (score === null) return "text-slate-400";
    if (score <= 25) return "text-emerald-400";
    if (score <= 50) return "text-amber-400";
    if (score <= 75) return "text-orange-400";
    return "text-rose-400";
  };

  const driftLabel = (score: number | null) => {
    if (score === null) return "Sin historial previo — este registro será tu línea base.";
    if (score <= 25) return "Voz normal — sin signos de fatiga.";
    if (score <= 50) return "Leve desvío — prestá atención.";
    if (score <= 75) return "Desvío moderado — considerá descansar.";
    return "Desvío alto — se recomienda no conducir.";
  };

  return (
    <div className="fixed inset-0 z-[3000] bg-[#0f2744]/95 backdrop-blur-sm flex flex-col">
      {/* Skip button */}
      <div className="flex justify-end px-4 pt-4">
        <button
          onClick={onDone}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors cursor-pointer"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Saltar test
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="max-w-md mx-auto pt-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">Análisis de voz</h1>
              <p className="text-xs text-slate-400">Leé la frase en voz alta para el análisis acústico</p>
            </div>
          </div>

          {/* Control phrase */}
          <div className="mb-6 px-4 py-4 rounded-xl bg-slate-800 border border-slate-600">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Frase de control
            </p>
            {phrase ? (
              <p className="text-base font-semibold text-white leading-relaxed">"{phrase}"</p>
            ) : (
              <div className="h-5 w-3/4 rounded bg-slate-700 animate-pulse" />
            )}
          </div>

          {/* Recording controls */}
          {state !== "done" && (
            <div className="mb-6">
              {state === "idle" || state === "recorded" ? (
                <button
                  onClick={startRecording}
                  className="w-full h-14 rounded-xl bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white font-bold text-base cursor-pointer transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Mic className="w-5 h-5" />
                  {state === "recorded" ? "Grabar de nuevo" : "Iniciar grabación"}
                </button>
              ) : state === "recording" ? (
                <button
                  onClick={stopRecording}
                  className="w-full h-14 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-base cursor-pointer transition-colors inline-flex items-center justify-center gap-2 animate-pulse"
                >
                  <MicOff className="w-5 h-5" />
                  Detener ({seconds}s)
                </button>
              ) : null}

              {state === "recorded" && chunksRef.current.length > 0 && (
                <button
                  onClick={handleUpload}
                  className="mt-3 w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-base cursor-pointer transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Enviar audio
                </button>
              )}

              {state === "uploading" && (
                <div className="mt-3 w-full h-12 rounded-xl bg-slate-700 text-slate-400 font-bold text-base inline-flex items-center justify-center gap-2">
                  <Send className="w-4 h-4 animate-pulse" />
                  Analizando…
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {state === "done" && result && (
            <div className="mb-6 px-4 py-4 rounded-xl bg-slate-800 border border-slate-600">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                Resultado del análisis
              </p>
              <div className="flex items-baseline gap-3 mb-2">
                <span className={`text-4xl font-black ${driftColor(result.drift_score)}`}>
                  {result.drift_score ?? "—"}
                </span>
                <span className="text-xs text-slate-400">/ 100 drift score</span>
              </div>
              <p className={`text-sm font-semibold ${driftColor(result.drift_score)}`}>
                {driftLabel(result.drift_score)}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                <span>Tono medio: <strong className="text-slate-200">{result.voice_metrics.pitch_mean.toFixed(1)} Hz</strong></span>
                <span>Rango tonal: <strong className="text-slate-200">{result.voice_metrics.pitch_range.toFixed(1)} Hz</strong></span>
                <span>Energía RMS: <strong className="text-slate-200">{result.voice_metrics.energy_rms.toFixed(3)}</strong></span>
                <span>Vel. habla: <strong className="text-slate-200">{result.voice_metrics.speech_rate.toFixed(2)} sil/s</strong></span>
                <span>Ratio pausa: <strong className="text-slate-200">{(result.voice_metrics.pause_ratio * 100).toFixed(1)}%</strong></span>
                {result.baseline === null && (
                  <span className="col-span-2 text-violet-400">✓ Línea base registrada</span>
                )}
              </div>

              <button
                onClick={onDone}
                className="mt-5 w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm cursor-pointer transition-colors"
              >
                Continuar
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="mt-2 text-sm text-rose-400 text-center">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}
