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
  /** Milisegundos continuos que el vehículo lleva detenido (pausa manual o
   *  auto-pausa por proximidad a un punto de entrega).
   *  Se resetea a 0 en cuanto el vehículo reanuda el movimiento. */
  stoppedTimeMs: number;
  pause: () => void;
  play: () => void;
  reset: () => void;
}

// ── Utilidades geográficas ────────────────────────────────────────────────────

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

/**
 * Parámetro t ∈ [0,1] del punto sobre el segmento [A→B] más cercano a P.
 * Usa aproximación flat-earth: válida para distancias < ~50 km.
 */
function closestTOnSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1,
    ((p.lat - a.lat) * dx + (p.lng - a.lng) * dy) / lenSq,
  ));
}

// ── Config URL ────────────────────────────────────────────────────────────────

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

// ── Constantes del simulador ──────────────────────────────────────────────────

/** Intervalo de actualización de posición (ms). */
const TICK_MS = 500;

/**
 * Período de gracia tras play(): durante este lapso NO se evalúa proximidad.
 * Evita que el vehículo se re-pause en el mismo punto justo después de que
 * el chofer registró la entrega (antes de que load() actualice la lista).
 */
const PROXIMITY_REFRACTORY_MS = 3000;

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook de geolocalización con simulación determinística de ruta.
 *
 * @param routePoints    Polilínea completa origen → waypoints.
 * @param overrideMode   Fuerza un modo ("real" | "fixed" | "simulate").
 * @param overrideSpeed  Velocidad base en km/h para el modo simulate.
 * @param deliveryPoints Puntos de entrega pendientes en orden de secuencia.
 *                       El simulador se detiene automáticamente cuando el
 *                       vehículo está a ≤ proximityM metros del primero.
 * @param proximityM     Radio de auto-pausa en metros.
 *                       50 m por defecto: cubre el "efecto túnel" a velocidades
 *                       de demo altas (360 km/h → 50 m/tick).
 */
