import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type GeoMode = "real" | "fixed" | "simulate";

export interface UseGeolocationResult {
  position: GeoPoint | null;
  mode: GeoMode;
  isPaused: boolean;
  /** Milisegundos continuos que el vehículo lleva detenido (velocidad = 0).
   *  Se resetea a 0 en cuanto el vehículo vuelve a moverse.
   *  Solo relevante en modo "simulate". */
  stoppedTimeMs: number;
  pause: () => void;
  play: () => void;
  reset: () => void;
}

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function lerp(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function parseUrlConfig(): { mode: GeoMode; fixed?: GeoPoint; speed: number } {
  const params = new URLSearchParams(window.location.search);
  const gps = params.get("gps");
  const speed = Math.max(1, parseFloat(params.get("speed") ?? "120"));
  if (!gps) return { mode: "real", speed };
  if (gps === "simulate") return { mode: "simulate", speed };
  const parts = gps.split(",").map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]))
    return { mode: "fixed", fixed: { lat: parts[0], lng: parts[1] }, speed };
  return { mode: "real", speed };
}

const TICK_MS = 500;

export function useGeolocation(
  routePoints: GeoPoint[],
  overrideMode?: GeoMode,
  overrideSpeed?: number
): UseGeolocationResult {
  const urlConfig = useMemo(() => parseUrlConfig(), []);

  const mode: GeoMode = overrideMode ?? urlConfig.mode;
  const speed: number = overrideSpeed ?? urlConfig.speed;
  const fixed: GeoPoint | undefined = urlConfig.fixed;

  const [position, setPosition] = useState<GeoPoint | null>(() => {
    if (mode === "fixed") return fixed ?? null;
    if (mode === "simulate" && routePoints.length > 0) return routePoints[0];
    return null;
  });
  const [isPaused, setIsPaused] = useState(false);
  const [stoppedTimeMs, setStoppedTimeMs] = useState(0);

  const isPausedRef = useRef(false);
  const simRef = useRef<{ segIdx: number; segProgress: number }>({ segIdx: 0, segProgress: 0 });
  const routePointsRef = useRef(routePoints);
  const simPathRef = useRef<GeoPoint[]>([]);
  const speedRef = useRef(speed);

  // ── Refs para paradas simuladas ───────────────────────────────────────────
  // stopEndTimeRef: epoch ms en que termina la parada activa (null = en movimiento).
  const stopEndTimeRef = useRef<number | null>(null);
  // stoppedSinceRef: epoch ms en que comenzó la parada activa (null = en movimiento).
  const stoppedSinceRef = useRef<number | null>(null);

  useEffect(() => { routePointsRef.current = routePoints; }, [routePoints]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const pause = useCallback(() => { setIsPaused(true); isPausedRef.current = true; }, []);
  const play  = useCallback(() => { setIsPaused(false); isPausedRef.current = false; }, []);
  const reset = useCallback(() => {
    simRef.current = { segIdx: 0, segProgress: 0 };
    stopEndTimeRef.current = null;
    stoppedSinceRef.current = null;
    setStoppedTimeMs(0);
    const path = simPathRef.current.length >= 2 ? simPathRef.current : routePointsRef.current;
    if (path.length > 0) setPosition(path[0]);
  }, []);

  // GPS real
  useEffect(() => {
    if (mode !== "real") return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mode]);

  // Fetch geometría de calles (OSRM) al activar la simulación
  useEffect(() => {
    if (mode !== "simulate" || routePoints.length < 2) return;
    simPathRef.current = [];

    const coords = routePointsRef.current.map((p) => `${p.lng},${p.lat}`).join(";");
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.code === "Ok" && data.routes?.[0]) {
          simPathRef.current = data.routes[0].geometry.coordinates.map(
            (c: number[]) => ({ lat: c[1], lng: c[0] })
          );
        } else {
          simPathRef.current = routePointsRef.current;
        }
      })
      .catch(() => { simPathRef.current = routePointsRef.current; });
  }, [mode, routePoints.length]);

  // Intervalo de movimiento sobre la polilínea de calles.
  // Incluye velocidad dinámica y paradas aleatorias realistas:
  //   · Cortas  (10–60 s)  — semáforos, cruces          55 % de las paradas
  //   · Medias  (1–5 min)  — tráfico denso, peajes      30 % de las paradas
  //   · Largas  (6–15 min) — descanso, repostaje        15 % de las paradas
  // Las paradas largas superan intencionalmente los 6 min para activar el gate.
  useEffect(() => {
    if (mode !== "simulate" || routePoints.length < 2) return;

    simRef.current = { segIdx: 0, segProgress: 0 };
    stopEndTimeRef.current = null;
    stoppedSinceRef.current = null;
    setStoppedTimeMs(0);
    setPosition(routePointsRef.current[0]);

    // Probabilidad de iniciar una parada nueva en cada tick (~0.6 % → ~1 parada/83 s).
    const STOP_PROB = 0.006;

    const id = setInterval(() => {
      if (isPausedRef.current) return;

      const now = Date.now();

      // ── Gestión de parada activa ─────────────────────────────────────────
      if (stopEndTimeRef.current !== null) {
        // Primera vez que entramos en esta parada → registrar inicio.
        if (stoppedSinceRef.current === null) stoppedSinceRef.current = now;
        setStoppedTimeMs(now - stoppedSinceRef.current);

        if (now < stopEndTimeRef.current) return; // todavía detenido

        // Parada terminó → retomar movimiento.
        stopEndTimeRef.current = null;
        stoppedSinceRef.current = null;
        setStoppedTimeMs(0);
      }

      const cur = simPathRef.current.length >= 2 ? simPathRef.current : routePointsRef.current;
      if (cur.length < 2) return;

      let { segIdx, segProgress } = simRef.current;
      if (segIdx >= cur.length - 1) return;

      // ── Disparador de nueva parada aleatoria ─────────────────────────────
      if (Math.random() < STOP_PROB) {
        const r = Math.random();
        let durationMs: number;
        if (r < 0.55) {
          // Corta: semáforo / cruce (10–60 s)
          durationMs = (10 + Math.random() * 50) * 1000;
        } else if (r < 0.85) {
          // Media: tráfico / peaje (1–5 min)
          durationMs = (60 + Math.random() * 240) * 1000;
        } else {
          // Larga: descanso / repostaje (6–15 min) → activa gate de fatiga
          durationMs = (360 + Math.random() * 540) * 1000;
        }
        stopEndTimeRef.current = now + durationMs;
        stoppedSinceRef.current = now;
        setStoppedTimeMs(0);
        return;
      }

      // ── Movimiento con velocidad dinámica (±20 % de la base) ─────────────
      const dynamicFactor = 0.8 + Math.random() * 0.4; // 0.80–1.20
      let remaining = speedRef.current * dynamicFactor * (TICK_MS / 1000 / 3600);

      while (remaining > 0 && segIdx < cur.length - 1) {
        const from = cur[segIdx];
        const to   = cur[segIdx + 1];
        const segKm = haversineKm(from, to);
        const segLeft = segKm > 0 ? segKm * (1 - segProgress) : 0;

        if (remaining >= segLeft) {
          remaining -= segLeft;
          segIdx++;
          segProgress = 0;
        } else {
          segProgress += segKm > 0 ? remaining / segKm : 1;
          remaining = 0;
        }
      }

      simRef.current = { segIdx, segProgress };

      if (segIdx >= cur.length - 1) {
        setPosition(cur[cur.length - 1]);
      } else {
        setPosition(lerp(cur[segIdx], cur[segIdx + 1], segProgress));
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [mode, routePoints.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { position, mode, isPaused, stoppedTimeMs, pause, play, reset };
}
