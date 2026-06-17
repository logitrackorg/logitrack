import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Film,
  MapPin,
  Package,
  RefreshCw,
  Truck,
  WifiOff,
  XCircle,
} from "lucide-react";
import { compare as bcryptCompare } from "bcryptjs";
import { useOffline } from "../offline/useOffline";
import { GEOFENCE_RADIUS_M, distanceMeters } from "../utils/geo";
import {
  cacheRoute,
  getCachedRoute,
  enqueueAction,
  getAllQueuedActions,
  getKeywordAttempts,
  incrementKeywordAttempts,
  prefetchRouteGeometry,
  clearDayCache,
} from "../offline/db";
import { syncQueue } from "../offline/sync";
import { driverApi, type DriverRouteResponse, type TouchEventPayload } from "../api/driver";
import { interBranchTripsApi } from "../api/interBranchTrips";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { shipmentApi, type Shipment } from "../api/shipments";
import { Card } from "../components/ui/card";
import { CameraCapture } from "../components/ui/CameraCapture";
import { MapView } from "../components/ui/MapView";
import { NextStopCard } from "../components/ui/NextStopCard";
import { ZoneAlert } from "../components/ui/ZoneAlert";
import { BottomSheet } from "../components/ui/bottom-sheet";
import { WhatsAppQuickButton } from "../components/ui/WhatsAppQuickButton";
import { useGeolocation } from "../hooks/useGeolocation";
import { useCurrentSpeed } from "../hooks/useCurrentSpeed";
import { zoneApi, type Zone } from "../api/zones";
import { isInDangerZone } from "../utils/pointInPolygon";
import {
  FAILED_REASONS,
  REJECTED_REASONS,
  TIME_WINDOW_HOURS,
  TIME_WINDOW_LABEL,
  recipientView,
  timeWindowTone,
} from "../utils/driverActions";
import { getPendingFatigueStep } from "../utils/fatigueWizardProgress";

type Tab = "pendientes" | "completados";