export function useGeolocation(
  routePoints: GeoPoint[],
  overrideMode?: GeoMode,
  overrideSpeed?: number,
  deliveryPoints: GeoPoint[] = [],
  proximityM = 50,
): UseGeolocationResult {
  const urlConfig = useMemo(() => parseUrlConfig(), []);

  const mode: GeoMode  = overrideMode ?? urlConfig.mode;
  const speed: number  = overrideSpeed ?? urlConfig.speed;
  const fixed: GeoPoint | undefined = urlConfig.fixed;

  const [position, setPosition] = useState<GeoPoint | null>(() => {
    if (mode === "fixed")    return fixed ?? null;
    if (mode === "simulate" && routePoints.length > 0) return routePoints[0];
    return null;
  });
  const [isPaused,      setIsPaused]      = useState(false);
  const [stoppedTimeMs, setStoppedTimeMs] = useState(0);

  // ── Refs internos — se leen directamente dentro del setInterval ────────────
  const isPausedRef       = useRef(false);
  const simRef            = useRef<{ segIdx: number; segProgress: number }>({ segIdx: 0, segProgress: 0 });
  const routePointsRef    = useRef(routePoints);
  const simPathRef        = useRef<GeoPoint[]>([]);
  const speedRef          = useRef(speed);
  const deliveryPointsRef = useRef<GeoPoint[]>(deliveryPoints);
  const proximityMRef     = useRef(proximityM);
  const playTimestampRef  = useRef<number>(0);  // epoch ms de la última llamada a play()
  const stoppedSinceRef   = useRef<number | null>(null); // epoch ms del inicio de la parada

  // Sincronizar refs con las props (sin recrear el setInterval)
  useEffect(() => { routePointsRef.current    = routePoints;    }, [routePoints]);
  useEffect(() => { speedRef.current          = speed;          }, [speed]);
  useEffect(() => { deliveryPointsRef.current = deliveryPoints; }, [deliveryPoints]);
  useEffect(() => { proximityMRef.current     = proximityM;     }, [proximityM]);

  // ── API pública ────────────────────────────────────────────────────────────

  const pause = useCallback(() => {
    setIsPaused(true);
    isPausedRef.current = true;
    // stoppedSinceRef se registra en el primer tick pausado
  }, []);

  const play = useCallback(() => {
    playTimestampRef.current = Date.now(); // inicia el período de gracia
    stoppedSinceRef.current  = null;
    setStoppedTimeMs(0);
    setIsPaused(false);
    isPausedRef.current = false;
  }, []);

  const reset = useCallback(() => {
    simRef.current           = { segIdx: 0, segProgress: 0 };
    stoppedSinceRef.current  = null;
    playTimestampRef.current = 0;
    setStoppedTimeMs(0);
    const path = simPathRef.current.length >= 2 ? simPathRef.current : routePointsRef.current;
    if (path.length > 0) setPosition(path[0]);
  }, []);

  // ── GPS real ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "real") return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mode]);

  // ── Fetch geometría OSRM ──────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "simulate" || routePoints.length < 2) return;
    simPathRef.current = [];

    const coords = routePointsRef.current.map((p) => `${p.lng},${p.lat}`).join(";");
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.code === "Ok" && data.routes?.[0]) {
          simPathRef.current = data.routes[0].geometry.coordinates.map(
            (c: number[]) => ({ lat: c[1], lng: c[0] }),
          );
        } else {
          simPathRef.current = routePointsRef.current;
        }
      })
      .catch(() => { simPathRef.current = routePointsRef.current; });
  }, [mode, routePoints.length]);

  // ── Intervalo de movimiento ───────────────────────────────────────────────
  //
  // Diseño anti-efecto-túnel: la detección de proximidad se evalúa en TRES
  // momentos por tick, no solo al final:
  //   1. Al inicio del tick (posición actual antes de mover).
  //   2. Dentro del bucle de segmentos: distancia mínima perpendicular al
  //      segmento completo [posNow → to], usando proyección flat-earth.
  //   3. Al final del tick como red de seguridad (cobertura de bordes).
  //
  // Esto garantiza que aunque el vehículo avance 50 m por tick (360 km/h),
  // nunca "salte" por encima de un punto de entrega dentro del radio de 50 m.
  useEffect(() => {
    if (mode !== "simulate" || routePoints.length < 2) return;

    simRef.current           = { segIdx: 0, segProgress: 0 };
    stoppedSinceRef.current  = null;
    playTimestampRef.current = 0;
    setStoppedTimeMs(0);
    setPosition(routePointsRef.current[0]);

    const id = setInterval(() => {

      // ── 1. Pausa activa: acumular stoppedTimeMs y no mover ─────────────────
      if (isPausedRef.current) {
        const now = Date.now();
        if (stoppedSinceRef.current === null) stoppedSinceRef.current = now;
        setStoppedTimeMs(now - stoppedSinceRef.current);
        return;
      }

      // Al reanudar, limpiar el contador de parada
      if (stoppedSinceRef.current !== null) {
        stoppedSinceRef.current = null;
        setStoppedTimeMs(0);
      }

      const cur = simPathRef.current.length >= 2 ? simPathRef.current : routePointsRef.current;
      if (cur.length < 2) return;

      let { segIdx, segProgress } = simRef.current;
      if (segIdx >= cur.length - 1) return;

      // Precalcular condiciones de proximidad (evitar re-evaluación en cada iteración)
      const pts        = deliveryPointsRef.current;
      const sincePlay  = Date.now() - playTimestampRef.current;
      const threshold  = proximityMRef.current;
      const canCheck   = pts.length > 0 && sincePlay >= PROXIMITY_REFRACTORY_MS;

      // Snapping: ancla visualmente el vehículo al punto de entrega y pausa.
      // simRef queda en la posición de polilínea más cercana al punto de entrega,
      // de modo que al reanudar el movimiento la trayectoria sea coherente.
      const snapAndPause = (newSeg: { segIdx: number; segProgress: number }) => {
        simRef.current          = newSeg;
        setPosition(pts[0]);
        stoppedSinceRef.current = Date.now();
        isPausedRef.current     = true;
        setIsPaused(true);
      };

      // ── 2. CHECK 1: posición actual (antes de mover) ──────────────────────
      if (canCheck) {
        const curPos = lerp(cur[segIdx], cur[segIdx + 1], segProgress);
        if (haversineKm(curPos, pts[0]) * 1000 <= threshold) {
          snapAndPause({ segIdx, segProgress });
          return;
        }
      }

      // ── 3. Avance a velocidad constante con detección por segmento ─────────
      let remaining = speedRef.current * (TICK_MS / 1000 / 3600);

      while (remaining > 0 && segIdx < cur.length - 1) {
        const from   = cur[segIdx];
        const to     = cur[segIdx + 1];
        const segKm  = haversineKm(from, to);
        const segLeft = segKm > 0 ? segKm * (1 - segProgress) : 0;

        // CHECK 2 (anti-túnel): distancia mínima desde el punto de entrega
        // a la PORCIÓN RESTANTE del segmento [posNow → to].
        // Detecta el caso en que la polilínea pasa cerca del punto pero el
        // vehículo lo "saltaría" en el próximo avance.
        if (canCheck) {
          const posNow     = lerp(from, to, segProgress);
          const tClosest   = closestTOnSegment(pts[0], posNow, to);
          const closestPt  = lerp(posNow, to, tClosest);
          const minDistM   = haversineKm(pts[0], closestPt) * 1000;

          if (minDistM <= threshold) {
            // El punto de entrega está dentro del radio de esta porción de segmento.
            const distToClosestKm = haversineKm(posNow, closestPt);

            if (distToClosestKm <= remaining) {
              // Presupuesto suficiente para llegar al punto más cercano en este tick.
              // Calcular el nuevo segProgress correspondiente al punto más cercano.
              const newProgress = segProgress + tClosest * (1 - segProgress);
              snapAndPause({ segIdx, segProgress: Math.min(newProgress, 1) });
              return;
            }
            // Presupuesto insuficiente: avanzar lo que se pueda; en el siguiente
            // tick la distancia será aún menor y se capturará (CHECK 1 lo atrapará).
          }
        }

        if (remaining >= segLeft) {
          remaining   -= segLeft;
          segIdx++;
          segProgress  = 0;
        } else {
          segProgress += segKm > 0 ? remaining / segKm : 1;
          remaining    = 0;
        }
      }

      simRef.current = { segIdx, segProgress };

      const newPos: GeoPoint =
        segIdx >= cur.length - 1
          ? cur[cur.length - 1]
          : lerp(cur[segIdx], cur[segIdx + 1], segProgress);

      // ── 4. CHECK 3: posición final (red de seguridad) ─────────────────────
      if (canCheck && haversineKm(newPos, pts[0]) * 1000 <= threshold) {
        snapAndPause({ segIdx, segProgress });
        return;
      }

      setPosition(newPos);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [mode, routePoints.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { position, mode, isPaused, stoppedTimeMs, pause, play, reset };
}
