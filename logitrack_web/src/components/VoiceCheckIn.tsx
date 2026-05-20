import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, SkipForward, Volume2 } from "lucide-react";
import { driverApi } from "../api/driver";

// Grabaciones de silencio puro (sin voz) generan blobs muy pequeños: solo
// cabeceras del contenedor WebM + frames de silencio muy comprimidos.
// 2 500 bytes es un umbral conservador que filtra silencios sin rechazar
// grabaciones legítimas de baja calidad de audio.
const MIN_AUDIO_BYTES = 2500;

const INVALID_AUDIO_MSG =
  "No hemos detectado una grabación válida. Por favor, intenta nuevamente leyendo la frase.";

type RecordingState = "idle" | "recording" | "recorded" | "uploading";

interface Props {
  onDone: () => void;
}

export function VoiceCheckIn({ onDone }: Props) {
  const [phrase, setPhrase]     = useState<string>("");
  const [state, setState]       = useState<RecordingState>("idle");
  const [seconds, setSeconds]   = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasChunks, setHasChunks] = useState(false);

  const mediaRef  = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    driverApi
      .getControlPhrase()
      .then((d) => setPhrase(d.phrase))
      .catch(() => setPhrase("Hoy es un buen día para trabajar con seguridad."));
  }, []);

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
    setHasChunks(false);
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          setHasChunks(true);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(100);
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

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });

    // Validación local: silencio o grabación vacía producen blobs muy pequeños.
    if (blob.size < MIN_AUDIO_BYTES) {
      setErrorMsg(INVALID_AUDIO_MSG);
      return; // el estado se mantiene en "recorded" para permitir reintentar
    }

    setState("uploading");
    setErrorMsg("");
    try {
      await driverApi.uploadVoice(blob);
      // Éxito: avanzar directamente a la prueba PVT sin mostrar estadísticas.
      onDone();
    } catch (err: unknown) {
      const serverMsg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      // El backend devuelve 400 cuando detecta silencio o audio inválido.
      setErrorMsg(serverMsg.includes("inválida") || serverMsg.includes("vacío")
        ? INVALID_AUDIO_MSG
        : "No se pudo enviar el audio. Intentá de nuevo.");
      setState("recorded"); // habilitar el botón "Enviar audio" para reintentar
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

            {state === "recorded" && hasChunks && (
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

          {errorMsg && (
            <p className="text-sm text-rose-400 text-center leading-snug">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}
