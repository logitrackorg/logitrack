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

  const isPausedRef = useRef(false);
  const simRef = useRef<{ segIdx: number; segProgress: number }>({ segIdx: 0, segProgress: 0 });
  const routePointsRef = useRef(routePoints);
  const simPathRef = useRef<GeoPoint[]>([]);
  const speedRef = useRef(speed);

  useEffect(() => { routePointsRef.current = routePoints; }, [routePoints]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const pause = useCallback(() => { setIsPaused(true); isPausedRef.current = true; }, []);
  const play  = useCallback(() => { setIsPaused(false); isPausedRef.current = false; }, []);
  const reset = useCallback(() => {
    simRef.current = { segIdx: 0, segProgress: 0 };
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

    const coords = routePoints.map((p) => `${p.lng},${p.lat}`).join(";");
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
          simPathRef.current = routePoints;
        }
      })
      .catch(() => { simPathRef.current = routePoints; });
  }, [mode, routePoints.length]);

  // Intervalo de movimiento sobre la polilínea de calles
  useEffect(() => {
    if (mode !== "simulate" || routePoints.length < 2) return;

    simRef.current = { segIdx: 0, segProgress: 0 };
    setPosition(routePoints[0]);

    const id = setInterval(() => {
      if (isPausedRef.current) return;
      const cur = simPathRef.current.length >= 2 ? simPathRef.current : routePointsRef.current;
      if (cur.length < 2) return;

      let { segIdx, segProgress } = simRef.current;
      if (segIdx >= cur.length - 1) return;

      // Distancia a recorrer en este tick
      let remaining = speedRef.current * (TICK_MS / 1000 / 3600);

      // Avanzar por tantos segmentos como corresponda
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
  }, [mode, routePoints.length]);

  return { position, mode, isPaused, pause, play, reset };
}