export function DriverRoute() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOnline = useOffline();
  // trackingIds de acciones encoladas localmente, pendientes de sincronizar.
  // Se siembra desde IndexedDB en cada montaje (sobrevive cierres de app).
  const [pendingSyncIds, setPendingSyncIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  // BUG-43: velocidad GPS real del chofer (sin fallback permisivo). El valor
  // efectivo y la fuente se computan más abajo, una vez conocido el estado del
  // simulador (ver simulationActive / effectiveSpeed).
  const { speedKmh: gpsSpeedKmh, locationReady, requesting: locationRequesting, locationErrorMsg, requestLocation } = useCurrentSpeed();

  const [data, setData] = useState<DriverRouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRoute, setNoRoute] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);

  // Bloqueo automático de pantalla por alerta de fatiga (LOGITRACK-499).
  const [fatigueBlocked, setFatigueBlocked] = useState(false);
  const [fatigueUnblockedBy, setFatigueUnblockedBy] = useState<string | null>(null);
  // Clave del evento de desbloqueo actualmente en pantalla (para persistir el ACK en sessionStorage).
  const pendingAckRef = useRef<string | null>(null);

  // Gate de re-test en ruta: true = mostrar KssCheckIn antes de actualizar la lista.
  const [midRouteCheckin, setMidRouteCheckin] = useState(false);
  // Misfires capturados en el momento en que se activa el overlay, para mostrarlo
  // en el toast de "Saltar test" dentro de KssCheckIn.
  const [checkinMisfires, setCheckinMisfires] = useState(0);
  // true si el driver aún no reportó sueño para el día logístico actual.
  const [requiresSleepData, setRequiresSleepData] = useState(true);

  // sheets
  const [deliverShipment, setDeliverShipment] = useState<Shipment | null>(null);
  const [failedShipment, setFailedShipment] = useState<Shipment | null>(null);
  const [rejectedShipment, setRejectedShipment] = useState<Shipment | null>(null);
  const [recipientDni, setRecipientDni] = useState("");
  const [deliveryKeyword, setDeliveryKeyword] = useState("");
  const [deliveryPhoto, setDeliveryPhoto] = useState<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [useContingency, setUseContingency] = useState(false);
  const [failedReason, setFailedReason] = useState<string>("");
  const [failedNotes, setFailedNotes] = useState("");
  const [rejectedReason, setRejectedReason] = useState<string>("");
  const [rejectedNotes, setRejectedNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [offlineKeywordAttempts, setOfflineKeywordAttempts] = useState(0);
  // Geofence warning: when set, shows a confirmation modal before proceeding.
  // Stores the distance (m) and a callback to execute if the driver confirms.
  const [geoWarning, setGeoWarning] = useState<{ distanceM: number; onConfirm: () => void } | null>(null);
  const [tab, setTab] = useState<Tab>("pendientes");
  // Badge minimizado de zona peligrosa — true cuando el cartel grande fue descartado.
  // Debe declararse ANTES de cualquier early return para cumplir las reglas de hooks.
  const [isDangerDismissed, setIsDangerDismissed] = useState(false);

  // US4 global: contador de misfires para toda la vista de ruta.
  // Cualquier click que no sea detenido por e.stopPropagation() en un botón
  // válido burbujea hasta document y suma +1. Se usa useRef para evitar
  // re-renders en cada tap y para leer el valor corriente en funciones async.
  const misfireRef = useRef(0);
  // Ref espejo de midRouteCheckin para el listener (evita closure stale).
  const midRouteCheckinRef = useRef(false);
  useEffect(() => { midRouteCheckinRef.current = midRouteCheckin; }, [midRouteCheckin]);
  // Listener global: monta/desmonta con el componente (cleanup en el return).
  useEffect(() => {
    const handleGlobalClick = () => {
      if (!midRouteCheckinRef.current) misfireRef.current++;
    };
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, []);

  const load = () =>
    driverApi
      .getRoute()
      .then((d) => {
        setData(d);
        setNoRoute(false);
        if (user) {
          cacheRoute(user.id, d).catch(() => {});
          if (d.waypoints && d.waypoints.length >= 2) {
            prefetchRouteGeometry(user.id, d.waypoints, d.origin ?? undefined).catch(() => {});
          }
        }
      })
      .catch(async (err) => {
        // 404 = no hay ruta asignada en el servidor → no usar cache (datos obsoletos).
        // Cualquier otro error (red caída, 5xx) → intentar cache offline.
        const status = err?.response?.status;
        if (status === 404) { setNoRoute(true); return; }
        if (user) {
          const cached = await getCachedRoute(user.id).catch(() => null);
          if (cached) { setData(cached as typeof data); setNoRoute(false); return; }
        }
        setNoRoute(true);
      })
      .finally(() => setLoading(false));

  // En producción puede haber un fallo transitorio inmediatamente después de que
  // el chofer reclamó el vehículo o inició la ruta. En ese caso reintentamos una
  // vez antes de redirigir a scan, para evitar el bounce-back post gate de fatiga.
  // El reintento delega en load(), que ante un fallo de red sirve la ruta cacheada
  // (clave para abrir la app sin conexión) antes de marcar noRoute.
  const loadWithRetry = () => {
    setLoading(true);
    driverApi
      .getRoute()
      .then((d) => {
        setData(d);
        setNoRoute(false);
        setLoading(false);
        if (user) {
          cacheRoute(user.id, d).catch(() => {});
          if (d.waypoints && d.waypoints.length >= 2) {
            prefetchRouteGeometry(user.id, d.waypoints, d.origin ?? undefined).catch(() => {});
          }
        }
      })
      .catch((err) => {
        // 404 definitivo: no reintentar, mostrar pantalla sin ruta.
        if (err?.response?.status === 404) { setNoRoute(true); setLoading(false); return; }
        setTimeout(() => { load(); }, 2000);
      });
  };

  useEffect(() => { loadWithRetry(); }, []);
  useEffect(() => { zoneApi.list().then(setZones).catch(() => {}); }, []);

  // Reconciliación de la cola offline. Corre en cada montaje y cada vez que
  // cambia la conectividad:
  //   1. Lee la cola persistida en IndexedDB y la refleja en pendingSyncIds
  //      (así sobreviven las acciones encoladas en una sesión previa).
  //   2. Si hay conexión y cola pendiente, la reproduce contra el backend.
  //   3. Las acciones sincronizadas con éxito se quitan del set; las fallidas
  //      quedan en cola y se avisa al chofer (se reintentan en el próximo ciclo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const actions = await getAllQueuedActions().catch(() => []);
      if (cancelled) return;
      if (actions.length > 0) {
        setPendingSyncIds((prev) => {
          const next = new Set(prev);
          actions.forEach((a) => next.add(a.trackingId));
          return next;
        });
      }
      if (!isOnline || actions.length === 0) return;
      setSyncing(true);
      try {
        const results = await syncQueue();
        if (cancelled) return;
        const okIds = new Set(results.filter((r) => r.success).map((r) => r.trackingId));
        setPendingSyncIds((prev) => {
          const next = new Set(prev);
          okIds.forEach((id) => next.delete(id));
          return next;
        });
        const failed = results.filter((r) => !r.success).length;
        if (failed > 0) {
          setActionError(`No se pudieron sincronizar ${failed} acción(es). Se reintentará automáticamente.`);
        }
        load();
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling de bloqueo por fatiga — cada 5 s mientras la ruta está activa (LOGITRACK-499).
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await driverApi.getFatigueBlockStatus();
        const nowBlocked = status.blocked ?? false;
        setFatigueBlocked(nowBlocked);
        if (!nowBlocked && status.recently_unblocked && status.unblocked_by) {
          const ackKey = (status as { unblocked_at?: string }).unblocked_at ?? "seen";
          const storedAck = sessionStorage.getItem("lt_fatigue_ack_route");
          pendingAckRef.current = ackKey;
          if (ackKey !== storedAck) {
            setFatigueUnblockedBy(status.unblocked_by);
          }
        }
      } catch {
        // Error de red → mantener estado actual (conservador)
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  // Returns the driver's current GPS coordinates (null in simulation mode or without fix).
  // Returns the driver's current position (real GPS or simulated) for geofence checking.
  const driverCoords = (): { lat: number; lng: number } | null => userLocation ?? null;

  // Checks whether the driver's current position is within the geofence of the
  // recipient address. Returns the distance in meters, or null when coords are unavailable.
  const checkGeofence = (shipment: Shipment): number | null => {
    const pos = driverCoords();
    const addr = shipment.recipient?.address;
    if (!pos || addr?.latitude == null || addr?.longitude == null) return null;
    return distanceMeters(pos.lat, pos.lng, addr.latitude, addr.longitude);
  };

  // Opens a sheet after checking geofence. If outside radius, shows the warning
  // first and only opens the sheet if the driver confirms.
  const openDeliverSheet = (shipment: Shipment) => {
    // Resetear antes de cargar para evitar que queden intentos de un envío anterior.
    setOfflineKeywordAttempts(0);
    getKeywordAttempts(shipment.tracking_id).then(setOfflineKeywordAttempts).catch(() => {});
    const distM = checkGeofence(shipment);
    if (distM !== null && distM > GEOFENCE_RADIUS_M) {
      setGeoWarning({ distanceM: distM, onConfirm: () => { setGeoWarning(null); setDeliverShipment(shipment); } });
    } else {
      setDeliverShipment(shipment);
    }
  };

  const openFailedSheet = (shipment: Shipment) => {
    const distM = checkGeofence(shipment);
    if (distM !== null && distM > GEOFENCE_RADIUS_M) {
      setGeoWarning({ distanceM: distM, onConfirm: () => { setGeoWarning(null); setFailedShipment(shipment); } });
    } else {
      setFailedShipment(shipment);
    }
  };

  const openRejectedSheet = (shipment: Shipment) => {
    const distM = checkGeofence(shipment);
    if (distM !== null && distM > GEOFENCE_RADIUS_M) {
      setGeoWarning({ distanceM: distM, onConfirm: () => { setGeoWarning(null); setRejectedShipment(shipment); } });
    } else {
      setRejectedShipment(shipment);
    }
  };

  const closeSheets = () => {
    setDeliverShipment(null);
    setFailedShipment(null);
    setRejectedShipment(null);
    setRecipientDni("");
    setDeliveryKeyword("");
    setUseContingency(false);
    setFailedReason("");
    setFailedNotes("");
    setRejectedReason("");
    setRejectedNotes("");
    setDeliveryPhoto(null);
  };

  // Secuencia post-entrega:
  //  1) Lee los misfires globales acumulados en misfireRef
  //  2) Consulta el gate enviando ese conteo al backend
  //  3) Resetea el contador local y el registro del backend
  //  4) Si se requiere test: pausa el simulador + despliega el overlay
  //  5) Si no: reanuda el simulador y refresca la ruta
  const checkReTestGate = async () => {
    const misfires = misfireRef.current;
    let requireTest = false;
    try {
      const eligibility = await driverApi.getTestEligibility({ misfires });
      requireTest = eligibility.require_test;
    } catch {
      // error de red → continuar sin bloquear
    }
    const capturedMisfires = misfireRef.current;
    misfireRef.current = 0; // resetear contador local siempre
    if (requireTest) {
      // Consultar si ya se registraron horas de sueño hoy para no pedirlas de nuevo.
      try {
        const checkin = await driverApi.getTodayCheckin().catch(() => ({ ok: false, requires_sleep_data: true }));
        setRequiresSleepData(checkin.requires_sleep_data ?? true);
      } catch {
        setRequiresSleepData(true);
      }
      // No resetear el backend todavía: SubmitCheckin leerá los misfires
      // almacenados y los incluirá en el registro. El reset se hace en onDone.
      setCheckinMisfires(capturedMisfires);
      pause();
      setMidRouteCheckin(true);
      return;
    }
    driverApi.resetMisfires().catch(() => {}); // sin gate: resetear para el próximo paquete
    play();
    load();
  };

  const handleDeliver = async () => {
    if (!deliverShipment) return;
    const isLastMile = deliverShipment.delivery_method === "ultima_milla";
    if (isLastMile) {
      const serverLocked = (deliverShipment.keyword_attempts ?? 0) >= 3;
      if (useContingency) {
        if (!recipientDni.trim()) return;
      } else {
        if (serverLocked || !deliveryKeyword.trim()) return;
      }
      if (!deliveryPhoto) return;
    } else {
      if (!recipientDni.trim()) return;
    }

    // ── Path offline ────────────────────────────────────────────────────────
    if (!isOnline) {
      // El retiro en sucursal se opera desde la web, no desde la app del chofer;
      // su flujo (updateStatus + DNI) no está soportado offline. Defensivo: no
      // encolamos una acción malformada.
      if (!isLastMile) {
        setActionError("La entrega en sucursal requiere conexión.");
        return;
      }
      if (!useContingency) {
        setSubmitting(true);
        const offlineAttempts = await getKeywordAttempts(deliverShipment.tracking_id);
        if (offlineAttempts >= 3) {
          setActionError("Palabra clave bloqueada (sin conexión). Usá el DNI como alternativa.");
          setSubmitting(false);
          return;
        }
        const hash = deliverShipment.keyword_hash;
        if (!hash) {
          const newCount = await incrementKeywordAttempts(deliverShipment.tracking_id);
          setOfflineKeywordAttempts(newCount);
          setDeliveryKeyword("");
          if (newCount >= 3) {
            setActionError("Sin conexión y sin datos de verificación local. Intentos agotados. Usá el DNI como alternativa.");
          } else {
            setActionError(`Sin conexión y sin datos de verificación local. Intento ${newCount}/3. Usá el DNI como alternativa.`);
          }
          setSubmitting(false);
          return;
        }
        const valid = await bcryptCompare(deliveryKeyword.trim().toUpperCase(), hash);
        if (!valid) {
          const newCount = await incrementKeywordAttempts(deliverShipment.tracking_id);
          setOfflineKeywordAttempts(newCount);
          setDeliveryKeyword("");
          if (newCount >= 3) {
            setActionError("Palabra clave incorrecta. Intentos agotados. Usá el DNI como alternativa.");
          } else {
            setActionError(`Palabra clave incorrecta. Intento ${newCount}/3.`);
          }
          setSubmitting(false);
          return;
        }
      }
      const coords = driverCoords();
      await enqueueAction({
        type: "deliver",
        trackingId: deliverShipment.tracking_id,
        payload: {
          keyword: useContingency ? undefined : deliveryKeyword.trim(),
          recipient_dni: useContingency ? recipientDni.trim() : undefined,
          contingency: useContingency || undefined,
          current_speed: effectiveSpeed,
          speed_source: speedSource,
          latitude: coords?.lat,
          longitude: coords?.lng,
        },
        photoBlob: deliveryPhoto ?? undefined,
        enqueuedAt: Date.now(),
      });
      setPendingSyncIds((prev) => new Set(prev).add(deliverShipment.tracking_id));
      closeSheets();
      setSubmitting(false);
      return;
    }

    // ── Path online ─────────────────────────────────────────────────────────
    setSubmitting(true);
    setActionError("");
    const coords = driverCoords();
    try {
      if (isLastMile) {
        await shipmentApi.deliver(deliverShipment.tracking_id, {
          keyword: useContingency ? undefined : deliveryKeyword.trim(),
          recipient_dni: useContingency ? recipientDni.trim() : undefined,
          contingency: useContingency,
          current_speed: effectiveSpeed,
          speed_source: speedSource,
          photo: deliveryPhoto!,
          latitude: coords?.lat,
          longitude: coords?.lng,
        });
      } else {
        await shipmentApi.updateStatus(deliverShipment.tracking_id, {
          status: "delivered",
          location: "",
          recipient_dni: recipientDni.trim(),
          current_speed: effectiveSpeed,
          speed_source: speedSource,
          latitude: coords?.lat,
          longitude: coords?.lng,
        });
      }
      closeSheets();
      await checkReTestGate();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (msg?.includes("intento") || msg?.includes("bloqueado")) {
        setDeliveryKeyword("");
        const updated = await shipmentApi.get(deliverShipment.tracking_id).catch(() => null);
        if (updated) setDeliverShipment(updated);
      }
      setActionError(msg ?? "No se pudo registrar la entrega.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFailedAttempt = async () => {
    if (!failedShipment) return;
    const reasonLabel = FAILED_REASONS.find((r) => r.id === failedReason)?.label ?? "";
    const note = [reasonLabel, failedNotes.trim()].filter(Boolean).join(" — ");
    if (!note) return;

    setSubmitting(true);
    setActionError("");
    const coords = driverCoords();

    if (!isOnline) {
      await enqueueAction({
        type: "delivery_failed",
        trackingId: failedShipment.tracking_id,
        payload: { status: "delivery_failed", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource, latitude: coords?.lat, longitude: coords?.lng },
        enqueuedAt: Date.now(),
      });
      setPendingSyncIds((prev) => new Set(prev).add(failedShipment.tracking_id));
      closeSheets();
      setSubmitting(false);
      return;
    }

    try {
      await shipmentApi.updateStatus(failedShipment.tracking_id, {
        status: "delivery_failed",
        location: "",
        notes: note,
        current_speed: effectiveSpeed,
        speed_source: speedSource,
        latitude: coords?.lat,
        longitude: coords?.lng,
      });
      closeSheets();
      await checkReTestGate();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo registrar el intento fallido.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejected = async () => {
    if (!rejectedShipment || !rejectedReason) return;
    const reasonEntry = REJECTED_REASONS.find((r) => r.id === rejectedReason);
    const reasonLabel = reasonEntry ? `${reasonEntry.emoji} ${reasonEntry.label}` : rejectedReason;
    const note = [reasonLabel, rejectedNotes.trim()].filter(Boolean).join(" — ");

    setSubmitting(true);
    setActionError("");
    const coords = driverCoords();

    if (!isOnline) {
      await enqueueAction({
        type: "rejected",
        trackingId: rejectedShipment.tracking_id,
        payload: { status: "delivery_failed", location: "", notes: note, rejected_by_recipient: true, current_speed: effectiveSpeed, speed_source: speedSource, latitude: coords?.lat, longitude: coords?.lng },
        enqueuedAt: Date.now(),
      });
      setPendingSyncIds((prev) => new Set(prev).add(rejectedShipment.tracking_id));
      closeSheets();
      setSubmitting(false);
      return;
    }

    try {
      await shipmentApi.updateStatus(rejectedShipment.tracking_id, {
        status: "delivery_failed",
        location: "",
        notes: note,
        rejected_by_recipient: true,
        current_speed: effectiveSpeed,
        speed_source: speedSource,
        latitude: coords?.lat,
        longitude: coords?.lng,
      });
      closeSheets();
      await checkReTestGate();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo registrar el rechazo.");
    } finally {
      setSubmitting(false);
    }
  };

  // Hooks que necesitan estar antes de cualquier return condicional


  const routePoints = useMemo(() => {
    const origin = data?.origin;
    const wps = data?.waypoints ?? [];
    const pts: Array<{ lat: number; lng: number }> = [];
    if (origin) pts.push({ lat: origin.latitude, lng: origin.longitude });
    [...wps].sort((a, b) => a.sequence - b.sequence)
      .forEach((wp) => pts.push({ lat: wp.latitude, lng: wp.longitude }));
    return pts;
  }, [data]);

  // Puntos de entrega pendientes en orden de secuencia. El simulador se
  // detiene automáticamente al entrar en el radio del primero de la lista.
  const deliveryPoints = useMemo(() => {
    if (!data?.waypoints) return [];
    return [...data.waypoints]
      .filter((wp) => wp.status === "out_for_delivery")
      .sort((a, b) => a.sequence - b.sequence)
      .map((wp) => ({ lat: wp.latitude, lng: wp.longitude }));
  }, [data]);

  const [simActive, setSimActive] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  const { position: userLocation, mode: simulationMode, isPaused, pause, play, reset } =
    useGeolocation(routePoints, simActive ? "simulate" : undefined, 360 * speedMultiplier, deliveryPoints);

  // Router Guard anti-bypass por F5: si quedó un wizard de fatiga a mitad de
  // camino (persistido en sessionStorage), forzar el gate de inmediato — el
  // backend ya da por completo el check-in apenas se envía el paso KSS, así
  // que no podemos confiar solo en su respuesta para decidir si mostrarlo.
  useEffect(() => {
    if (!user) return;
    if (!getPendingFatigueStep(user.id)) return;
    driverApi.getTodayCheckin()
      .then((checkin) => setRequiresSleepData(checkin.requires_sleep_data ?? true))
      .catch(() => setRequiresSleepData(true))
      .finally(() => {
        pause();
        setMidRouteCheckin(true);
      });
  }, [user, pause]);

  const cycleSpeedMultiplier = () =>
    setSpeedMultiplier((prev) => (prev >= 8 ? 1 : prev * 2));

  // Re-ejecutar prefetch con ubicación GPS real en cuanto esté disponible,
  // para que el cache offline use la posición del chofer y no la sucursal.
  useEffect(() => {
    if (!userLocation || !data?.waypoints || !user) return;
    const pending = data.waypoints.filter(
      (wp) => wp.status !== 'delivered' && wp.status !== 'delivery_failed'
    );
    if (pending.length < 1) return;
    prefetchRouteGeometry(user.id, pending, data.origin ?? undefined, userLocation).catch(() => {});
  }, [userLocation?.lat, userLocation?.lng]);

  // ── BUG-43: gate de entrega consciente del simulador ───────────────────────
  // Si la simulación de Leaflet está activa, la velocidad efectiva es la velocidad
  // VIRTUAL del vehículo (0 cuando está pausado/detenido en una parada; la
  // velocidad de demo cuando se mueve). En modo real se usa el GPS del dispositivo
  // SIN fallback permisivo: si no hay fix de ubicación, la entrega se bloquea.
  const simulationActive = simulationMode === "simulate";
  const simSpeedKmh = simulationActive ? (isPaused ? 0 : 360 * speedMultiplier) : 0;
  const speedSource: "simulation" | "real_gps" = simulationActive ? "simulation" : "real_gps";
  const effectiveSpeed = simulationActive ? simSpeedKmh : gpsSpeedKmh;

  const movingTooFast = effectiveSpeed > 5;
  // Ubicación faltante solo aplica en modo real (la simulación siempre "conoce" la posición).
  const locationMissing = !simulationActive && !locationReady;
  const deliveryBlocked = movingTooFast || locationMissing;
  const blockMessage = movingTooFast
    ? "Detenga el vehículo para entregar"
    : locationMissing
      ? "Ubicación requerida. Active el GPS y deténgase para entregar"
      : "";

  // Calculado antes de early returns para poder usarlo en el useEffect de abajo.
  const routeEffectivelyDone = data
    ? ((data.route.status === "finalizada" || data.route.status === "en_curso") &&
        data.shipments.filter(
          (s) => s.status === "out_for_delivery" && !pendingSyncIds.has(s.tracking_id),
        ).length === 0 &&
        data.shipments.length > 0)
    : false;

  // Limpiar cache de jornada al finalizar la ruta. Debe estar antes de cualquier
  // early return para cumplir las reglas de hooks de React.
  useEffect(() => {
    if (routeEffectivelyDone && user) {
      clearDayCache(user.id).catch(() => {});
    }
  }, [routeEffectivelyDone, user?.id]);

  // Gate de re-test en ruta: se activa tras una acción de entrega si el backend
  // detecta que pasaron más de 3h o hay más de 5 misfires acumulados.
  // Solo aplica a choferes de última milla; el overlay cubre toda la pantalla.
  if (midRouteCheckin && user) {
    return (
      <KssCheckIn
        driverId={user.id}
        misfireCount={checkinMisfires}
        requiresSleepData={requiresSleepData}
        onDone={() => {
          setMidRouteCheckin(false);
          setRequiresSleepData(false); // sueño ya registrado, no pedir de nuevo hoy
          driverApi.resetMisfires().catch(() => {}); // resetear tras el check-in, no antes
          play();
          load();
        }}
      />
    );
  }

  if (loading) return <RouteSkeleton />;
  if (noRoute) return <Navigate to="/driver/scan" replace />;
  if (!data) return null;

  const routeStatus = data.route.status ?? "pendiente";
  const [ry, rm, rd] = data.route.date.split("-");
  const today = `${rd}/${rm}/${ry}`;

  const pendingList = data.shipments.filter(
    (s) => s.status === "out_for_delivery" && !pendingSyncIds.has(s.tracking_id),
  );
  const completedList = data.shipments.filter(
    (s) => s.status === "delivered" || s.status === "delivery_failed" || pendingSyncIds.has(s.tracking_id),
  );
  const total = data.shipments.length;
  const done = completedList.length;
  const pending = pendingList.length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  if (routeEffectivelyDone) {
    return <RouteCompletedView data={data} today={today} />;
  }

  const canAct = routeStatus === "en_curso";
  const waypoints = data?.waypoints ?? [];
  const origin = data?.origin;

  // Orden de la ruta según los waypoints del mapa
  const sequenceOf = Object.fromEntries(
    waypoints.map((wp) => [wp.tracking_id, wp.sequence])
  );
  const byRouteOrder = (a: Shipment, b: Shipment) =>
    (sequenceOf[a.tracking_id] ?? 9999) - (sequenceOf[b.tracking_id] ?? 9999);

  const visibleList = tab === "pendientes"
    ? [...pendingList].sort(byRouteOrder)
    : [...completedList].sort(byRouteOrder);

  // Próxima parada pendiente y shipment asociado
  const allPendingStops = waypoints
    .filter((wp) => wp.status === "out_for_delivery")
    .sort((a, b) => a.sequence - b.sequence);

  const nextStop = allPendingStops[0] ?? null;

  const nextShipment = nextStop
    ? (data?.shipments.find((s) => s.tracking_id === nextStop.tracking_id) ?? null)
    : null;

  // Zonas peligrosas donde está el chofer actualmente
  const activeDangerZones = userLocation
    ? zones.filter((z) => z.active && isInDangerZone(userLocation.lat, userLocation.lng, [z]))
    : [];

  return (
    <div className="pb-32">
      {/* Banner offline */}
      {(!isOnline || syncing) && (
        <div className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2 px-4 py-2 text-xs font-semibold ${syncing ? "bg-amber-400 text-amber-900" : "bg-slate-700 text-white"}`}>
          <span className="flex items-center gap-1.5">
            {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <WifiOff className="w-3.5 h-3.5" />}
            {syncing ? "Sincronizando acciones pendientes…" : "Sin conexión — las acciones se guardan localmente"}
          </span>
          {!syncing && pendingSyncIds.size > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-white/20">{pendingSyncIds.size} pendiente{pendingSyncIds.size !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {/* Header sticky con progreso y tabs */}
      <header className={`sticky z-10 bg-white/95 backdrop-blur border-b dark:border-gray-700 border-slate-200 ${(!isOnline || syncing) ? "top-8" : "top-0"}`}>
        <div className="px-4 sm:px-6 max-w-2xl mx-auto pt-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] flex items-center justify-center shrink-0">
                <Truck className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold dark:text-gray-100 text-slate-900 leading-tight tracking-tight">Mi ruta</h1>
                <p className="text-[11px] dark:text-gray-400 text-slate-500 leading-tight">
                  {today} · {done}/{total} completados
                </p>
              </div>
            </div>

            {/*  Toggle Lista/Mapa */}
            {canAct && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setViewMode('list')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${viewMode === 'list'
                    ? 'bg-[var(--sidebar-bg)] text-white'
                    : 'dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-100'
                    }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  Lista
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${viewMode === 'map'
                    ? 'bg-[var(--sidebar-bg)] text-white'
                    : 'dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-100'
                    }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Mapa
                </button>
              </div>
            )}

            {!simActive && simulationMode === "real" && (
              <button
                onClick={() => { setSimActive(true); setViewMode('map'); }}
                title="Activar simulación GPS"
                className="text-[16px] opacity-30 hover:opacity-70 transition-opacity cursor-pointer select-none"
              >
                <Film size={16} />
              </button>
            )}

            {/* Badge minimizado de zona peligrosa — visible solo cuando el cartel grande fue descartado */}
            {isDangerDismissed && (
              <span
                title="Zona peligrosa activa"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-red-600 text-[11px] font-bold shrink-0 animate-pulse"
              >
                <AlertTriangle size={12} className="mr-0.5" /> Zona
              </span>
            )}
            <RouteStatusPill status={routeStatus} />
          </div>

          <div className="mt-3">
            <div className="h-1.5 w-full rounded-full dark:bg-gray-700/50 bg-slate-100 overflow-hidden">
              <div
                ref={el => { if (el) el.style.width = `${progressPct}%`; }}
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-500"
              />
            </div>
          </div>

          {canAct && viewMode === 'list' && (
            <div className="mt-3 -mx-4 sm:-mx-6 px-4 sm:px-6 flex gap-1 border-b-0">
              <TabButton active={tab === "pendientes"} onClick={() => setTab("pendientes")}>
                Pendientes
                <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  {pending}
                </span>
              </TabButton>
              <TabButton active={tab === "completados"} onClick={() => setTab("completados")}>
                Completados
                <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {done}
                </span>
              </TabButton>
            </div>
          )}
        </div>
      </header>

      <div className="px-4 sm:px-6 max-w-2xl mx-auto pt-4">
        {actionError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              onClick={() => setActionError("")}
              className="text-xs font-semibold text-rose-700 hover:text-rose-900 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

        {routeStatus === "pendiente" && (
          <Card className="mb-4 border-amber-200 bg-amber-50/60">
            <div className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-900">Ruta sin iniciar</p>
                <p className="mt-0.5 text-xs text-amber-800 leading-relaxed">
                  Iniciá la ruta para habilitar las acciones de entrega. Una vez iniciada, no se pueden agregar nuevos envíos.
                </p>
                {data.route.suggested_start_time && (
                  <p className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-100 border border-amber-300 text-xs font-semibold text-amber-900">
                    <Clock className="w-3.5 h-3.5" />
                    Salida sugerida: {new Date(data.route.suggested_start_time).toLocaleTimeString("es-AR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Renderizado condicional Lista o Mapa */}
        {viewMode === 'map' ? (
          <>
            <MapView
              waypoints={waypoints}
              origin={origin}
              userLocation={userLocation ?? undefined}
              simulationMode={simulationMode}
              driverId={user?.id}
              simulationControls={{
                isPaused, pause, play, reset,
                onExit: () => { setSimActive(false); setSpeedMultiplier(1); },
                speedMultiplier,
                onCycleSpeed: cycleSpeedMultiplier,
                onFastForwardTime: () => driverApi.fastForwardCheckinTime().catch(() => {}),
              }}
              zones={zones}
              onRouteInfoChange={setRouteInfo}
              onWaypointClick={(trackingId) => navigate(`/shipments/${trackingId}`)}
            />
            <ZoneAlert zones={activeDangerZones} onDismissedChange={setIsDangerDismissed} />
          </>
        ) : (
          <>
            {visibleList.length === 0 ? (
              <Card className="p-8 text-center">
                {tab === "pendientes" ? (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold dark:text-gray-100 text-slate-900">¡Todo listo por ahora!</p>
                    <p className="mt-1 text-xs dark:text-gray-400 text-slate-500">No quedan entregas pendientes.</p>
                  </>
                ) : (
                  <p className="text-sm dark:text-gray-400 text-slate-500">Aún no completaste ninguna entrega.</p>
                )}
              </Card>
            ) : (
              <div className="grid gap-3">
                {visibleList.map((shipment, idx) => (
                  <div key={shipment.tracking_id}>
                    <ShipmentCard
                      shipment={shipment}
                      order={tab === "pendientes" ? idx + 1 : undefined}
                      canAct={canAct && tab === "pendientes"}
                      getMisfires={() => misfireRef.current}
                      onDeliver={() => openDeliverSheet(shipment)}
                      onFailed={() => openFailedSheet(shipment)}
                      onRejected={() => openRejectedSheet(shipment)}
                      onOpen={() => navigate(`/shipments/${shipment.tracking_id}`)}
                    />
                    {pendingSyncIds.has(shipment.tracking_id) && (
                      <div className="flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-b-lg bg-amber-50 border border-t-0 border-amber-200 text-xs text-amber-700 font-medium">
                        <RefreshCw className="w-3 h-3" />
                        Pendiente de sincronización
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Card próxima parada (solo en vista mapa con ruta en curso) */}
      {viewMode === 'map' && canAct && (
        <NextStopCard
          nextStop={nextStop}
          allPendingStops={allPendingStops}
          userLocation={userLocation ?? undefined}
          routeInfo={routeInfo}
          canAct={canAct}
          onDeliver={() => {
            if (!nextShipment) return;
            openDeliverSheet(nextShipment);
            if (nextShipment.delivery_method === "ultima_milla") setCameraOpen(true);
          }}
          onFailed={() => { if (nextShipment) openFailedSheet(nextShipment); }}
          onRejected={() => { if (nextShipment) openRejectedSheet(nextShipment); }}
        />
      )}


      {/* Camera for delivery photo */}
      {cameraOpen && (
        <CameraCapture
          onCapture={(blob) => {
            setDeliveryPhoto(blob);
            setCameraOpen(false);
          }}
          onClose={() => {
            setCameraOpen(false);
            if (!deliveryPhoto) setDeliverShipment(null);
          }}
        />
      )}

      {/* Bottom sheets */}
      <DeliverSheet
        open={!!deliverShipment && !cameraOpen}
        onClose={closeSheets}
        shipment={deliverShipment}
        keyword={deliveryKeyword}
        onKeywordChange={setDeliveryKeyword}
        useContingency={useContingency}
        onUseContingency={setUseContingency}
        dni={recipientDni}
        onDniChange={setRecipientDni}
        submitting={submitting}
        onConfirm={handleDeliver}
        speedBlocked={deliveryBlocked}
        blockMessage={blockMessage}
        needsLocation={locationMissing}
        onRequestLocation={requestLocation}
        locationRequesting={locationRequesting}
        locationErrorMsg={locationErrorMsg}
        error={actionError}
        photo={deliveryPhoto}
        onRetakePhoto={() => setCameraOpen(true)}
        offlineKeywordAttempts={offlineKeywordAttempts}
      />
      <FailedSheet
        open={!!failedShipment}
        onClose={() => { setFailedShipment(null); setFailedReason(""); setFailedNotes(""); }}
        shipment={failedShipment}
        reason={failedReason}
        onReasonChange={setFailedReason}
        notes={failedNotes}
        onNotesChange={setFailedNotes}
        submitting={submitting}
        onConfirm={handleFailedAttempt}
        speedBlocked={deliveryBlocked}
        blockMessage={blockMessage}
        needsLocation={locationMissing}
        onRequestLocation={requestLocation}
        locationRequesting={locationRequesting}
        locationErrorMsg={locationErrorMsg}
      />
      <RejectedSheet
        open={!!rejectedShipment}
        onClose={() => { setRejectedShipment(null); setRejectedReason(""); setRejectedNotes(""); }}
        shipment={rejectedShipment}
        reason={rejectedReason}
        onReasonChange={setRejectedReason}
        notes={rejectedNotes}
        onNotesChange={setRejectedNotes}
        submitting={submitting}
        onConfirm={handleRejected}
        speedBlocked={deliveryBlocked}
        blockMessage={blockMessage}
        needsLocation={locationMissing}
        onRequestLocation={requestLocation}
        locationRequesting={locationRequesting}
        locationErrorMsg={locationErrorMsg}
      />

      {/* Overlay de bloqueo por fatiga — fixed encima de todo (LOGITRACK-499) */}
      {fatigueBlocked && (
        <div className="fixed inset-0 z-[9999] bg-[#1a1a2e] flex flex-col items-center justify-center p-8 text-center gap-6">
          <AlertTriangle size={64} className="text-red-500" />
          <h2 className="text-white text-[22px] font-bold m-0">
            Alerta de fatiga detectada
          </h2>
          <p className="text-slate-400 text-base leading-relaxed m-0">
            Tu supervisor fue notificado.<br/>
            Esperá su indicación antes de continuar.
          </p>
        </div>
      )}

      {/* Cartelito de autorización — visible cuando el supervisor desbloqueó la ruta (LOGITRACK-501) */}
      {!fatigueBlocked && fatigueUnblockedBy && (
        <div className="fixed inset-0 z-[9999] bg-[#0d1f12] flex flex-col items-center justify-center p-8 text-center gap-6">
          <CheckCircle2 size={64} className="text-emerald-500" />
          <h2 className="text-white text-[22px] font-bold m-0">
            Ruta autorizada
          </h2>
          <p className="text-green-300 text-base leading-relaxed m-0">
            Tu supervisor <strong className="text-white">{fatigueUnblockedBy}</strong> autorizó<br/>
            que continúes la ruta.
          </p>
          <button
            onClick={() => {
              if (pendingAckRef.current) sessionStorage.setItem("lt_fatigue_ack_route", pendingAckRef.current);
              setFatigueUnblockedBy(null);
            }}
            className="mt-2 px-9 py-3 rounded-[10px] border-none bg-green-600 text-white text-base font-bold cursor-pointer"
          >
            Continuar
          </button>
        </div>
      )}

      {/* Modal de advertencia de geofence */}
      {geoWarning && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
            <div className="flex items-start gap-3 px-5 pt-5 pb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-900 dark:text-gray-100">Ubicación fuera de rango</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-gray-400 leading-relaxed">
                  Estás a <span className="font-semibold text-amber-700">{Math.round(geoWarning.distanceM)} m</span> del domicilio del destinatario
                  (máximo {GEOFENCE_RADIUS_M} m).
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-gray-500">
                  Si confirmás, se registrará un incidente en el envío para revisión del supervisor.
                </p>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setGeoWarning(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border dark:border-gray-700 border-slate-200 dark:text-gray-300 text-slate-700 dark:hover:bg-gray-800 hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={geoWarning.onConfirm}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white transition-colors"
              >
                Confirmar igual
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Sub-componentes                                                      */
/* ─────────────────────────────────────────────────────────────────── */

function RouteStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800" },
    en_curso: { label: "En curso", cls: "bg-emerald-100 text-emerald-800" },
    finalizada: { label: "Finalizada", cls: "bg-indigo-100 text-indigo-800" },
  };
  const c = map[status] ?? map.pendiente;
  return (
    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-10 px-4 text-sm font-semibold cursor-pointer transition-colors ${active ? "text-[var(--brand)]" : "dark:text-gray-400 text-slate-500 dark:hover:text-gray-200 hover:text-slate-700"
        }`}
    >
      {children}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full bg-[var(--brand)]" />
      )}
    </button>
  );
}

function ShipmentCard({
  shipment,
  order,
  canAct,
  getMisfires,
  onDeliver,
  onFailed,
  onRejected,
  onOpen,
}: {
  shipment: Shipment;
  order?: number;
  canAct: boolean;
  getMisfires: () => number;
  onDeliver: () => void;
  onFailed: () => void;
  onRejected: () => void;
  onOpen: () => void;
}) {
  // Momento en que la card se montó — para calcular reaction_time_ms.
  const renderTimeRef = useRef<number>(0);
  useEffect(() => { renderTimeRef.current = Date.now(); }, []);

  /** Envía el evento táctil al backend (fire-and-forget). */
  const fireTouchEvent = (action: TouchEventPayload["action"]) => {
    driverApi.submitTouchEvent({
      tracking_id: shipment.tracking_id,
      action,
      reaction_time_ms: Date.now() - renderTimeRef.current,
      misfires: getMisfires(), // leer el contador global del padre
    }).catch(() => {});
  };

  const handleDeliverClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // no burbujar al listener global → no cuenta como misfire
    fireTouchEvent("entregado");
    onDeliver();
  };

  const handleFailedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fireTouchEvent("no_entregado");
    onFailed();
  };

  const handleRejectedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fireTouchEvent("no_entregado");
    onRejected();
  };

  const { name, phone, fullAddress, specialInstructions } = recipientView(shipment);
  const isCompleted =
    shipment.status === "delivered" ||
    shipment.status === "delivery_failed" ||
    shipment.status === "rechazado";
  const isFailed = shipment.status === "delivery_failed";
  const isDelivered = shipment.status === "delivered";
  const isRejected = shipment.status === "rechazado";

  const cor = shipment.corrections ?? {};
  const tw = (cor.time_window ?? shipment.time_window) as typeof shipment.time_window;
  const twTone = timeWindowTone(tw);
  const fragile = !!shipment.is_fragile;
  const attempts = shipment.delivery_attempts ?? 0;

  return (
    <Card
      className={
        isCompleted
          ? "p-0 dark:bg-gray-800/50 bg-slate-50/60 dark:bg-slate-800/30 dark:border-gray-700 border-slate-200"
          : "p-0 hover:shadow-md transition-shadow"
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left px-4 pt-4 pb-3 cursor-pointer"
      >
        <div className="flex items-start gap-3">
          {order !== undefined && (
            <div className="shrink-0 w-9 h-9 rounded-xl bg-[var(--sidebar-bg)] text-white text-sm font-bold flex items-center justify-center">
              {String(order).padStart(2, "0")}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className={`text-base font-bold leading-snug ${isCompleted ? "dark:text-gray-400 text-slate-600" : "dark:text-gray-100 text-slate-900"}`}>
                {name}
              </p>
              {isDelivered && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" />
                  Entregado
                </span>
              )}
              {isFailed && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full">
                  <XCircle className="w-3 h-3" />
                  Sin entregar
                </span>
              )}
              {isRejected && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <Ban className="w-3 h-3" />
                  Rechazado
                </span>
              )}
            </div>
            <p className={`mt-1 text-sm leading-snug flex items-start gap-1.5 ${isCompleted ? "dark:text-gray-400 text-slate-500" : "dark:text-gray-300 text-slate-700"}`}>
              <MapPin className="w-3.5 h-3.5 mt-0.5 dark:text-gray-500 text-slate-400 shrink-0" />
              <span className="break-words">{fullAddress}</span>
            </p>
          </div>
          {!isCompleted && <ChevronRight className="w-4 h-4 text-slate-300 mt-1.5 shrink-0" />}
        </div>

        {!isCompleted && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3 h-3" />
                {TIME_WINDOW_LABEL[tw] ?? tw} {TIME_WINDOW_HOURS[tw] && `· ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            {fragile && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="w-3 h-3" />
                Frágil
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border dark:bg-gray-800/50 bg-slate-50 dark:text-gray-300 text-slate-700 dark:border-gray-700 border-slate-200">
              <Package className="w-3 h-3" />
              {shipment.weight_kg} kg
            </span>
            {attempts > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                Reintento {attempts + 1}
              </span>
            )}
          </div>
        )}

        {!isCompleted && specialInstructions && (
          <div className="mt-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{specialInstructions}</span>
          </div>
        )}
      </button>

      {!isCompleted && (
        <div className="px-4 pb-4 border-t dark:border-gray-700 border-slate-100">
          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
            <WhatsAppQuickButton
              phone={phone}
              recipientName={name}
              trackingId={shipment.tracking_id}
              compact
            />
          </div>

          {canAct && (
            <>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button
                  onClick={handleDeliverClick}
                  className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Entregar
                </button>
                <button
                  onClick={handleFailedClick}
                  className="h-12 rounded-xl border-2 border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-bold cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  No entregado
                </button>
              </div>
              <button
                onClick={handleRejectedClick}
                className="w-full mt-2 h-11 rounded-xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-800 text-sm font-bold cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Ban className="w-4 h-4" />
                Rechazado por destinatario
              </button>
            </>
          )}

          <p className="mt-3 text-[10px] font-mono dark:text-gray-500 text-slate-400 text-center">{shipment.tracking_id}</p>
        </div>
      )}

      {isCompleted && (
        <button
          type="button"
          onClick={onOpen}
          className="w-full px-4 pb-3 -mt-1 text-left cursor-pointer"
        >
          <p className="text-[10px] font-mono dark:text-gray-500 text-slate-400">{shipment.tracking_id}</p>
        </button>
      )}
    </Card>
  );
}

function DeliverSheet({
  open,
  onClose,
  shipment,
  keyword,
  onKeywordChange,
  useContingency,
  onUseContingency,
  dni,
  onDniChange,
  submitting,
  onConfirm,
  speedBlocked,
  blockMessage,
  needsLocation,
  onRequestLocation,
  locationRequesting = false,
  locationErrorMsg = null,
  error,
  photo,
  onRetakePhoto,
  offlineKeywordAttempts = 0,
}: {
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  keyword: string;
  onKeywordChange: (s: string) => void;
  useContingency: boolean;
  onUseContingency: (v: boolean) => void;
  dni: string;
  onDniChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  speedBlocked: boolean;
  blockMessage: string;
  needsLocation: boolean;
  onRequestLocation: () => void;
  locationRequesting?: boolean;
  locationErrorMsg?: string | null;
  error: string;
  photo: Blob | null;
  onRetakePhoto: () => void;
  offlineKeywordAttempts?: number;
}) {
  const keywordRef = useRef<HTMLInputElement>(null);
  const dniRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        (useContingency ? dniRef : keywordRef).current?.focus();
      }, 80);
      return () => clearTimeout(t);
    }
  }, [open, useContingency]);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (!shipment) return null;
  const { name } = recipientView(shipment);
  const isLastMile = shipment.delivery_method === "ultima_milla";
  const keywordAttempts = shipment.keyword_attempts ?? 0;
  const locked = Math.max(keywordAttempts, offlineKeywordAttempts) >= 3;

  const canConfirm = isLastMile
    ? (useContingency ? !!dni.trim() : (!locked && !!keyword.trim())) && !!photo
    : !!dni.trim();

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Confirmar entrega"
      description={`Entrega a ${name}`}
    >
      {/* Delivery photo — required for última milla */}
      {isLastMile && (
        <div className="mb-4">
          {photo && photoPreview ? (
            <div className="relative rounded-xl overflow-hidden">
              <img src={photoPreview} alt="Foto de entrega" className="w-full h-36 object-cover" />
              <button
                onClick={(e) => { e.stopPropagation(); onRetakePhoto(); }}
                className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/70 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full cursor-pointer"
              >
                Sacar de nuevo
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onRetakePhoto(); }}
              className="w-full rounded-xl border-2 border-dashed border-emerald-400 dark:border-emerald-600 p-4 flex flex-col items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
            >
              <Camera className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Tomar foto de entrega</span>
              <span className="text-[11px] text-emerald-600/70 dark:text-emerald-500">Obligatoria para confirmar</span>
            </button>
          )}
        </div>
      )}

      {isLastMile && !useContingency && (
        <>
          {locked && (
            <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-xs font-bold text-red-700">Campo bloqueado — 3 intentos fallidos</p>
              <p className="text-[11px] text-red-600 mt-0.5">Usá la opción de entrega con DNI para continuar.</p>
            </div>
          )}
          {!locked && keywordAttempts > 0 && (
            <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5">
              <p className="text-[11px] text-amber-700 font-semibold">
                Intentos fallidos: {keywordAttempts}/3 — quedan {3 - keywordAttempts} intento(s)
              </p>
            </div>
          )}
          <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
            Palabra clave de seguridad
          </label>
          <input
            ref={keywordRef}
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            autoComplete="off"
            placeholder="Dictada por el destinatario"
            disabled={locked}
            className="w-full h-12 px-4 rounded-xl text-base focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500 driver-input disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="mt-1.5 text-[11px] dark:text-gray-400 text-slate-500">
            El cliente debe decirte su palabra clave al abrir la puerta.
          </p>
        </>
      )}

      {isLastMile && useContingency && (
        <>
          <div className="mb-3 rounded-xl bg-amber-50 border border-amber-300 px-4 py-3">
            <p className="text-xs font-bold text-amber-800"><AlertTriangle size={14} className="inline text-amber-500" /> Entrega de contingencia</p>
            <p className="text-[11px] text-amber-700 mt-0.5">El registro quedará marcado para auditoría del supervisor.</p>
          </div>
          <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
            DNI del destinatario
          </label>
          <input
            ref={dniRef}
            value={dni}
            onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej: 30123456"
            className="w-full h-12 px-4 rounded-xl text-base focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500 driver-input"
          />
        </>
      )}

      {!isLastMile && (
        <>
          <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
            DNI del destinatario
          </label>
          <input
            ref={dniRef}
            value={dni}
            onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej: 30123456"
            className="w-full h-12 px-4 rounded-xl text-base focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500 driver-input"
          />
          <p className="mt-1.5 text-[11px] dark:text-gray-400 text-slate-500">
            Solo dígitos. Debe coincidir con el DNI registrado al crear el envío.
          </p>
        </>
      )}

      {error && (
        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="h-12 rounded-xl border dark:border-gray-700 border-slate-200 bg-transparent dark:hover:bg-gray-700 hover:bg-slate-50 dark:text-gray-300 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!canConfirm || submitting || speedBlocked}
          className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar entrega"}
        </button>
      </div>

      {isLastMile && locked && !useContingency && (
        <button
          onClick={() => onUseContingency(true)}
          className="mt-3 w-full h-11 rounded-xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-bold cursor-pointer transition-colors"
        >
          Entregar con DNI
        </button>
      )}
      {isLastMile && useContingency && (
        <button
          onClick={() => onUseContingency(false)}
          className="mt-2 w-full text-[11px] dark:text-gray-400 text-slate-500 underline cursor-pointer"
        >
          Volver a intentar con palabra clave
        </button>
      )}

      {speedBlocked && (
        <div className="mt-2.5 text-center">
          <p className="text-xs font-semibold text-amber-600">{blockMessage}</p>
          {needsLocation && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onRequestLocation(); }}
                disabled={locationRequesting}
                className="mt-1.5 text-xs font-bold text-[var(--brand)] underline cursor-pointer disabled:opacity-50"
              >
                {locationRequesting ? "Solicitando…" : "Activar ubicación"}
              </button>
              {locationErrorMsg && (
                <p className="mt-1 text-[11px] text-red-500 px-2">{locationErrorMsg}</p>
              )}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function FailedSheet({
  open,
  onClose,
  shipment,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  submitting,
  onConfirm,
  speedBlocked,
  blockMessage,
  needsLocation,
  onRequestLocation,
  locationRequesting = false,
  locationErrorMsg = null,
}: {
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  reason: string;
  onReasonChange: (s: string) => void;
  notes: string;
  onNotesChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  speedBlocked: boolean;
  blockMessage: string;
  needsLocation: boolean;
  onRequestLocation: () => void;
  locationRequesting?: boolean;
  locationErrorMsg?: string | null;
}) {
  if (!shipment) return null;
  const { name } = recipientView(shipment);
  const requiresNotes = reason === "otro";
  const canSubmit = !!reason && !(requiresNotes && !notes.trim());

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Marcar como no entregado"
      description={`No entrega a ${name}`}
    >
      <p className="text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-2">
        ¿Qué pasó?
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {FAILED_REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onReasonChange(r.id)}
              className={`h-12 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-colors ${active
                ? "border-rose-500 bg-rose-50 text-rose-800"
                : "dark:border-gray-700 border-slate-200 bg-transparent dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700 hover:bg-slate-50"
                }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
        Notas {requiresNotes ? "(obligatorio)" : "(opcional)"}
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder={requiresNotes ? "Describí el motivo" : "Detalle adicional para el supervisor"}
        rows={3}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-[3px] focus:ring-rose-500/20 focus:border-rose-500 resize-y driver-input"
      />

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="h-12 rounded-xl border dark:border-gray-700 border-slate-200 bg-transparent dark:hover:bg-gray-700 hover:bg-slate-50 dark:text-gray-300 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!canSubmit || submitting || speedBlocked}
          className="h-12 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar"}
        </button>
      </div>
      {speedBlocked && (
        <div className="mt-2.5 text-center">
          <p className="text-xs font-semibold text-amber-600">{blockMessage}</p>
          {needsLocation && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onRequestLocation(); }}
                disabled={locationRequesting}
                className="mt-1.5 text-xs font-bold text-[var(--brand)] underline cursor-pointer disabled:opacity-50"
              >
                {locationRequesting ? "Solicitando…" : "Activar ubicación"}
              </button>
              {locationErrorMsg && (
                <p className="mt-1 text-[11px] text-red-500 px-2">{locationErrorMsg}</p>
              )}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}


function RejectedSheet({
  open,
  onClose,
  shipment,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  submitting,
  onConfirm,
  speedBlocked,
  blockMessage,
  needsLocation,
  onRequestLocation,
  locationRequesting = false,
  locationErrorMsg = null,
}: {
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  reason: string;
  onReasonChange: (s: string) => void;
  notes: string;
  onNotesChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  speedBlocked: boolean;
  blockMessage: string;
  needsLocation: boolean;
  onRequestLocation: () => void;
  locationRequesting?: boolean;
  locationErrorMsg?: string | null;
}) {
  if (!shipment) return null;
  const { name } = recipientView(shipment);
  const requiresNotes = reason === "otro";
  const canSubmit = !!reason && !(requiresNotes && !notes.trim());

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Rechazo por destinatario"
      description={`${name} rechazó el envío`}
    >
      <p className="text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-2">
        Motivo del rechazo
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {REJECTED_REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onReasonChange(r.id)}
              className={`h-14 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-colors flex flex-col items-center justify-center gap-0.5 px-2 ${
                active
                  ? "border-amber-500 bg-amber-50 text-amber-900"
                  : "dark:border-gray-700 border-slate-200 bg-transparent dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-lg leading-none">{r.emoji}</span>
              <span className="text-xs leading-tight text-center">{r.label}</span>
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
        Notas {requiresNotes ? "(obligatorio)" : "(opcional)"}
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder={requiresNotes ? "Describí el motivo" : "Detalle adicional para el supervisor"}
        rows={2}
        className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-[3px] focus:ring-amber-500/20 focus:border-amber-500 resize-none driver-input"
      />

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="h-12 rounded-xl border dark:border-gray-700 border-slate-200 bg-transparent dark:hover:bg-gray-700 hover:bg-slate-50 dark:text-gray-300 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!canSubmit || submitting || speedBlocked}
          className="h-12 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar rechazo"}
        </button>
      </div>
      {speedBlocked && (
        <div className="mt-2.5 text-center">
          <p className="text-xs font-semibold text-amber-600">{blockMessage}</p>
          {needsLocation && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onRequestLocation(); }}
                disabled={locationRequesting}
                className="mt-1.5 text-xs font-bold text-[var(--brand)] underline cursor-pointer disabled:opacity-50"
              >
                {locationRequesting ? "Solicitando…" : "Activar ubicación"}
              </button>
              {locationErrorMsg && (
                <p className="mt-1 text-[11px] text-red-500 px-2">{locationErrorMsg}</p>
              )}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}


function RouteCompletedView({ data, today }: { data: DriverRouteResponse; today: string }) {
  const navigate = useNavigate();
  const done = data.shipments.filter((s) => s.status === "delivered").length;
  const failed = data.shipments.filter((s) => s.status === "delivery_failed").length;

  const [tripId, setTripId] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);

  // Always try to find an active trip — vehicle may still be en_transito even if all delivered.
  useEffect(() => {
    interBranchTripsApi.getMyTrip()
      .then((trip) => {
        if (trip.status === "en_transito") {
          setTripId(trip.id);
          return interBranchTripsApi.getQR(trip.id).then((qr) => setQrBase64(qr.qr_code_base64));
        }
      })
      .catch(() => {})
      .finally(() => setQrLoading(false));
  }, []);

  const tripActive = qrLoading || tripId !== null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-12">
      <div className="flex items-start gap-3 mb-5 pb-4 border-b dark:border-gray-700 border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-[var(--sidebar-bg)]/8 text-[var(--sidebar-bg)] flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold dark:text-gray-100 text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
          <p className="mt-1 text-sm dark:text-gray-400 text-slate-500">{today}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white p-5 mb-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider opacity-90">Ruta finalizada</p>
            <p className="mt-1 text-xl font-bold leading-tight">
              {done} {done === 1 ? "entrega completada" : "entregas completadas"}
            </p>
            {failed > 0 && (
              <p className="text-xs opacity-90 mt-0.5">
                {failed} {failed === 1 ? "envío sin entregar" : "envíos sin entregar"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* QR de retorno — siempre que el viaje siga en_transito */}
      {tripActive && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-5">
          <p className="text-sm font-bold text-amber-900 mb-1">Mostrá este código al operador</p>
          <p className="text-xs text-amber-700 mb-4">
            {failed > 0
              ? `Al regresar a la sucursal, el operador escanea este ID para registrar el estado final de los ${failed} ${failed === 1 ? "envío pendiente" : "envíos pendientes"} y liberar el vehículo.`
              : "Al regresar a la sucursal, el operador escanea este ID para liberar el vehículo."
            }
          </p>
          {qrLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            qrBase64 && (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={`data:image/png;base64,${qrBase64}`}
                  alt="QR de retorno"
                  className="w-48 h-48 rounded-xl border border-amber-200"
                />
                {tripId && (
                  <p className="text-xs font-mono text-amber-800 bg-amber-100 px-3 py-1.5 rounded-lg">
                    {tripId}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Sin viaje activo: el operador ya recibió, el chofer puede empezar otro reparto */}
      {!tripActive && (
        <div className="rounded-2xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800/50 bg-slate-50 p-5 flex flex-col items-center gap-3 text-center mb-5">
          <div className="w-12 h-12 rounded-xl bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] flex items-center justify-center">
            <Truck className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold dark:text-gray-100 text-slate-900">¿Empezás otro reparto?</p>
          <p className="text-xs dark:text-gray-400 text-slate-500">Escaneá el QR del vehículo o ingresá la patente para continuar.</p>
          <button
            onClick={() => navigate("/driver/scan")}
            className="h-10 px-6 rounded-xl bg-[var(--sidebar-bg)] hover:bg-[#15294a] text-white text-sm font-bold cursor-pointer transition-colors"
          >
            Escanear vehículo
          </button>
        </div>
      )}

      <p className="text-xs font-bold dark:text-gray-400 text-slate-500 uppercase tracking-wider mb-2 px-1">
        Resumen del día
      </p>
      <div className="grid gap-2">
        {data.shipments.map((shipment) => {
          const { name } = recipientView(shipment);
          const delivered = shipment.status === "delivered";
          const rejected = shipment.status === "delivery_failed" && shipment.rejected_by_recipient;
          return (
            <Card
              key={shipment.tracking_id}
              onClick={() => navigate(`/shipments/${shipment.tracking_id}`)}
              className="px-4 py-3 cursor-pointer dark:hover:bg-gray-700 hover:bg-slate-50 transition-colors flex items-center gap-3"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                delivered
                  ? "bg-emerald-100 text-emerald-700"
                  : rejected
                  ? "bg-amber-100 text-amber-700"
                  : "bg-rose-100 text-rose-700"
              }`}>
                {delivered ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : rejected ? (
                  <Ban className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 truncate">{name}</p>
                <code className="text-[10px] font-mono dark:text-gray-500 text-slate-400">{shipment.tracking_id}</code>
                {rejected && (
                  <p className="text-[10px] text-amber-600 font-medium">Rechazado por destinatario</p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RouteSkeleton() {
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-start gap-3 mb-5 pb-4 border-b dark:border-gray-700 border-slate-200">
        <div className="w-10 h-10 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
        <div className="flex-1">
          <div className="h-5 w-32 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
          <div className="mt-2 h-3 w-48 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
        </div>
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/5 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                <div className="h-3 w-4/5 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                <div className="flex gap-2 mt-3">
                  <div className="h-6 w-16 rounded-full dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                  <div className="h-6 w-20 rounded-full dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
