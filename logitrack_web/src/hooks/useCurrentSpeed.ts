import { useCallback, useEffect, useRef, useState } from "react";

export interface CurrentSpeedResult {
  /** Velocidad actual en km/h. 0 cuando hay fix pero el dispositivo no reporta velocidad. */
  speedKmh: number;
  /**
   * true cuando tenemos un fix de ubicación válido (permiso concedido + GPS
   * respondiendo). false = GPS apagado, permisos denegados o sin fix todavía.
   * El gate de entrega bloquea cuando esto es false (cierre del loophole BUG-43).
   */
  locationReady: boolean;
  /** true si el último error de geolocalización fue por permiso denegado (code 1). */
  permissionDenied: boolean;
  /** Re-dispara la petición de permiso/lectura de ubicación (reutiliza el flujo BUG-46). */
  requestLocation: () => void;
}

/**
 * useCurrentSpeed — lee la velocidad real del dispositivo vía la API de
 * Geolocalización (`GeolocationCoordinates.speed`, m/s) y la expone en km/h.
 *
 * SIN fallback permisivo (BUG-43): si no hay fix de ubicación (GPS apagado o
 * permiso denegado) `locationReady` queda en false y el consumidor DEBE
 * bloquear la acción. Un fix válido con `speed === null` (vehículo detenido o
 * hardware que no reporta velocidad) se interpreta como 0 km/h — eso permite
 * entregar estando legítimamente parado.
 */
export function useCurrentSpeed(): CurrentSpeedResult {
  const [speedKmh, setSpeedKmh] = useState(0);
  const [locationReady, setLocationReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const warnedRef = useRef(false);

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    setLocationReady(true);
    setPermissionDenied(false);
    const raw = pos.coords.speed; // m/s o null
    if (raw === null || Number.isNaN(raw)) {
      // Fix válido pero sin velocidad: vehículo detenido → 0 km/h.
      setSpeedKmh(0);
      return;
    }
    setSpeedKmh(Math.max(0, raw) * 3.6); // m/s → km/h, clamp negativos
  }, []);

  const applyError = useCallback((err: GeolocationPositionError) => {
    setLocationReady(false);
    setPermissionDenied(err.code === err.PERMISSION_DENIED);
    if (!warnedRef.current) {
      console.warn(`[useCurrentSpeed] Sin fix de ubicación (${err.message}). Entrega bloqueada hasta obtener GPS.`);
      warnedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("[useCurrentSpeed] Geolocalización no soportada por el dispositivo.");
      setLocationReady(false);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(applyPosition, applyError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [applyPosition, applyError]);

  // Re-petición explícita (botón "Activar ubicación"). Vuelve a disparar el
  // prompt del navegador si el permiso aún no fue decidido.
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    warnedRef.current = false;
    navigator.geolocation.getCurrentPosition(applyPosition, applyError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }, [applyPosition, applyError]);

  return { speedKmh, locationReady, permissionDenied, requestLocation };
}
