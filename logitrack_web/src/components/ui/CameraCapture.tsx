import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, X } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

const GUIDE_TEXT =
  "Asegurate de que se vea el paquete y algún punto referencial. No deben aparecer rostros ni patentes.";

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  async function startCamera() {
    setError("");
    setReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setReady(true);
      }
    } catch (err) {
      const e = err as Error;
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setError(
          "No se puede acceder a la cámara. Revisá los permisos en la configuración del navegador."
        );
      } else if (e.name === "NotFoundError") {
        setError("No se encontró una cámara disponible en este dispositivo.");
      } else {
        setError("No se pudo inicializar la cámara. Intentá de nuevo.");
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopCamera();
        setCapturedBlob(blob);
        setPreview(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.85
    );
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setCapturedBlob(null);
    startCamera();
  }

  function confirm() {
    if (capturedBlob) onCapture(capturedBlob);
  }

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center px-8 text-center gap-4">
        <Camera className="w-12 h-12 text-rose-400" />
        <p className="text-white text-sm leading-relaxed">{error}</p>
        <button
          onClick={onClose}
          className="mt-2 px-6 py-2.5 rounded-xl bg-white text-slate-900 text-sm font-semibold"
        >
          Volver
        </button>
      </div>
    );
  }

  // Preview state — photo taken, user confirms or retakes
  if (preview) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <img
          src={preview}
          alt="Foto capturada"
          className="flex-1 min-h-0 object-contain w-full"
        />
        <div className="bg-black px-4 pt-3 pb-[max(env(safe-area-inset-bottom,0px),16px)] flex gap-3 shrink-0">
          <button
            onClick={retake}
            className="flex-1 h-12 rounded-xl border-2 border-white/30 text-white text-sm font-bold flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Sacar de nuevo
          </button>
          <button
            onClick={confirm}
            className="flex-1 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold"
          >
            Usar foto
          </button>
        </div>
      </div>
    );
  }

  // Live camera — video fills the container, controls are absolutely positioned
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <canvas ref={canvasRef} className="hidden" />

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center"
        aria-label="Cerrar cámara"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Guide text */}
      {ready && (
        <div className="absolute bottom-32 inset-x-0 px-5">
          <p className="text-white text-xs text-center leading-relaxed drop-shadow">
            {GUIDE_TEXT}
          </p>
        </div>
      )}

      {/* Capture button */}
      <div className="absolute bottom-8 inset-x-0 flex items-center justify-center pb-[env(safe-area-inset-bottom,0px)]">
        <button
          onClick={capturePhoto}
          disabled={!ready}
          aria-label="Tomar foto"
          className="w-20 h-20 rounded-full border-4 border-white disabled:opacity-30 bg-white/20 hover:bg-white/30 active:scale-95 transition-transform flex items-center justify-center"
        >
          <div className="w-14 h-14 rounded-full bg-white" />
        </button>
      </div>
    </div>
  );
}
