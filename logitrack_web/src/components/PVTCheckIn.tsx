/**
 * PVTCheckIn — Psychomotor Vigilance Task (US6)
 *
 * Flujo:
 *   instrucciones → jugando (15 s) → resultados → envía al backend → onDone()
 *
 * Precisión de milisegundos:
 *   - Los timestamps se capturan con Date.now() directamente en callbacks,
 *     sin pasar por el ciclo de re-render de React.
 *   - El estado del juego (latencias, aciertos, errores) se guarda en refs
 *     para evitar cierres obsoletos en setTimeout/setInterval.
 *   - Solo los valores de display (hitCount, errorCount, timeLeft) usan useState.
 */
import { useEffect, useRef, useState } from "react";
import { SkipForward, Target, Trophy, Zap } from "lucide-react";
import { driverApi, type PVTPayload } from "../api/driver";
import { Button } from "@/components/ui/button";

// ── constantes ────────────────────────────────────────────────────────────────

const GAME_DURATION_S = 15;
const CIRCLE_RADIUS = 28;      // px
const CIRCLE_SIZE = CIRCLE_RADIUS * 2;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 3000;

// ── helpers ───────────────────────────────────────────────────────────────────

function latencyInterpretation(avg: number): { text: string; colorClass: string } {
  if (avg === 0)    return { text: "Sin datos — no hubo aciertos",                  colorClass: "text-slate-400" };
  if (avg <= 800)   return { text: "Aceptable — dentro del rango esperado",         colorClass: "text-emerald-400" };
  if (avg <= 1100)  return { text: "Media — considerá descansar",                   colorClass: "text-amber-400" };
  return              { text: "Lento — se recomienda descansar antes de conducir",  colorClass: "text-rose-400" };
}

// ── interfaces ────────────────────────────────────────────────────────────────

interface Props {
  onDone: () => void;
}

interface GameResults {
  avgLatency: number; // ms, redondeado
  hits: number;
  errors: number;
}

// ── componente ────────────────────────────────────────────────────────────────

