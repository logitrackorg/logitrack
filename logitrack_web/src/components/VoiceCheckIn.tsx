import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, SkipForward, Volume2 } from "lucide-react";
import { driverApi } from "../api/driver";

const MIN_AUDIO_BYTES = 2500;

const INVALID_AUDIO_MSG =
  "No hemos detectado una grabación válida. Por favor, intenta nuevamente leyendo la frase.";

// Umbral de energía RMS para distinguir voz real de silencio/micrófono muteado.
// Voz conversacional normal: RMS ≈ 0.02–0.30
// Ruido de fondo leve:       RMS ≈ 0.001–0.005
// Micrófono muteado/silencio: RMS ≈ 0.0001 o menos
// Umbral conservador de 0.01 — deja pasar incluso voces muy suaves.
const VOICE_RMS_THRESHOLD = 0.01;

type RecordingState = "idle" | "recording" | "recorded" | "uploading";

interface Props {
  onDone: () => void;
}

export function VoiceCheckIn({ onDone }: Props) {
  const [phrase, setPhrase]         = useState<string>("");
  const [state, setState]           = useState<RecordingState>("idle");
  const [seconds, setSeconds]       = useState(0);
  const [errorMsg, setErrorMsg]     = useState("");
  const [hasChunks, setHasChunks]   = useState(false);
  // Mensaje informativo cuando la grabación se acepta pero no genera score todavía.
  const [retryMsg, setRetryMsg]     = useState("");

  const mediaRef       = useRef<MediaRecorder | null>(null);
  const chunksRef      = useRef<Blob[]>([]);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  // Lock síncrono contra invocaciones concurrentes de startRecording: el botón
  // sigue mostrando "Iniciar grabación" (state aún "idle") mientras se espera
  // la promesa de getUserMedia, así que un doble-tap dispararía dos streams/
  // recorders en simultáneo, mezclando sus chunks en el mismo blob — produciendo
  // un audio corrupto que el backend no puede puntuar (race condition reportada en QA).
  const startingRef    = useRef(false);

  // Web Audio API — análisis de energía en tiempo real
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const energyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // true si en algún momento durante la grabación se detectó energía de voz real.
  const hasVoiceRef    = useRef(false);

  useEffect(() => {
    driverApi
      .getControlPhrase()
      .then((d) => setPhrase(d.phrase))
      .catch(() => setPhrase("Hoy es un buen día para trabajar con seguridad."));
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      stopEnergyAnalysis();
      mediaRef.current?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const stopEnergyAnalysis = () => {
    if (energyTimerRef.current) { clearInterval(energyTimerRef.current); energyTimerRef.current = null; }
    if (analyserRef.current)    { analyserRef.current.disconnect(); analyserRef.current = null; }
    if (audioCtxRef.current)    { audioCtxRef.current.close();      audioCtxRef.current = null; }
  };

  const startRecording = async () => {
    // Guard contra re-entradas: ignorar taps mientras getUserMedia sigue
    // pendiente — "Grabando" recién se activa cuando la promesa resuelve, así
    // que sin este lock un doble-tap inicia dos streams concurrentes.
    if (startingRef.current) return;
    startingRef.current = true;

    setErrorMsg("");
    setRetryMsg("");
    chunksRef.current = [];
    setHasChunks(false);
    hasVoiceRef.current = false; // resetear antes de cada nueva grabación

    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) { chunksRef.current.push(e.data); setHasChunks(true); }
      };
      recorder.onstop = () => stream.getTracks().forEach((t) => t.stop());

      // ── Análisis de energía RMS en tiempo real ─────────────────────────────
      // Chrome no activa DTX por defecto → los frames de silencio y voz tienen
      // el mismo tamaño en bytes, haciendo inútil el VAD basado en frames EBML.
      // La Web Audio API mide la amplitud real del micrófono, sin importar cómo
      // Opus comprima los datos. Detecta micrófono muteado con 100 % de precisión.
      try {
        type AudioCtxCtor = typeof AudioContext;
        const Ctor = (window.AudioContext ??
          (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext);
        const ctx = new Ctor();
        audioCtxRef.current = ctx;

        const source   = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buf = new Float32Array(analyser.fftSize);
        energyTimerRef.current = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          // RMS = raíz cuadrada de la media de los cuadrados de las muestras
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
          if (rms > VOICE_RMS_THRESHOLD) hasVoiceRef.current = true;
        }, 100); // muestrear cada 100 ms
      } catch {
        // Web Audio API no disponible (contexto seguro requerido, etc.).
        // Fallback: dejar pasar; el VAD del backend actuará como segunda barrera.
        hasVoiceRef.current = true;
      }

      recorder.start(100);
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setErrorMsg("No se pudo acceder al micrófono. Verificá los permisos.");
    } finally {
      // Liberar el lock recién acá: con state ya en "recording" (o el error ya
      // mostrado), el botón "Iniciar grabación" deja de estar visible/habilitado,
      // así que no hay ventana para una segunda invocación concurrente.
      startingRef.current = false;
    }
  };

  const stopRecording = () => {
    stopTimer();
    stopEnergyAnalysis();
    mediaRef.current?.stop();
    setState("recorded");

    // Mostrar error de inmediato si no se detectó voz durante la grabación,
    // sin esperar a que el chofer presione "Enviar".
    if (!hasVoiceRef.current) {
      setErrorMsg(INVALID_AUDIO_MSG);
    }
  };

  const handleUpload = async () => {
    if (chunksRef.current.length === 0) return;

    // Guard 1: sin energía de voz detectada en tiempo real
    if (!hasVoiceRef.current) {
      setErrorMsg(INVALID_AUDIO_MSG);
      return;
    }

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });

    // Guard 2: blob demasiado pequeño (silencio con DTX activo)
    if (blob.size < MIN_AUDIO_BYTES) {
      setErrorMsg(INVALID_AUDIO_MSG);
      return;
    }

    setState("uploading");
    setErrorMsg("");
    setRetryMsg("");
    try {
      const result = await driverApi.uploadVoice(blob);
      if (result.drift_score === null) {
        // La grabación fue aceptada pero no pudo generar un score comparativo
        // (sin línea base previa o audio de muy baja calidad).
        // Pedir que grabe nuevamente para obtener un análisis válido.
        setState("idle");
        setHasChunks(false);
        setRetryMsg(
          "No se pudo obtener un puntaje de la grabación. " +
          "Por favor, leé la frase en voz alta nuevamente."
        );
      } else {
        onDone();
      }
    } catch (err: unknown) {
      const respData = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      const isInvalidAudio = respData?.error === "INVALID_AUDIO";
      setErrorMsg(isInvalidAudio && respData?.message
        ? respData.message
        : "No se pudo enviar el audio. Intentá de nuevo.");
      setState("recorded");
    }
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

            {state === "recorded" && hasChunks && !errorMsg && (
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

          {retryMsg && (
            <p className="text-sm text-amber-400 text-center leading-snug">{retryMsg}</p>
          )}
          {errorMsg && (
            <p className="text-sm text-rose-400 text-center leading-snug">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}
