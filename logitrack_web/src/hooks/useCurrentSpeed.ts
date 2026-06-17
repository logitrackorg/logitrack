import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

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
  /** true mientras se está esperando respuesta del sistema de permisos/GPS. */
  requesting: boolean;
  /** Mensaje de error legible del último intento de activación. null = sin error. */
  locationErrorMsg: string | null;
  /** Re-dispara la petición de permiso/lectura de ubicación (reutiliza el flujo BUG-46). */
  requestLocation: () => void;
}

/**
 * useCurrentSpeed — lee la velocidad real del dispositivo vía la API de
 * Geolocalización (`GeolocationCoordinates.speed`, m/s) y la expone en km/h.
 *
 * En plataforma nativa (Capacitor APK) usa @capacitor/geolocation para poder
 * solicitar permisos y abrir ajustes del sistema cuando están denegados.
 * En web usa navigator.geolocation directamente.
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
  const [requesting, setRequesting] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  const warnedRef = useRef(false);
  const isNative = Capacitor.isNativePlatform();

  const applyPosition = useCallback((pos: GeolocationPosition) => {
    setLocationReady(true);
    setPermissionDenied(false);
    setRequesting(false);
    setLocationErrorMsg(null);
    const raw = pos.coords.speed; // m/s o null
    if (raw === null || Number.isNaN(raw)) {
      setSpeedKmh(0);
      return;
    }
    setSpeedKmh(Math.max(0, raw) * 3.6);
  }, []);

  const applyError = useCallback((err: GeolocationPositionError) => {
    setLocationReady(false);
    setRequesting(false);
    setPermissionDenied(err.code === err.PERMISSION_DENIED);
    const msg =
      err.code === err.PERMISSION_DENIED
        ? "Permiso de ubicación denegado. Tocá \"Ir a Ajustes\" para habilitarlo."
        : err.code === err.POSITION_UNAVAILABLE
          ? "GPS desactivado. Activá la ubicación en los ajustes del dispositivo."
          : "No se pudo obtener la ubicación. Verificá que el GPS esté activo.";
    setLocationErrorMsg(msg);
    if (!warnedRef.current) {
      console.warn(`[useCurrentSpeed] Sin fix de ubicación (${err.message}). Entrega bloqueada hasta obtener GPS.`);
      warnedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationReady(false);
      setLocationErrorMsg("Este dispositivo no soporta GPS.");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(applyPosition, applyError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [applyPosition, applyError]);

  // En nativo: solicita permiso vía plugin Capacitor. Si ya fue denegado,
  // abre directamente los ajustes de la app para que el chofer lo habilite.
  // En web: dispara el prompt del navegador con getCurrentPosition.
  const requestLocation = useCallback(async () => {
    warnedRef.current = false;
    setRequesting(true);
    setLocationErrorMsg(null);

    if (isNative) {
      try {
        const status = await Geolocation.checkPermissions();
        if (status.location === "denied") {
          // Permiso permanentemente denegado → abrir ajustes de la app vía intent Android.
          window.open(
            "intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:com.logitrack.driver;end",
            "_system",
          );
          setRequesting(false);
          return;
        }
        if (status.location !== "granted") {
          // Permiso no decidido aún → solicitar al sistema.
          const result = await Geolocation.requestPermissions({ permissions: ["location"] });
          if (result.location !== "granted") {
            setRequesting(false);
            setPermissionDenied(true);
            setLocationErrorMsg("Permiso denegado. Tocá \"Ir a Ajustes\" para habilitarlo.");
            return;
          }
        }
        // Permiso concedido: disparar lectura para actualizar locationReady.
        navigator.geolocation.getCurrentPosition(applyPosition, applyError, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      } catch {
        setRequesting(false);
        setLocationErrorMsg("No se pudo solicitar el permiso de ubicación.");
      }
      return;
    }

    // Web: prompt estándar del navegador.
    if (!navigator.geolocation) {
      setRequesting(false);
      setLocationErrorMsg("Este dispositivo no soporta GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(applyPosition, applyError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }, [isNative, applyPosition, applyError]);

  return { speedKmh, locationReady, permissionDenied, requesting, locationErrorMsg, requestLocation };
}