export function PVTCheckIn({ onDone }: Props) {
  // Fase del componente
  const [phase, setPhase] = useState<"instructions" | "playing" | "results">("instructions");

  // Estado de display (solo para la UI — los valores reales están en refs)
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_S);
  const [circleVisible, setCircleVisible] = useState(false);
  const [circlePos, setCirclePos] = useState({ x: 0, y: 0 });
  const [hitCount, setHitCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [results, setResults] = useState<GameResults | null>(null);
  const [sending, setSending] = useState(false);

  // Refs para lógica de timing — no causan re-renders
  const isPlayingRef = useRef(false);
  const timeLeftRef = useRef(GAME_DURATION_S);
  const stimulusTimeRef = useRef<number | null>(null); // Date.now() cuando apareció el círculo
  const latenciesRef = useRef<number[]>([]);
  const hitsRef = useRef(0);
  const errorsRef = useRef(0);
  // game_errors: contador más amplio que `errorsRef` — suma los toques
  // erróneos (clic sin estímulo / fuera de él) MÁS los estímulos perdidos
  // (el círculo seguía visible cuando terminó el tiempo). Se envía al backend
  // junto al resto de las métricas del minijuego.
  const gameErrorsRef = useRef(0);

  // Handles de timers
  const gameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stimulusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref del contenedor del juego (para medir dimensiones)
  const boxRef = useRef<HTMLDivElement>(null);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      if (gameTimerRef.current) clearInterval(gameTimerRef.current);
      if (stimulusTimerRef.current) clearTimeout(stimulusTimerRef.current);
    };
  }, []);

  // ── lógica del juego ──────────────────────────────────────────────────────

  const scheduleNextStimulus = () => {
    if (stimulusTimerRef.current) clearTimeout(stimulusTimerRef.current);
    if (!isPlayingRef.current) return;

    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    stimulusTimerRef.current = setTimeout(() => {
      if (!isPlayingRef.current) return;
      const box = boxRef.current;
      if (!box) return;

      const { width, height } = box.getBoundingClientRect();
      // Posición aleatoria garantizando que el círculo quede dentro de la caja
      const x = CIRCLE_RADIUS + Math.random() * (width  - CIRCLE_SIZE);
      const y = CIRCLE_RADIUS + Math.random() * (height - CIRCLE_SIZE);

      stimulusTimeRef.current = Date.now(); // timestamp exacto de aparición
      setCirclePos({ x, y });
      setCircleVisible(true);
    }, delay);
  };

  const endGame = () => {
    isPlayingRef.current = false;
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    if (stimulusTimerRef.current) clearTimeout(stimulusTimerRef.current);

    // Estímulo perdido: el círculo seguía visible y sin responder cuando se
    // acabó el tiempo — cuenta como error amplio (game_errors), no como toque
    // erróneo (errorsRef), que es exclusivamente para clics sin estímulo.
    if (circleVisible && stimulusTimeRef.current !== null) {
      gameErrorsRef.current++;
    }

    stimulusTimeRef.current = null;
    setCircleVisible(false);

    const lats = latenciesRef.current;
    const avg = lats.length > 0
      ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length)
      : 0;

    setResults({ avgLatency: avg, hits: hitsRef.current, errors: errorsRef.current });
    setPhase("results");
  };

  const startGame = () => {
    // Reiniciar métricas
    latenciesRef.current = [];
    hitsRef.current = 0;
    errorsRef.current = 0;
    gameErrorsRef.current = 0;
    timeLeftRef.current = GAME_DURATION_S;
    stimulusTimeRef.current = null;

    setHitCount(0);
    setErrorCount(0);
    setCircleVisible(false);
    setTimeLeft(GAME_DURATION_S);
    isPlayingRef.current = true;
    setPhase("playing");

    // Temporizador global de 15 s
    gameTimerRef.current = setInterval(() => {
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 0) endGame();
    }, 1000);

    scheduleNextStimulus();
  };

  // ── handlers de interacción ───────────────────────────────────────────────

  /** Toque en la caja:
   *  - Círculo NO visible → falso positivo (error).
   *  - Círculo SÍ visible pero fuera de él → toque erróneo (error). */
  const handleBoxPointerDown = () => {
    if (!isPlayingRef.current) return;
    errorsRef.current++;
    gameErrorsRef.current++;
    setErrorCount(errorsRef.current);
  };

  /** Toque directo sobre el círculo → acierto con latencia exacta. */
  const handleCirclePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // evita disparar handleBoxPointerDown
    if (!isPlayingRef.current || !circleVisible || stimulusTimeRef.current === null) return;

    const latency = Date.now() - stimulusTimeRef.current; // ms exactos
    latenciesRef.current.push(latency);
    hitsRef.current++;
    stimulusTimeRef.current = null;
    setCircleVisible(false);
    setHitCount(hitsRef.current);
    scheduleNextStimulus();
  };

  // ── envío al backend ──────────────────────────────────────────────────────

  const handleSendResults = async () => {
    if (!results) return;
    setSending(true);
    const payload: PVTPayload = {
      latencia_promedio_ms: results.avgLatency,
      aciertos: results.hits,
      errores: results.errors,
      game_errors: gameErrorsRef.current,
    };
    try {
      await driverApi.submitPVT(payload);
    } catch {
      // Non-blocking: el resultado ya fue mostrado al chofer.
      // Si el envío falla, el chofer igual puede continuar.
    } finally {
      setSending(false);
      onDone();
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[3000] bg-[#0f2744]/95 backdrop-blur-sm flex flex-col">

      {/* ── Pantalla de instrucciones ──────────────────────────────────── */}
      {phase === "instructions" && (
        <>
          <div className="flex justify-end px-4 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onDone}
              className="gap-1.5 font-semibold text-xs"
            >
              <SkipForward className="w-3.5 h-3.5" />
              Saltar prueba
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-8">
            <div className="max-w-md mx-auto pt-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-yellow-500/20 text-yellow-300 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white leading-tight">Prueba de Reacción</h1>
                  <p className="text-xs text-slate-400">Test psicomotriz opcional · 15 segundos</p>
                </div>
              </div>

              <div className="mb-6 px-4 py-4 rounded-xl bg-slate-800 border border-slate-600 space-y-3">
                <p className="text-sm font-semibold text-white">¿Cómo funciona?</p>
                <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300 leading-relaxed">
                  <li>Aparecerá un <span className="text-emerald-400 font-semibold">círculo verde</span> en una posición aleatoria.</li>
                  <li>Tocá el círculo lo más rápido que puedas.</li>
                  <li>Si tocás la pantalla sin que haya círculo, se registra como error.</li>
                  <li>La prueba dura <strong className="text-white">15 segundos</strong> en total.</li>
                </ol>
                <p className="text-[11px] text-slate-500 pt-1">
                  El sistema mide tu velocidad de respuesta en milisegundos.
                  Esta información ayuda a evaluar tu estado de alerta.
                </p>
              </div>

              <Button
                onClick={startGame}
                className="w-full h-12 rounded-xl font-bold text-base gap-2 mb-3"
              >
                <Zap className="w-4 h-4" />
                Iniciar prueba
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── Pantalla de juego ─────────────────────────────────────────── */}
      {phase === "playing" && (
        <div className="flex-1 overflow-hidden px-4 py-4 flex flex-col">
          <div className="max-w-md mx-auto w-full flex flex-col flex-1">

            {/* Barra de tiempo */}
            <div className="mb-3 shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-400">Tiempo restante</span>
                <span className="text-sm font-bold text-white tabular-nums">{timeLeft}s</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-1000"
                  style={{
                    width: `${(timeLeft / GAME_DURATION_S) * 100}%`,
                    background: timeLeft > 10 ? "var(--warn)" : "var(--danger-c)",
                  }}
                />
              </div>
            </div>

            {/* Marcador */}
            <div className="flex gap-3 mb-4 shrink-0">
              <div className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Aciertos</p>
                <p className="text-2xl font-black text-emerald-400 tabular-nums leading-tight">{hitCount}</p>
              </div>
              <div className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Errores</p>
                <p className="text-2xl font-black text-rose-400 tabular-nums leading-tight">{errorCount}</p>
              </div>
            </div>

            {/* Zona de juego */}
            <div
              ref={boxRef}
              onPointerDown={handleBoxPointerDown}
              className="relative flex-1 rounded-xl border-2 border-yellow-500/40 bg-slate-900 overflow-hidden select-none"
              style={{ minHeight: 220, touchAction: "none" }}
            >
              {/* Indicador de fondo cuando no hay estímulo */}
              {!circleVisible && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="flex flex-col items-center gap-2 text-slate-700">
                    <Target className="w-10 h-10" />
                    <span className="text-xs font-medium">Esperá el círculo…</span>
                  </div>
                </div>
              )}

              {/* Estímulo — el círculo */}
              {circleVisible && (
                <div
                  onPointerDown={handleCirclePointerDown}
                  className="absolute rounded-full cursor-pointer"
                  style={{
                    width: CIRCLE_SIZE,
                    height: CIRCLE_SIZE,
                    left: circlePos.x - CIRCLE_RADIUS,
                    top: circlePos.y - CIRCLE_RADIUS,
                    background: "var(--ok)",             // emerald-400
                    boxShadow: "0 0 24px rgba(52,211,153,0.55)",
                    touchAction: "none",
                  }}
                />
              )}
            </div>

            <p className="mt-2 text-[11px] text-slate-500 text-center shrink-0">
              Tocá el círculo verde al aparecer · No toques si no hay círculo
            </p>
          </div>
        </div>
      )}

      {/* ── Pantalla de resultados ────────────────────────────────────── */}
      {phase === "results" && results && (
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          <div className="max-w-md mx-auto pt-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/20 text-yellow-300 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-tight">Resultado</h1>
                <p className="text-xs text-slate-400">Prueba de 15 s finalizada</p>
              </div>
            </div>

            {/* Latencia promedio */}
            <div className="mb-4 px-4 py-4 rounded-xl bg-slate-800 border border-slate-600">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Latencia promedio de respuesta
              </p>
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-4xl font-black tabular-nums ${latencyInterpretation(results.avgLatency).colorClass}`}>
                  {results.hits > 0 ? results.avgLatency : "—"}
                </span>
                {results.hits > 0 && (
                  <span className="text-sm text-slate-400">ms</span>
                )}
              </div>
              <p className={`text-sm font-semibold ${latencyInterpretation(results.avgLatency).colorClass}`}>
                {latencyInterpretation(results.avgLatency).text}
              </p>
            </div>

            {/* Aciertos y errores */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Aciertos</p>
                <p className="text-3xl font-black text-emerald-400 tabular-nums">{results.hits}</p>
              </div>
              <div className="px-4 py-3 rounded-xl bg-slate-800 border border-slate-600 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Toques erróneos</p>
                <p className="text-3xl font-black text-rose-400 tabular-nums">{results.errors}</p>
              </div>
            </div>

            <Button
              onClick={handleSendResults}
              disabled={sending}
              className="w-full h-12 rounded-xl font-bold text-base gap-2"
            >
              {sending ? "Guardando…" : "Guardar y continuar →"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
