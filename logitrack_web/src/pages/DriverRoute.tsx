import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Film,
  MapPin,
  Navigation,
  Package,
  Play,
  QrCode,
  RefreshCw,
  Truck,
  Weight,
  WifiOff,
  X,
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
  type QueuedAction,
} from "../offline/db";
import { syncQueue } from "../offline/sync";
import { DeliveryActionSheet } from "../components/driver/DeliveryActionSheet";

import { driverApi, type DriverRouteResponse } from "../api/driver";
import { interBranchTripsApi, type InterBranchTrip, type TripQRResponse } from "../api/interBranchTrips";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { shipmentApi, type Shipment } from "../api/shipments";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { CameraCapture } from "../components/ui/CameraCapture";
import { MapView } from "../components/ui/MapView";
import { NextStopCard } from "../components/ui/NextStopCard";
import { ZoneAlert } from "../components/ui/ZoneAlert";
import { useGeolocation } from "../hooks/useGeolocation";
import { useCurrentSpeed } from "../hooks/useCurrentSpeed";
import { useMisfireTracking } from "../hooks/useMisfireTracking";
import { useMidRouteFatigue } from "../hooks/useMidRouteFatigue";
import { zoneApi, type Zone } from "../api/zones";
import { isInDangerZone } from "../utils/pointInPolygon";
import { publicTrackingApi } from "../api/publicTracking";
import type { Branch } from "../api/branches";
import { haversineKm, cityAbbrev } from "../utils/geo";
import { fmtDate, fmtDateTime } from "../utils/date";
import { driverDebug } from "../utils/driverDebug";
import {
  FAILED_REASONS,
  REJECTED_REASONS,
  TIME_WINDOW_HOURS,
  TIME_WINDOW_LABEL,
  recipientView,
  timeWindowTone,
} from "../utils/driverActions";

type Tab = "pendientes" | "completados";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapsUrl(lat: number, lng: number, label: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(label)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// ── Main component: gate by driver_type ──────────────────────────────────────

export function DriverRoute() {
  const { user } = useAuth();
  if (user?.driver_type === "intersucursal") {
    return <InterBranchTripView />;
  }
  return <LastMileView />;
}

// ── LastMileView ─────────────────────────────────────────────────────────────

function LastMileView() {
  const navigate = useNavigate();
  const location = useLocation();
  // State pasado desde DriverScanVehicle tras un claim/start exitoso:
  //   - route: la ruta ya pre-fetcheada (render inmediato, sin race).
  //   - fromClaim: marca que venimos de un claim → si no hay data, reintentar el
  //     fetch (cubre el read-after-write race). Si NO viene de claim (apertura en
  //     frío o refresh), ante un 404 bounceamos al instante sin reintentar.
  const navState = location.state as { fromClaim?: boolean; route?: DriverRouteResponse } | null;
  const { user } = useAuth();
  const isOnline = useOffline();
  // trackingIds de acciones encoladas localmente, pendientes de sincronizar.
  // Se siembra desde IndexedDB en cada montaje (sobrevive cierres de app).
  const [pendingSyncIds, setPendingSyncIds] = useState<Set<string>>(new Set());
  // Resultado optimista de cada acción encolada (entrega / fallo / rechazo). Necesario
  // para que el resumen del día muestre el ícono correcto mientras la acción no se
  // sincronizó: offline el shipment sigue en out_for_delivery, así que sin esto un
  // envío entregado se pintaría como fallido.
  const [pendingSyncTypes, setPendingSyncTypes] = useState<Map<string, QueuedAction["type"]>>(new Map());
  const [syncing, setSyncing] = useState(false);

  // BUG-43: velocidad GPS real del chofer (sin fallback permisivo). El valor
  // efectivo y la fuente se computan más abajo, una vez conocido el estado del
  // simulador (ver simulationActive / effectiveSpeed).
  const { speedKmh: gpsSpeedKmh, locationReady, requestLocation } = useCurrentSpeed();

  const [data, setData] = useState<DriverRouteResponse | null>(navState?.route ?? null);
  const [loading, setLoading] = useState(!navState?.route);
  const [noRoute, setNoRoute] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);

  // Gate de re-test en ruta: true = mostrar KssCheckIn antes de actualizar la lista.
  const {
    showGate: midRouteCheckin,
    misfireCount: checkinMisfires,
    requiresSleepData,
    triggerGate,
    closeGate: closeMidRouteGate,
  } = useMidRouteFatigue();

  // sheets
  const [deliverShipment, setDeliverShipment] = useState<Shipment | null>(null);
  const [failedShipment, setFailedShipment] = useState<Shipment | null>(null);
  const [rejectedShipment, setRejectedShipment] = useState<Shipment | null>(null);
  const [recipientDni, setRecipientDni] = useState("");
  const [deliveryKeyword, setDeliveryKeyword] = useState("");
  const [deliveryPhoto, setDeliveryPhoto] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | undefined>();
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
  const [isDangerDismissed, setIsDangerDismissed] = useState(false);

  const { getMisfires, resetMisfires, triggerCheckin, closeCheckin } =
    useMisfireTracking();

  useEffect(() => {
    if (!deliveryPhoto) { setPhotoPreviewUrl(undefined); return; }
    const url = URL.createObjectURL(deliveryPhoto);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [deliveryPhoto]);

  const load = () =>
    driverApi
      .getRoute()
      .then((d) => {
        driverDebug("load_getroute_ok", {
          driverId: user?.id,
          shipments: d.shipments?.length ?? 0,
          waypoints: d.waypoints?.length ?? 0,
          routeStatus: d.route?.status,
        });
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
        if (status === 404) {
          driverDebug("load_getroute_404_bounce", { driverId: user?.id, status });
          setNoRoute(true);
          return;
        }
        if (user) {
          const cached = await getCachedRoute(user.id).catch(() => null);
          if (cached) {
            driverDebug("load_getroute_err_served_cache", { driverId: user?.id, status });
            setData(cached as typeof data);
            setNoRoute(false);
            return;
          }
        }
        driverDebug("load_getroute_err_no_cache_bounce", { driverId: user?.id, status });
        setNoRoute(true);
      })
      .finally(() => setLoading(false));

  // En producción puede haber un fallo transitorio inmediatamente después de que
  // el chofer reclamó el vehículo o inició la ruta. En ese caso reintentamos una
  // vez antes de redirigir a scan, para evitar el bounce-back post gate de fatiga.
  // El reintento delega en load(), que ante un fallo de red sirve la ruta cacheada
  // (clave para abrir la app sin conexión) antes de marcar noRoute.
  const loadWithRetry = (retriesLeft = 3) => {
    setLoading(true);
    driverApi
      .getRoute()
      .then((d) => {
        driverDebug("loadretry_getroute_ok", {
          driverId: user?.id,
          shipments: d.shipments?.length ?? 0,
          waypoints: d.waypoints?.length ?? 0,
          routeStatus: d.route?.status,
        });
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
        const status = err?.response?.status;
        // Un 404 inmediatamente después de reclamar el vehículo NO es definitivo:
        // hay un read-after-write race, el backend tarda ~100-300ms en dejar la
        // ruta visible tras el claim. Reintentar unas pocas veces antes de rebotar
        // a /driver/scan — si no, expulsamos al chofer de una ruta que sí existe
        // (la pantalla scan solo consulta al montar, así que no se recupera sola).
        if (status === 404) {
          if (retriesLeft > 0) {
            driverDebug("loadretry_404_retry", { driverId: user?.id, retriesLeft });
            setTimeout(() => { loadWithRetry(retriesLeft - 1); }, 1200);
            return;
          }
          driverDebug("loadretry_404_definitive_bounce", { driverId: user?.id, status });
          setNoRoute(true);
          setLoading(false);
          return;
        }
        driverDebug("loadretry_transient_retry", { driverId: user?.id, status });
        setTimeout(() => { load(); }, 2000);
      });
  };

  useEffect(() => {
    if (navState?.route) {
      // La ruta llegó con la navegación desde el claim: render inmediato. Solo
      // cacheamos y pre-fetcheamos la geometría en segundo plano; no hacemos fetch.
      driverDebug("load_from_navstate", {
        driverId: user?.id,
        shipments: navState.route.shipments?.length ?? 0,
      });
      if (user) {
        cacheRoute(user.id, navState.route).catch(() => {});
        if (navState.route.waypoints && navState.route.waypoints.length >= 2) {
          prefetchRouteGeometry(user.id, navState.route.waypoints, navState.route.origin ?? undefined).catch(() => {});
        }
      }
      return;
    }
    if (navState?.fromClaim) {
      // Venimos de un claim pero la ruta aún no es visible (race): reintentar.
      loadWithRetry();
      return;
    }
    // Apertura en frío / refresh: si no hay ruta, bounce inmediato (sin skeleton
    // prolongado). load() ya hace exactamente eso ante un 404, y sirve cache offline
    // ante errores de red.
    load();
  }, []);
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
        setPendingSyncTypes((prev) => {
          const next = new Map(prev);
          actions.forEach((a) => next.set(a.trackingId, a.type));
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
        setPendingSyncTypes((prev) => {
          const next = new Map(prev);
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

  const checkReTestGate = async () => {
    const misfires = getMisfires();
    resetMisfires();
    const triggered = await triggerGate(misfires);
    if (triggered) {
      triggerCheckin(misfires);
      pause();
      return;
    }
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
        enqueuedAt: new Date().getTime(),
      });
      setPendingSyncIds((prev) => new Set(prev).add(deliverShipment.tracking_id));
      setPendingSyncTypes((prev) => new Map(prev).set(deliverShipment.tracking_id, "deliver"));
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
        enqueuedAt: new Date().getTime(),
      });
      setPendingSyncIds((prev) => new Set(prev).add(failedShipment.tracking_id));
      setPendingSyncTypes((prev) => new Map(prev).set(failedShipment.tracking_id, "delivery_failed"));
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
    const reasonLabel = reasonEntry ? reasonEntry.label : rejectedReason;
    const note = [reasonLabel, rejectedNotes.trim()].filter(Boolean).join(" — ");

    setSubmitting(true);
    setActionError("");
    const coords = driverCoords();

    if (!isOnline) {
      await enqueueAction({
        type: "rejected",
        trackingId: rejectedShipment.tracking_id,
        payload: { status: "delivery_failed", location: "", notes: note, rejected_by_recipient: true, current_speed: effectiveSpeed, speed_source: speedSource, latitude: coords?.lat, longitude: coords?.lng },
        enqueuedAt: new Date().getTime(),
      });
      setPendingSyncIds((prev) => new Set(prev).add(rejectedShipment.tracking_id));
      setPendingSyncTypes((prev) => new Map(prev).set(rejectedShipment.tracking_id, "rejected"));
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
  //
  // Solo se limpia con conexión Y sin acciones encoladas pendientes: offline, las
  // entregas viven en el actionQueue y la ruta solo existe en routeCache. Si lo
  // borráramos al completar la ruta offline, el siguiente remonte/recarga haría
  // getRoute → falla de red → sin cache → noRoute → bounce a /driver/scan, perdiendo
  // la pantalla de ruta completa sin posibilidad de recuperarla sin conexión. El
  // cache se limpia recién cuando la cola se drena al reconectar (pendingSyncIds=0).
  useEffect(() => {
    if (routeEffectivelyDone && user && isOnline && pendingSyncIds.size === 0) {
      clearDayCache(user.id).catch(() => {});
    }
  }, [routeEffectivelyDone, user?.id, isOnline, pendingSyncIds.size]);

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
          closeMidRouteGate();
          closeCheckin();
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
  const today = fmtDate(new Date().toISOString());

  if (routeEffectivelyDone) {
    return <RouteCompletedView data={data} today={today} pendingSyncIds={pendingSyncIds} pendingSyncTypes={pendingSyncTypes} />;
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

  const activeDangerZones = userLocation
    ? zones.filter((z) => z.active && isInDangerZone(userLocation.lat, userLocation.lng, [z]))
    : [];

  return (
    <div className="pb-16">
      {/* Banner offline */}
      {(!isOnline || syncing) && (
        <div className={`sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-40 -mx-4 md:-mx-6 flex items-center justify-between gap-2 px-4 py-2 text-xs font-semibold ${syncing ? "bg-amber-400 text-amber-900" : "bg-slate-700 text-white"}`}>
          <span className="flex items-center gap-1.5">
            {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <WifiOff className="w-3.5 h-3.5" />}
            {syncing ? "Sincronizando acciones pendientes…" : "Sin conexión — las acciones se guardan localmente"}
          </span>
          {!syncing && pendingSyncIds.size > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-white/20">{pendingSyncIds.size} pendiente{pendingSyncIds.size !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-2 px-4 max-w-2xl mx-auto pt-2">
        {/* Toggle Lista/Mapa */}
        {canAct && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] bg-[var(--sidebar-bg)] text-white` : `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-100`}>
              <Package className="w-4 h-4" /> Lista
            </button>
            <button onClick={() => setViewMode('map')} className={viewMode === 'map' ? `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] bg-[var(--sidebar-bg)] text-white` : `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-100`}>
              <MapPin className="w-4 h-4" /> Mapa
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {!simActive && simulationMode === "real" && (
            <button onClick={() => { setSimActive(true); setViewMode('map'); }} title="Activar simulación GPS" className="min-h-[44px] min-w-[44px] flex items-center justify-center opacity-30 hover:opacity-70 transition-opacity cursor-pointer select-none">
              <Film size={20} />
            </button>
          )}
          {activeDangerZones.length > 0 && (
            <span title="Zona peligrosa activa" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 text-[11px] font-bold shrink-0">
              <AlertTriangle size={12} /> Zona
            </span>
          )}
          <RouteStatusPill status={routeStatus} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 max-w-2xl mx-auto mb-3">
        <div className="h-1.5 w-full rounded-full dark:bg-gray-700/50 bg-slate-100 overflow-hidden">
          <div ref={el => { if (el) el.style.width = `${progressPct}%`; }} className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-500" />
        </div>
      </div>

      {/* Tabs */}
      {canAct && viewMode === 'list' && (
        <div className="-mx-4 px-4 flex gap-2 mt-2 mb-2 border-b dark:border-gray-700 border-slate-100 max-w-2xl mx-auto">
          <TabButton active={tab === "pendientes"} onClick={() => setTab("pendientes")}>
            Pendientes
            <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400">{pending}</span>
          </TabButton>
          <TabButton active={tab === "completados"} onClick={() => setTab("completados")}>
            Completados
            <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{done}</span>
          </TabButton>
        </div>
      )}

      {isDangerDismissed && activeDangerZones.length > 0 && (
        <div className="px-4 max-w-2xl mx-auto mb-2">
          <ZoneAlert zones={activeDangerZones} onDismissedChange={setIsDangerDismissed} />
        </div>
      )}

      <div className="px-4 sm:px-6 max-w-2xl mx-auto">
        {actionError && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm font-semibold text-[var(--danger-text)]">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <Button variant="ghost" size="sm" onClick={() => setActionError("")} className="shrink-0 min-h-[44px]">Cerrar</Button>
          </div>
        )}

        {routeStatus === "pendiente" && (
          <Card className="mb-4 border-[var(--warn-border)] bg-[var(--warn-bg)]">
            <div className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[var(--warn)] shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-[var(--warn-text)]">Ruta sin iniciar</p>
                <p className="mt-0.5 text-xs text-[var(--warn-text)] leading-relaxed">
                  Iniciá la ruta para habilitar las acciones de entrega. Una vez iniciada, no se pueden agregar nuevos envíos.
                </p>
                {data.route.suggested_start_time && (
                  <p className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--warn-bg)] border border-[var(--warn-border)] text-xs font-semibold text-[var(--warn-text)]">
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
              dangerZones={activeDangerZones}
              onRouteInfoChange={setRouteInfo}
              onWaypointClick={(trackingId) => navigate(`/driver/shipments/${trackingId}`)}
            />
            <ZoneAlert zones={activeDangerZones} onDismissedChange={setIsDangerDismissed} />
          </>
        ) : (
          <>
            {visibleList.length === 0 ? (
              <div className="py-16 text-center">
                {tab === "pendientes" ? (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <p className="text-lg font-bold dark:text-gray-100 text-slate-900">¡Todo listo por ahora!</p>
                    <p className="mt-1.5 text-sm dark:text-gray-400 text-slate-500">No quedan entregas pendientes en esta ruta.</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-gray-700/50 text-slate-400 dark:text-gray-500 flex items-center justify-center mx-auto mb-4">
                      <Package className="w-8 h-8" />
                    </div>
                    <p className="text-lg font-bold dark:text-gray-100 text-slate-900">Sin entregas aún</p>
                    <p className="mt-1.5 text-sm dark:text-gray-400 text-slate-500">Las entregas que completes aparecerán acá.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                {visibleList.map((shipment, idx) => (
                  <div key={shipment.tracking_id}>
                    <ShipmentCard
                      shipment={shipment}
                      order={tab === "pendientes" ? idx + 1 : undefined}
                      onOpen={() => navigate(`/driver/shipments/${shipment.tracking_id}`)}
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
        <div className="mt-4">
          <NextStopCard
            nextStop={nextStop}
            allPendingStops={allPendingStops}
            userLocation={userLocation ?? undefined}
            routeInfo={routeInfo}
            canAct={canAct}
            onDeliver={() => {
              if (!nextShipment) return;
              openDeliverSheet(nextShipment);
            }}
            onFailed={() => { if (nextShipment) openFailedSheet(nextShipment); }}
            onRejected={() => { if (nextShipment) openRejectedSheet(nextShipment); }}
          />
        </div>
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
      <DeliveryActionSheet
        mode="deliver"
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
        error={actionError}
        offlineKeywordAttempts={offlineKeywordAttempts}
        hasPhoto={!!deliveryPhoto}
        photoPreviewUrl={photoPreviewUrl}
        onTakePhoto={() => setCameraOpen(true)}
      />
      <DeliveryActionSheet
        mode="failed"
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
        error={actionError}
      />
      <DeliveryActionSheet
        mode="rejected"
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
        error={actionError}
      />
      {/* Modal de advertencia de geofence */}
      {geoWarning && (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-card)] shadow-2xl overflow-hidden">
            <div className="flex items-start gap-3 px-5 pt-5 pb-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--warn-bg)] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-[var(--warn)]" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-[var(--text-primary)]">Ubicación fuera de rango</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
                  Estás a <span className="font-semibold text-[var(--warn-text)]">{Math.round(geoWarning.distanceM)} m</span> del domicilio del destinatario
                  (máximo {GEOFENCE_RADIUS_M} m).
                </p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Si confirmás, se registrará un incidente en el envío para revisión del supervisor.
                </p>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <Button
                variant="outline"
                onClick={() => setGeoWarning(null)}
                className="flex-1 py-2.5 rounded-xl"
              >
                Cancelar
              </Button>
              <Button
                variant="accent"
                onClick={geoWarning.onConfirm}
                className="flex-1 py-2.5 rounded-xl"
              >
                Confirmar igual
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── InterBranchTripView ──────────────────────────────────────────────────────

function InterBranchTripView() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Gate de fatiga en ruta: true = mostrar KssCheckIn bloqueando la pantalla.
  const {
    showGate: midTripCheckin,
    misfireCount: checkinMisfires,
    requiresSleepData,
    triggerGate,
    closeGate: closeMidRouteGate,
  } = useMidRouteFatigue();
  const [trip, setTrip] = useState<InterBranchTrip | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTrip, setNoTrip] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [unavailablePickups, setUnavailablePickups] = useState<Set<string>>(new Set());

  // Bloqueo automático de pantalla por alerta de fatiga (LOGITRACK-499).
  const [fatigueBlocked, setFatigueBlocked] = useState(false);
  const [fatigueUnblockedBy, setFatigueUnblockedBy] = useState<string | null>(null);
  // Gate de fatiga en ruta: true = mostrar KssCheckIn bloqueando la pantalla.
  // true si el driver aún no reportó sueño para el día logístico actual.
  // Evita disparar múltiples consultas al gate cuando el vehículo está detenido.
  const stopGateCheckedRef = useRef(false);
  // Índices de checkpoints ya procesados en esta jornada (no repetir la alerta).
  const checkpointPassedRef = useRef<Set<number>>(new Set());
  // Último current_stop_index conocido; permite detectar el avance de parada.
  const prevStopIndexRef = useRef<number | null>(null);
  // Ref estable al trip actual — usado en handleCheckinDone sin necesitar deps.
  const tripRef = useRef<typeof trip>(null);
  // Clave del evento de desbloqueo actualmente en pantalla (para persistir el ACK en sessionStorage).
  const pendingAckRef = useRef<string | null>(null);

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState<TripQRResponse | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const [confirmedBranchName, setConfirmedBranchName] = useState("");

  // Collapsible
  const [shipmentsExpanded, setShipmentsExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Mapa
  const mapRefInternal = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [mapDivMounted, setMapDivMounted] = useState(false);
  const mapRef = useCallback((node: HTMLDivElement | null) => {
    mapRefInternal.current = node;
    setMapDivMounted(node !== null);
  }, []);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Abre el gate de fatiga y consulta si el driver ya registró sueño hoy.

  // ── Simulación de ruta (modo ?gps=simulate) ────────────────────────────────
  // Los routePoints se derivan del trip y las branches. Mientras no haya datos
  // el hook recibe [] y no inicia el intervalo (ver implementación).
  const routePoints = useMemo(() => {
    if (!trip || !branches.length) return [];
    const origin = branches.find((b) => b.id === trip.origin_branch_id);
    if (!origin?.latitude) return [];
    const pts: { lat: number; lng: number }[] = [
      { lat: origin.latitude!, lng: origin.longitude! },
    ];
    const stops = trip.stops ?? [];
    stops.forEach((s) => {
      const b = branches.find((br) => br.id === s.branch_id);
      if (b?.latitude) pts.push({ lat: b.latitude!, lng: b.longitude! });
    });
    return pts;
  }, [trip, branches]);

  // Checkpoints sintéticos: punto medio entre cada par de stops de la ruta.
  // En un despliegue real estos vendrían de la API (peajes, balanzas, estaciones).
  // Cuando la posición simulada entra en 500 m de uno de estos puntos, se
  // consulta el backend y — si el check-in lleva >3h — se fuerza el re-test.
  const checkpoints = useMemo(() => {
    if (routePoints.length < 2) return [];
    const midpoints: { lat: number; lng: number }[] = [];
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      midpoints.push({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    }
    return midpoints;
  }, [routePoints]);

  const { stoppedTimeMs, position } = useGeolocation(routePoints, undefined, 80);

  useEffect(() => { tripRef.current = trip; }, [trip]);

  const load = useCallback(async () => {
    try {
      // Branches usa el endpoint público — los choferes no tienen permiso en /branches.
      const [t, br] = await Promise.all([
        interBranchTripsApi.getMyTrip(),
        publicTrackingApi.getBranches(),
      ]);
      setTrip(t);
      setBranches(br);
      setNoTrip(false);

      // Verificar estado actual de pickups de paradas completadas.
      // Solo se muestran los que están loaded o in_transit (están físicamente en el camión).
      // Los que quedaron en at_hub (no subieron) o en estado terminal se ocultan.
      const ON_VEHICLE_STATUSES = new Set(["loaded", "in_transit"]);
      const curIdx = t.current_stop_index ?? 0;
      const completedPickupIds = (t.stops ?? [])
        .slice(0, curIdx)
        .flatMap((s) => s.pickup_shipment_ids ?? []);
      if (completedPickupIds.length > 0) {
        const statuses = await Promise.allSettled(
          completedPickupIds.map((tid) => publicTrackingApi.getShipment(tid))
        );
        const notOnVehicle = new Set<string>();
        statuses.forEach((result, i) => {
          if (result.status === "fulfilled" && !ON_VEHICLE_STATUSES.has(result.value.status)) {
            notOnVehicle.add(completedPickupIds[i]);
          }
        });
        setUnavailablePickups(notOnVehicle);
      }
    } catch {
      setNoTrip(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling cuando el modal QR está abierto
  useEffect(() => {
    if (!qrOpen || !trip) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    const prevStopIdx = trip.current_stop_index ?? 0;
    const prevStatus = trip.status;

    pollingRef.current = setInterval(async () => {
      try {
        const updated = await interBranchTripsApi.getMyTrip();
        const newIdx = updated.current_stop_index ?? 0;
        const advanced = newIdx > prevStopIdx || updated.status !== prevStatus;
        if (advanced) {
          // Mostrar overlay de éxito antes de cerrar modal
          const currentStop = trip.stops?.[prevStopIdx];
          const b = branches.find((br) => br.id === currentStop?.branch_id);
          setConfirmedBranchName(b?.address.city ?? currentStop?.branch_id ?? "");
          setStopConfirmed(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          setTimeout(() => {
            setStopConfirmed(false);
            setQrOpen(false);
            setTrip(updated);
          }, 1800);
        }
      } catch { /* ignorar errores de red durante polling */ }
    }, 4000);

    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [qrOpen, trip, branches]);

  // Gate de fatiga por tiempo detenido (solo en modo simulación activa y viaje en tránsito).
  // Cuando stoppedTimeMs vuelve a 0 el ref se resetea para detectar la próxima parada larga.
  // La consulta al backend solo se dispara UNA VEZ por parada (al cruzar el umbral de 6 min).
  useEffect(() => {
    if (!trip || trip.status !== "en_transito" || midTripCheckin) return;

    if (stoppedTimeMs === 0) {
      stopGateCheckedRef.current = false; // vehículo en movimiento → resetear para próxima parada
      return;
    }
    if (stoppedTimeMs < 6 * 60 * 1000) return; // todavía bajo el umbral
    if (stopGateCheckedRef.current) return;     // ya consultamos para esta parada

    stopGateCheckedRef.current = true;
    triggerGate(0).catch(() => {});
  }, [stoppedTimeMs, trip, midTripCheckin, triggerGate]);

  // Check-in obligatorio al salir de cada parada intermedia.
  // Trigger: cuando current_stop_index avanza en tiempo real (el operador
  // escaneó el QR de recepción en la sucursal de destino).
  //
  // IMPORTANTE — NO incluir midTripCheckin en las deps:
  // El overlay no cambia `trip`, así que el efecto no re-corre mientras está
  // activo. Incluirlo causaba un loop infinito: al cerrar el overlay,
  // midTripCheckin volvía a false y el efecto re-disparaba con el ref
  // desactualizado (era early-return durante el overlay y no se actualizaba).
  useEffect(() => {
    if (!trip) return;

    // Al completar el viaje: limpiar la entrada de localStorage.
    if (trip.status === "completado") {
      localStorage.removeItem(`trip_checkin_${trip.id}`);
      prevStopIndexRef.current = null;
      return;
    }

    if (trip.status !== "en_transito") {
      prevStopIndexRef.current = null;
      return;
    }

    const curIdx = trip.current_stop_index ?? 0;

    if (prevStopIndexRef.current === null) {
      // ── Carga inicial (o re-login) ───────────────────────────────────────
      // Comparar el índice actual contra el último guardado en localStorage.
      // Si el supervisor avanzó el índice mientras el chofer estaba fuera,
      // curIdx > stored → mostrar el check-in pendiente.
      const stored = parseInt(localStorage.getItem(`trip_checkin_${trip.id}`) ?? "0", 10);
      if (curIdx > stored) {
        triggerGate(0).catch(() => {});
      }
      prevStopIndexRef.current = curIdx;
      return;
    }

    if (curIdx > prevStopIndexRef.current) {
      // El índice subió en tiempo real → nueva parada confirmada por QR.
      // Mostrar check-in antes de que el chofer salga hacia la siguiente.
      triggerGate(0).catch(() => {});
    }

    // Actualizar SIEMPRE el ref, incluso si el gate fue abierto.
    prevStopIndexRef.current = curIdx;
  }, [trip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geocercas de checkpoints (Regla 5): al entrar en 500 m de un checkpoint
  // sintético y el viaje está en tránsito, consultar elegibilidad y forzar
  // el re-test si el último check-in fue hace más de 3 horas.
  useEffect(() => {
    if (!position || !trip || trip.status !== "en_transito" || midTripCheckin) return;
    for (let idx = 0; idx < checkpoints.length; idx++) {
      if (checkpointPassedRef.current.has(idx)) continue; // ya procesado
      const distM = haversineKm(position, checkpoints[idx]) * 1000;
      if (distM <= 500) {
        checkpointPassedRef.current.add(idx); // marcar como visitado
        triggerGate(0).catch(() => {});
        break; // procesar un checkpoint por tick
      }
    }
  }, [position, trip, midTripCheckin, checkpoints, triggerGate]);

  // Mapa Leaflet
  useEffect(() => {
    if (!trip || !mapRefInternal.current || !branches.length) return;
    const origin = branches.find((b) => b.id === trip.origin_branch_id);
    if (!origin?.latitude) return;

    const stops =
      trip.stops && trip.stops.length > 0
        ? trip.stops
        : trip.destination_branch_id
          ? [{ branch_id: trip.destination_branch_id, shipment_ids: trip.shipment_ids, total_weight_kg: trip.total_weight_kg }]
          : [];

    const points: { lat: number; lng: number; branch?: Branch; label: string; completed: boolean; current: boolean }[] = [
      { lat: origin.latitude!, lng: origin.longitude!, branch: origin, label: "Origen", completed: false, current: false },
    ];
    const curIdx = trip.current_stop_index ?? 0;
    stops.forEach((s, idx) => {
      const b = branches.find((br) => br.id === s.branch_id);
      if (b?.latitude)
        points.push({
          lat: b.latitude,
          lng: b.longitude!,
          branch: b,
          label: idx === stops.length - 1 ? "Destino final" : `Parada ${idx + 1}`,
          completed: idx < curIdx,
          current: idx === curIdx && trip.status === "en_transito",
        });
    });
    if (points.length < 2) return;

    import("leaflet").then((L) => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove(): void }).remove();
        mapInstanceRef.current = null;
      }
      const map = L.map(mapRefInternal.current!, { zoomControl: false, scrollWheelZoom: false });
      mapInstanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(map);

      const icon = (bg: string, content: string) =>
        L.divIcon({
          className: "",
          html: `<div style="background:${bg};color:var(--text-on-brand,#fff);border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3)">${content}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

      points.forEach((p, i) => {
        let bg = "var(--sidebar-bg)", content = "📍";
        if (i > 0) {
          if (p.completed) { bg = "var(--ok)"; content = "✓"; }
          else if (p.current) { bg = "var(--warn)"; content = "📍"; }
          else { bg = "var(--brand)"; content = String(i); }
        }
        L.marker([p.lat, p.lng], { icon: icon(bg, content) })
          .addTo(map)
          .bindPopup(`<div style="font-family:system-ui;min-width:120px;color:var(--text-primary)"><b>${p.label}</b><br><span style="color:var(--text-secondary)">${p.branch?.name ?? ""}${p.branch?.address.city ? '<br>' + p.branch.address.city : ''}</span></div>`, { className: "driver-map-popup" });
      });

      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      // Fit to remaining route: from the last completed stop (or origin) to the end.
      // This keeps the driver focused on what's ahead after each stop is confirmed.
      const remainingLatlngs = points.slice(curIdx).map((p) => [p.lat, p.lng] as [number, number]);
      map.fitBounds(
        L.latLngBounds(remainingLatlngs.length >= 2 ? remainingLatlngs : latlngs),
        { padding: [40, 40] },
      );

      // Ruta real por carretera vía OSRM — usa legs para colorear por segmento
      const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
      fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false&geometries=geojson&steps=false&alternatives=false&annotations=false`)
        .then((r) => r.json())
        .then((data) => {
          if (data.code !== "Ok" || !data.routes?.[0]?.legs) throw new Error("no route");
          // Pedir geometría por leg individual para colorear completados vs pendientes
          const legRequests: Promise<Response>[] = [];
          for (let i = 0; i < points.length - 1; i++) {
            const from = `${points[i].lng},${points[i].lat}`;
            const to = `${points[i + 1].lng},${points[i + 1].lat}`;
            legRequests.push(fetch(`https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson`));
          }
          return Promise.all(legRequests).then((responses) =>
            Promise.all(responses.map((r) => r.json()))
          ).then((legs) => {
            legs.forEach((legData, i) => {
              if (legData.code !== "Ok" || !legData.routes?.[0]) {
                // fallback línea recta para este segmento
                L.polyline([[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]], {
              color: points[i + 1].completed ? "var(--ok)" : "var(--brand)",
                  weight: 3,
                  dashArray: points[i + 1].completed ? undefined : "8 6",
                }).addTo(map);
                return;
              }
              const coords: [number, number][] = legData.routes[0].geometry.coordinates.map(
                (c: number[]) => [c[1], c[0]] as [number, number],
              );
              L.polyline(coords, {
                color: points[i + 1].completed ? "var(--ok)" : "var(--brand)",
                weight: 3,
                opacity: 0.8,
                dashArray: points[i + 1].completed ? undefined : "8 6",
              }).addTo(map);
            });
          });
        })
        .catch(() => {
          // fallback: líneas rectas si OSRM no responde
          for (let i = 0; i < points.length - 1; i++) {
            L.polyline([[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]], {
              color: points[i + 1].completed ? "var(--ok)" : "var(--brand)",
              weight: 3,
              dashArray: points[i + 1].completed ? undefined : "8 6",
            }).addTo(map);
          }
        });
    }).catch(() => {});

    return () => {
      if (mapInstanceRef.current) { (mapInstanceRef.current as { remove(): void }).remove(); mapInstanceRef.current = null; }
    };
  }, [trip, branches, mapDivMounted]);

  // Polling de bloqueo por fatiga — cada 5 s mientras el viaje está en_transito (LOGITRACK-499).
  useEffect(() => {
    if (!trip || trip.status !== "en_transito") return;
    const poll = async () => {
      try {
        const data = await driverApi.getFatigueBlockStatus();
        const nowBlocked = data.blocked ?? false;
        setFatigueBlocked(nowBlocked);
        if (!nowBlocked && data.recently_unblocked && data.unblocked_by) {
          const ackKey = data.unblocked_at ?? "seen";
          const storedAck = sessionStorage.getItem("lt_fatigue_ack");
          pendingAckRef.current = ackKey;
          if (ackKey !== storedAck) {
            setFatigueUnblockedBy(data.unblocked_by);
          }
        }
      } catch {
        // Error de red → mantener estado actual (conservador)
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [trip]);

  const openQR = async () => {
    if (!trip) return;
    setQrOpen(true);
    if (!qrData) {
      setQrLoading(true);
      try {
        const data = await interBranchTripsApi.getQR(trip.id);
        setQrData(data);
      } catch { /* mostrar fallback */ }
      finally { setQrLoading(false); }
    }
  };

  const doStartTrip = async () => {
    if (!trip) return;
    setStarting(true);
    setError("");
    try {
      const updated = await interBranchTripsApi.startTrip(trip.id);
      setTrip(updated);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo iniciar el viaje.");
    } finally {
      setStarting(false);
    }
  };

  const handleStart = async () => {
    // El check-in del inicio del viaje (Buenos Aires) no se requiere.
    // Los check-ins se disparan en cada PARADA INTERMEDIA, no en el origen.
    await doStartTrip();
  };

  // Callback que recibe KssCheckIn al terminar (completar o saltear).
  // Persiste el índice actual en localStorage para que, si el chofer cierra
  // sesión y vuelve a entrar, el sistema sepa hasta qué parada ya hizo el test.
  const handleCheckinDone = useCallback(() => {
    closeMidRouteGate();
    const t = tripRef.current;
    if (t) {
      const curIdx = t.current_stop_index ?? 0;
      localStorage.setItem(`trip_checkin_${t.id}`, String(curIdx));
    }
  }, [closeMidRouteGate]);

  // Bloqueo por alerta de fatiga: overlay fixed encima del contenido para no
  // desmontar el mapa ni otros elementos del DOM (LOGITRACK-499).
  // Se renderiza al final del JSX como portal superpuesto.

  // Gate de fatiga: cubre la pantalla completa antes de que el chofer inicie
  // el viaje o cuando lleva más de 6 minutos detenido en ruta.
  if (midTripCheckin && user) {
    return (
      <KssCheckIn
        driverId={user.id}
        misfireCount={checkinMisfires}
        requiresSleepData={requiresSleepData}
        onDone={handleCheckinDone}
      />
    );
  }

  if (loading) return <TripSkeleton />;
  if (noTrip) return <NoTripView />;
  if (!trip) return null;

  const stops =
    trip.stops && trip.stops.length > 0
      ? trip.stops
      : trip.destination_branch_id
        ? [{ branch_id: trip.destination_branch_id, shipment_ids: trip.shipment_ids, total_weight_kg: trip.total_weight_kg, pickup_shipment_ids: [], pickup_weight_kg: 0 }]
        : [];

  const curIdx = trip.current_stop_index ?? 0;
  const origin = branches.find((b) => b.id === trip.origin_branch_id);
  const currentStop = stops[curIdx];
  const currentStopBranch = branches.find((b) => b.id === currentStop?.branch_id);

  // Distancia restante = desde la última posición conocida (origen si no completó
  // paradas, o la última parada completada) hasta la próxima parada.
  const previousLocationBranch =
    curIdx === 0
      ? origin
      : branches.find((b) => b.id === stops[curIdx - 1]?.branch_id);
  let distRemainingKm: number | null = null;
  if (previousLocationBranch?.latitude && currentStopBranch?.latitude) {
    distRemainingKm = Math.round(
      haversineKm(
        { lat: previousLocationBranch.latitude!, lng: previousLocationBranch.longitude! },
        { lat: currentStopBranch.latitude!, lng: currentStopBranch.longitude! },
      ),
    );
  }
  const etaHours = distRemainingKm !== null ? distRemainingKm / 80 : null;

  const completedStops = stops.slice(0, curIdx);
  const upcomingStops = stops.slice(curIdx + 1);

  // Pickups cargados en paradas anteriores que viajan en el camión y se
  // descargan en esta parada (o en la siguiente, si hay más hops).
  // Se excluyen los que ya tienen estado terminal (cancelado, destruido, etc.).
  const pickupsInTransit = completedStops
    .flatMap((s) => s.pickup_shipment_ids ?? [])
    .filter((tid) => !unavailablePickups.has(tid));
  const pickupsInTransitWeightKg = completedStops.reduce((sum, s) => sum + (s.pickup_weight_kg ?? 0), 0);

  const totalShipments = trip.shipment_ids.length;

  const statusMap: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    en_transito: { label: "En ruta", cls: "bg-[var(--brand-100)] text-[var(--brand-800)] dark:bg-[var(--brand-tint)] dark:text-[var(--brand)]" },
    completado: { label: "Completado", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    cancelado: { label: "Cancelado", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  };
  const st = statusMap[trip.status] ?? statusMap.pendiente;

  // ---------- Estado completado ----------
  if (trip.status === "completado") {
    return (
    <div className="flex flex-col items-center justify-center p-6 py-20">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-5">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">Viaje completado</h1>
        <p className="text-[var(--text-secondary)] text-sm mb-6 text-center">
          {stops.length} parada{stops.length !== 1 ? "s" : ""} · {totalShipments} envíos · {trip.license_plate}
        </p>
        {trip.completed_at && (
          <p className="text-xs text-[var(--text-muted)] mb-8">
            {fmtDateTime(trip.completed_at)}
          </p>
        )}
        <Button
          onClick={() => navigate("/driver/scan")}
          className="h-14 px-10 rounded-xl text-base font-bold"
        >
          Volver al inicio
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* ── HEADER ── */}
      <header className="sticky top-0 z-10 bg-[var(--bg-card)]/95 backdrop-blur border-b border-[var(--border)]">
        <div className="px-4 max-w-2xl mx-auto py-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono tracking-tight text-base font-bold text-[var(--text-primary)]">{trip.license_plate}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${st.cls}`}>
                  {st.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)] mt-0.5">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  {totalShipments} envío{totalShipments !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Weight className="w-3 h-3" />
                  {trip.total_weight_kg.toFixed(0)} kg
                </span>
                <span className="font-mono text-xs text-[var(--text-muted)] truncate">{trip.id}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 max-w-2xl mx-auto pt-4 space-y-4">
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="flex-1">{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError("")} className="shrink-0 min-h-[44px]">Cerrar</Button>
          </div>
        )}

        {/* ── PROGRESS: STEPPER HORIZONTAL ── */}
        <StepperBar
          origin={origin}
          stops={stops}
          currentStopIdx={curIdx}
          branches={branches}
          tripStatus={trip.status}
        />

        {/* ── HERO: PRÓXIMA PARADA ── */}
        {trip.status === "en_transito" && currentStop && (
          <HeroNextStop
            stop={currentStop}
            stopNumber={curIdx + 1}
            totalStops={stops.length}
            branch={currentStopBranch}
            distKm={distRemainingKm}
            etaHours={etaHours}
            pickupsInTransit={pickupsInTransit}
            pickupsInTransitWeightKg={pickupsInTransitWeightKg}
            shipmentsExpanded={shipmentsExpanded}
            onToggleShipments={() => setShipmentsExpanded((v) => !v)}
          />
        )}

        {/* ── MAPA ── */}
        {origin?.latitude != null ? (
          <Card className="overflow-hidden !p-0 border-[var(--border)]" variant="muted">
            <div ref={mapRef} className="h-48 w-full" />
          </Card>
        ) : (
          <Card className="!p-4 border-[var(--border)]" variant="muted">
            <div className="h-48 flex items-center justify-center text-sm text-[var(--text-muted)]">
              <MapPin className="w-4 h-4 mr-2" />
              Cargando mapa…
            </div>
          </Card>
        )}

        {/* ── PARADAS COMPLETADAS ── */}
        {completedStops.length > 0 && (
          <section>
            <Button variant="ghost" onClick={() => setCompletedExpanded((v) => !v)} className="w-full justify-start min-h-[44px] text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              {completedExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Paradas completadas ({completedStops.length})
            </Button>
            {completedExpanded && (
              <div className="space-y-2.5">
                {completedStops.map((s, idx) => {
                  const b = branches.find((br) => br.id === s.branch_id);
                  return (
                    <Card key={idx} className="!p-4 border-[var(--border)]" variant="muted">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-[var(--text-primary)]">{b?.name ?? s.branch_id}</p>
                          <p className="text-xs text-[var(--text-secondary)]">{b?.address.city}</p>
                        </div>
                        {s.completed_at && (
                          <p className="text-xs text-[var(--text-muted)] shrink-0">
                            {new Date(s.completed_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── PRÓXIMAS PARADAS ── */}
        {upcomingStops.length > 0 && (
          <section>
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Siguientes paradas
            </p>
            <div className="space-y-2.5">
              {upcomingStops.map((s, idx) => {
                const b = branches.find((br) => br.id === s.branch_id);
                const realIdx = curIdx + 1 + idx;
                const prevBranch = branches.find((br) => br.id === stops[realIdx - 1]?.branch_id);
                let legKm: number | null = null;
                if (prevBranch?.latitude && b?.latitude) {
                  legKm = Math.round(haversineKm(
                    { lat: prevBranch.latitude!, lng: prevBranch.longitude! },
                    { lat: b.latitude!, lng: b.longitude! },
                  ));
                }
                return (
                  <Card key={idx} className="!p-4 border-[var(--border)]" variant="muted">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--bg-muted)] dark:bg-slate-700 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-[var(--text-secondary)]">{realIdx + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[var(--text-primary)]">{b?.name ?? s.branch_id}</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {b?.address.city}{b?.address.province ? `, ${b.address.province}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0 text-xs text-[var(--text-muted)] space-y-0.5">
                        {legKm !== null && <p className="font-medium">+{legKm} km</p>}
                        <p>{s.shipment_ids.length} env.</p>
                      </div>
                    </div>
                    {(s.pickup_shipment_ids?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 ml-11">
                        <ArrowUp className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                          Cargás {s.pickup_shipment_ids?.length} envío{s.pickup_shipment_ids!.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Timestamps */}
        {trip.started_at && (
          <p className="text-xs text-[var(--text-muted)] text-center pt-2">
            Iniciado: {fmtDateTime(trip.started_at)}
          </p>
        )}
      </div>

      {/* ── CTA STICKY BOTTOM ── */}
      {trip.status === "en_transito" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto">
            <Button onClick={openQR} className="w-full h-14 rounded-xl text-white text-lg font-bold gap-2.5 shadow-lg shadow-[var(--brand)]/20">
              <QrCode className="w-5 h-5" />
              Llegué — mostrar QR al operador
            </Button>
          </div>
        </div>
      )}

      {/* Fallback para estado pendiente */}
      {trip.status === "pendiente" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[var(--warn-bg)] border border-[var(--warn-border)] text-xs text-[var(--warn-text)]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Al iniciar el viaje, los envíos pasan a estado <strong>en tránsito</strong>.</span>
            </div>
            <Button onClick={handleStart} disabled={starting} className="w-full h-14 rounded-xl text-white text-lg font-bold gap-2.5 shadow-lg">
              <Play className="w-5 h-5" />
              {starting ? "Iniciando viaje…" : "Iniciar viaje"}
            </Button>
          </div>
        </div>
      )}

      {/* ── MODAL QR FULLSCREEN ── */}
      {qrOpen && (
        <QRModal
          trip={trip}
          currentStop={currentStop}
          currentStopBranch={currentStopBranch}
          pickupsInTransit={pickupsInTransit}
          qrData={qrData}
          qrLoading={qrLoading}
          stopConfirmed={stopConfirmed}
          confirmedBranchName={confirmedBranchName}
          onClose={() => { setQrOpen(false); if (pollingRef.current) clearInterval(pollingRef.current); }}
        />
      )}

      {/* Overlay de bloqueo por fatiga — fixed encima de todo, no desmonta el mapa */}
      {fatigueBlocked && (
        <div className="fixed inset-0 z-[9999] bg-[var(--sidebar-bg)] flex flex-col items-center justify-center p-8 text-center gap-6">
          <AlertTriangle size={64} className="text-[var(--danger-c)]" />
          <h2 className="text-white text-[22px] font-bold m-0">
            Alerta de fatiga detectada
          </h2>
          <p className="text-[var(--text-muted)] text-base leading-relaxed m-0">
            Tu supervisor fue notificado.<br/>
            Esperá su indicación antes de continuar.
          </p>
        </div>
      )}

      {/* Cartelito de autorización — se muestra cuando el supervisor desbloqueó la ruta (LOGITRACK-501) */}
      {!fatigueBlocked && fatigueUnblockedBy && (
        <div className="fixed inset-0 z-[9999] bg-[var(--sidebar-bg)] flex flex-col items-center justify-center p-8 text-center gap-6">
          <CheckCircle2 size={64} className="text-[var(--ok)]" />
          <h2 className="text-white text-[22px] font-bold m-0">
            Ruta autorizada
          </h2>
          <p className="text-[var(--text-secondary)] text-base leading-relaxed m-0">
            Tu supervisor <strong className="text-white">{fatigueUnblockedBy}</strong> autorizó<br/>
            que continúes la ruta.
          </p>
          <Button onClick={() => {
            if (pendingAckRef.current) sessionStorage.setItem("lt_fatigue_ack", pendingAckRef.current);
            setFatigueUnblockedBy(null);
          }} className="mt-2 px-9 py-3 rounded-xl text-base font-bold bg-emerald-500 hover:bg-emerald-600 text-white">
            Continuar
          </Button>
        </div>
      )}
    </>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function RouteStatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-400" },
    en_curso: { label: "En curso", cls: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-400" },
    finalizada: { label: "Finalizada", cls: "bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-400" },
  };
  const c = map[status] ?? map.pendiente;
  return (
    <span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap min-h-[44px] inline-flex items-center ${c.cls}`}>
      {c.label}
    </span>
  );
}

function TabButton({
  active,
  color = "var(--brand)",
  onClick,
  children,
}: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-12 px-4 text-sm font-semibold cursor-pointer active:scale-95 transition-all duration-150 ${active ? "text-[var(--brand)]" : "dark:text-gray-400 text-slate-500 dark:hover:text-gray-200 hover:text-slate-700"
        }`}
    >
      {children}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-[3px] rounded-full" style={{ backgroundColor: color }} />
      )}
    </button>
  );
}

function ShipmentCard({
  shipment,
  order,
  onOpen,
}: {
  shipment: Shipment;
  order?: number;
  onOpen: () => void;
}) {
  const { name, fullAddress, specialInstructions } = recipientView(shipment);
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

  const statusColor = isDelivered ? "bg-emerald-500" : isFailed ? "bg-rose-500" : isRejected ? "bg-amber-500" : "";

  return (
    <Card
      className={
        isCompleted
          ? "p-0 dark:bg-gray-800/40 bg-slate-50/60 dark:border-gray-700/50 border-slate-200"
          : "p-0 hover:shadow-md transition-shadow"
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left px-3 py-3 cursor-pointer min-h-[44px]"
      >
        <div className="flex items-start gap-3">
          {order !== undefined && (
            <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--sidebar-bg)] text-white text-base font-bold flex items-center justify-center">
              {String(order).padStart(2, "0")}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isCompleted && (
                  <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${statusColor}`} />
                )}
                <p className={`text-base font-bold leading-snug truncate ${isCompleted ? "dark:text-gray-400 text-slate-500" : "dark:text-gray-100 text-slate-900"}`}>
                  {name}
                </p>
              </div>
              {isDelivered && (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/15 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Entregado
                </span>
              )}
              {isFailed && (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-500/15 px-2.5 py-1 rounded-full">
                  <XCircle className="w-3.5 h-3.5" />
                  Sin entregar
                </span>
              )}
              {isRejected && (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/15 px-2.5 py-1 rounded-full">
                  <Ban className="w-3.5 h-3.5" />
                  Rechazado
                </span>
              )}
            </div>
            <p className={`mt-1 text-base leading-snug flex items-start gap-1.5 ${isCompleted ? "dark:text-gray-400 text-slate-500" : "dark:text-gray-200 text-slate-700"}`}>
              <MapPin className="w-4 h-4 mt-1 dark:text-gray-500 text-slate-400 shrink-0" />
              <span className="break-words">{fullAddress}</span>
            </p>
          </div>
          {!isCompleted && <ChevronRight className="w-5 h-5 text-slate-300 dark:text-gray-500 mt-1.5 shrink-0" />}
        </div>

        {!isCompleted && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3.5 h-3.5" />
                {TIME_WINDOW_LABEL[tw] ?? tw}{TIME_WINDOW_HOURS[tw] && ` · ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            {fragile && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]">
                <AlertTriangle className="w-3.5 h-3.5" />
                Frágil
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border dark:bg-gray-700/50 bg-slate-50 dark:text-gray-300 text-slate-600 dark:border-gray-600 border-slate-200">
              <Package className="w-3.5 h-3.5" />
              {shipment.weight_kg} kg
            </span>
            {attempts > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30">
                Reintento {attempts + 1}
              </span>
            )}
          </div>
        )}

        {!isCompleted && specialInstructions && (
          <div className="mt-3 px-3 py-2.5 rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] text-sm text-[var(--warn-text)] flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{specialInstructions}</span>
          </div>
        )}

        <p className="mt-3 text-[11px] font-mono dark:text-gray-500 text-slate-400">
          {shipment.tracking_id}
        </p>
      </button>
    </Card>
  );
}

function RouteCompletedView({ data, today, pendingSyncIds = new Set(), pendingSyncTypes = new Map() }: { data: DriverRouteResponse; today: string; pendingSyncIds?: Set<string>; pendingSyncTypes?: Map<string, QueuedAction["type"]> }) {
  const navigate = useNavigate();
  // Resuelve el resultado efectivo de cada envío combinando el estado del backend
  // con la acción optimista encolada (offline): un envío entregado offline sigue
  // en out_for_delivery, pero su acción en cola dice "deliver".
  const outcomeOf = (s: Shipment): "delivered" | "rejected" | "failed" | "other" => {
    const t = pendingSyncTypes.get(s.tracking_id);
    if (t === "deliver" || s.status === "delivered") return "delivered";
    if (t === "rejected" || (s.status === "delivery_failed" && s.rejected_by_recipient)) return "rejected";
    if (t === "delivery_failed" || s.status === "delivery_failed") return "failed";
    return "other";
  };
  const done = data.shipments.filter((s) => outcomeOf(s) === "delivered").length;
  const failed = data.shipments.filter((s) => { const o = outcomeOf(s); return o === "failed" || o === "rejected"; }).length;

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
    <div className="px-4 py-4 max-w-2xl mx-auto pb-12">

      <div className="rounded-2xl bg-gradient-to-br from-[var(--ok)] to-emerald-600 text-white p-5 mb-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider opacity-90">Ruta finalizada</p>
            <p className="mt-1 text-xl font-bold leading-tight">
              {done} {done === 1 ? "entrega completada" : "entregas completadas"}
            </p>
            {failed > 0 && (
              <p className="text-sm opacity-90 mt-0.5">
                {failed} {failed === 1 ? "envío sin entregar" : "envíos sin entregar"}
              </p>
            )}
            <p className="text-sm opacity-80 mt-0.5">{today}</p>
          </div>
        </div>
      </div>

      {/* QR de retorno — siempre que el viaje siga en_transito */}
      {tripActive && (
        <div className="rounded-2xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-5 mb-5">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-300 mb-1">Mostrá este código al operador</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-4">
            {failed > 0
              ? `Al regresar a la sucursal, el operador escanea este ID para registrar el estado final de los ${failed} ${failed === 1 ? "envío pendiente" : "envíos pendientes"} y liberar el vehículo.`
              : "Al regresar a la sucursal, el operador escanea este ID para liberar el vehículo."
            }
          </p>
          {qrLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-8 h-8 border-3 border-amber-400 dark:border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            qrBase64 && (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={`data:image/png;base64,${qrBase64}`}
                  alt="QR de retorno"
                  className="w-48 h-48 rounded-xl border border-[var(--warn-border)]"
                />
                {tripId && (
                  <p className="text-xs font-mono text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 px-3 py-1.5 rounded-lg">
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
          <div className="w-16 h-16 rounded-xl bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] flex items-center justify-center">
            <Truck className="w-8 h-8" />
          </div>
          <p className="text-base font-bold dark:text-gray-100 text-slate-900">¿Empezás otro reparto?</p>
          <p className="text-sm dark:text-gray-400 text-slate-500">Escaneá el QR del vehículo o ingresá la patente para continuar.</p>
          <Button onClick={() => navigate("/driver/scan")} className="w-full max-w-xs mx-auto h-14 px-8 rounded-xl text-base font-bold">
            Escanear vehículo
          </Button>
        </div>
      )}

      <p className="text-xs font-bold dark:text-gray-400 text-slate-500 uppercase tracking-wider mb-3 px-1">
        Resumen del día
      </p>
      <div className="grid gap-2">
        {data.shipments.map((shipment) => {
          const { name } = recipientView(shipment);
          const outcome = outcomeOf(shipment);
          const delivered = outcome === "delivered";
          const rejected = outcome === "rejected";
          const pendingSync = pendingSyncIds.has(shipment.tracking_id);
          return (
            <Card
              key={shipment.tracking_id}
              onClick={() => navigate(`/driver/shipments/${shipment.tracking_id}`)}
              className="px-3 py-3 cursor-pointer dark:hover:bg-gray-700 hover:bg-slate-50 transition-all flex items-center gap-3"
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                delivered
                  ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : rejected
                  ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400"
              }`}>
                {delivered ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : rejected ? (
                  <Ban className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 truncate">{name}</p>
                <code className="text-[11px] font-mono dark:text-gray-500 text-slate-400">{shipment.tracking_id}</code>
                {rejected && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Rechazado por destinatario</p>
                )}
                {pendingSync && (
                  <p className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Pendiente de sincronizar</p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 dark:text-gray-500 shrink-0" />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RouteSkeleton() {
  return (
    <div className="px-4 py-4 max-w-2xl mx-auto">
      <div className="flex items-start gap-3 mb-5 pb-4 border-b dark:border-gray-700 border-slate-200">
        <div className="w-10 h-10 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
        <div className="flex-1">
          <div className="h-5 w-32 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
          <div className="mt-2 h-3 w-48 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
        </div>
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse shrink-0" />
              <div className="flex-1 space-y-2.5">
                <div className="h-4 w-3/5 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                <div className="h-4 w-4/5 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                <div className="flex gap-2 mt-3">
                  <div className="h-7 w-16 rounded-full dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                  <div className="h-7 w-20 rounded-full dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
                </div>
                <div className="mt-3 pt-3 border-t dark:border-gray-700 border-slate-100 grid gap-2">
                  <div className="h-14 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse w-full" />
                  <div className="h-14 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse w-full" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Inter-branch trip sub-components ─────────────────────────────────────────

type TripStopShape = {
  branch_id: string;
  shipment_ids: string[];
  total_weight_kg: number;
  pickup_shipment_ids?: string[];
  pickup_weight_kg?: number;
  completed_at?: string;
  completed_by_user_id?: string;
};

function StepperBar({
  origin,
  stops,
  currentStopIdx,
  branches,
  tripStatus,
}: {
  origin?: Branch;
  stops: TripStopShape[];
  currentStopIdx: number;
  branches: Branch[];
  tripStatus: string;
}) {
  const allPoints = [
    { id: origin?.id ?? "origin", city: origin?.address.city ?? "Origen", isOrigin: true },
    ...stops.map((s) => {
      const b = branches.find((br) => br.id === s.branch_id);
      return { id: s.branch_id, city: b?.address.city ?? s.branch_id, isOrigin: false };
    }),
  ];

  return (
    <Card className="!p-4 border-[var(--border)]" variant="muted">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">Progreso</p>
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {allPoints.map((pt, idx) => {
          const isOriginPt = pt.isOrigin;
          const stopIdx = idx - 1;
          const isCompleted = !isOriginPt && stopIdx < currentStopIdx;
          const isCurrent =
            !isOriginPt && stopIdx === currentStopIdx && tripStatus === "en_transito";
          const isPending = !isOriginPt && stopIdx > currentStopIdx;
          const isLast = idx === allPoints.length - 1;

          let dotCls = "bg-[var(--text-muted)]";
          let dotContent = <span className="text-xs font-bold text-white">{idx}</span>;
          if (isOriginPt) {
            dotCls = "bg-[var(--sidebar-bg)]";
            dotContent = <Truck className="w-3.5 h-3.5 text-white" />;
          } else if (isCompleted) {
            dotCls = "bg-emerald-500 dark:bg-emerald-600";
            dotContent = <CheckCircle2 className="w-3.5 h-3.5 text-white" />;
          } else if (isCurrent) {
            dotCls = "bg-sky-500 dark:bg-sky-600";
            dotContent = <MapPin className="w-3.5 h-3.5 text-white" />;
          }

          return (
            <div key={pt.id + idx} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center min-w-[52px]">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${dotCls} ${
                    isCurrent ? "ring-[3px] ring-sky-200 dark:ring-sky-500/30" : ""
                  }`}
                >
                  {dotContent}
                </div>
                <p
                  className={`text-xs font-semibold mt-1.5 text-center leading-tight ${
                    isPending
                      ? "text-[var(--text-muted)]"
                      : isCompleted
                        ? "text-emerald-600 dark:text-emerald-400"
                        : isCurrent
                          ? "text-sky-700 dark:text-sky-300"
                          : "text-[var(--text-secondary)]"
                  }`}
                >
                  {cityAbbrev(pt.city)}
                </p>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 h-[3px] mt-[16px] mx-0.5 rounded-full ${
                    isCompleted
                      ? "bg-emerald-500 dark:bg-emerald-600"
                      : isCurrent
                        ? "bg-gradient-to-r from-[var(--ok)] to-[var(--border)]"
                        : "bg-[var(--border)]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function HeroNextStop({
  stop,
  stopNumber,
  totalStops,
  branch,
  distKm,
  etaHours,
  pickupsInTransit,
  pickupsInTransitWeightKg,
  shipmentsExpanded,
  onToggleShipments,
}: {
  stop: TripStopShape;
  stopNumber: number;
  totalStops: number;
  branch?: Branch;
  distKm: number | null;
  etaHours: number | null;
  pickupsInTransit: string[];
  pickupsInTransitWeightKg: number;
  shipmentsExpanded: boolean;
  onToggleShipments: () => void;
}) {
  const hasPickup = (stop.pickup_shipment_ids?.length ?? 0) > 0;
  const allDropoffs = [...stop.shipment_ids, ...pickupsInTransit];
  const mapsLink =
    branch?.latitude && branch?.longitude
      ? mapsUrl(branch.latitude, branch.longitude, branch.name)
      : null;

  return (
    <Card className="!p-4 border-2 border-[var(--sidebar-bg)]/10 dark:border-[var(--sidebar-bg)]/20 bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-subtle)]">
      {/* Chip de parada */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] uppercase tracking-wider">
          Parada {stopNumber} de {totalStops}
        </span>
        {distKm !== null && (
          <span className="text-xs text-[var(--text-secondary)] font-medium">{distKm} km aprox.</span>
        )}
      </div>

      {/* Sucursal */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight">{branch?.name ?? stop.branch_id}</h2>
        {branch?.address && (
          <div className="flex items-center gap-1.5 mt-1 text-[var(--text-secondary)]">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <p className="text-xs leading-snug">
              {branch.address.street && `${branch.address.street}, `}
              {branch.address.city}{branch.address.province ? `, ${branch.address.province}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* ETA */}
      {etaHours !== null && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-[var(--bg-muted)] flex items-center gap-3">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">ETA estimada</span>
          <span className="ml-auto text-base font-bold text-[var(--brand)]">~{formatDuration(etaHours)}</span>
        </div>
      )}

      {/* Carga que baja / sube */}
      <div className="space-y-2 mb-5">
        <div className="flex items-center gap-2 py-2.5 text-sm">
          <ArrowDown className="w-4 h-4 text-[var(--text-muted)]" />
          <span className="text-[var(--text-primary)]">
            Bajan: <strong>{allDropoffs.length} envío{allDropoffs.length !== 1 ? "s" : ""}</strong>
          </span>
          <Weight className="w-3.5 h-3.5 text-[var(--text-muted)] ml-auto" />
          <span className="text-[var(--text-secondary)] text-xs">{(stop.total_weight_kg + pickupsInTransitWeightKg).toFixed(1)} kg</span>
        </div>
        {pickupsInTransit.length > 0 && (
          <p className="text-xs text-sky-700 dark:text-sky-400 ml-6">
            Incluye {pickupsInTransit.length} envío{pickupsInTransit.length !== 1 ? "s" : ""} cargados en parada anterior
          </p>
        )}
        {hasPickup && (
          <div className="flex items-center gap-2 py-2.5 text-sm text-amber-700 dark:text-amber-400 font-medium">
            <ArrowUp className="w-4 h-4" />
            Cargás: <strong>{stop.pickup_shipment_ids!.length} envío{stop.pickup_shipment_ids!.length !== 1 ? "s" : ""}</strong>
            <span className="ml-auto text-xs font-normal">{(stop.pickup_weight_kg ?? 0).toFixed(1)} kg</span>
          </div>
        )}
      </div>

      {/* Botones */}
      <div className="flex flex-col gap-2.5">
        {mapsLink && (
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-14 rounded-xl bg-[var(--brand)] hover:brightness-110 active:brightness-90 text-white text-lg font-bold flex items-center justify-center gap-2.5 cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2"
          >
            <Navigation className="w-5 h-5" />
            Navegar con Maps
          </a>
        )}
        <Button
          variant="outline"
          onClick={onToggleShipments}
          className="w-full h-12 rounded-xl text-sm font-semibold gap-2"
        >
          <Package className="w-4 h-4" />
          Ver lista de envíos
          {shipmentsExpanded ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
        </Button>
        {shipmentsExpanded && allDropoffs.length > 0 && (
          <div className="mt-1 rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {stop.shipment_ids.map((tid) => (
              <div key={tid} className="px-4 py-3 flex items-center gap-2 min-h-[44px]">
                <span className="text-xs font-mono text-[var(--text-primary)]">{tid}</span>
              </div>
            ))}
            {pickupsInTransit.length > 0 && (
              <>
                <div className="px-4 py-2 bg-sky-50 dark:bg-sky-950/30">
                  <p className="text-xs font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                    Bajan — Cargados en parada anterior
                  </p>
                </div>
                {pickupsInTransit.map((tid) => (
                  <div key={tid} className="px-4 py-3 flex items-center gap-2 bg-sky-50/40 dark:bg-sky-950/20 min-h-[44px]">
                    <span className="text-xs font-mono text-sky-800 dark:text-sky-300">{tid}</span>
                  </div>
                ))}
              </>
            )}
            {hasPickup && (
              <>
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                    Para cargar
                  </p>
                </div>
                {stop.pickup_shipment_ids!.map((tid) => (
                  <div key={tid} className="px-4 py-3 flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/20 min-h-[44px]">
                    <span className="text-xs font-mono text-amber-800 dark:text-amber-300">{tid}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function QRModal({
  trip,
  currentStop,
  currentStopBranch,
  pickupsInTransit,
  qrData,
  qrLoading,
  stopConfirmed,
  confirmedBranchName,
  onClose,
}: {
  trip: InterBranchTrip;
  currentStop?: TripStopShape;
  currentStopBranch?: Branch;
  pickupsInTransit: string[];
  qrData: TripQRResponse | null;
  qrLoading: boolean;
  stopConfirmed: boolean;
  confirmedBranchName: string;
  onClose: () => void;
}) {
  return (
    /* Backdrop — z-[9999] para quedar por encima de Leaflet (z ~400) y del nav */
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/70"
      onClick={onClose}
    >
      {/* Card — click dentro no cierra */}
      <div
        className="relative w-full sm:max-w-sm bg-[var(--bg-card)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle / Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)]">
              Entregando en {currentStopBranch?.name ?? currentStop?.branch_id}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">{currentStopBranch?.address.city}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--bg-muted)] hover:bg-[var(--bg-inset)] flex items-center justify-center cursor-pointer transition-all"
          >
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Cuerpo con scroll */}
        <div className="flex flex-col items-center px-6 py-5 gap-4 overflow-y-auto">
          {stopConfirmed ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-base font-bold text-[var(--text-primary)]">Recepción confirmada</p>
              <p className="text-sm text-[var(--text-secondary)]">en {confirmedBranchName}</p>
            </div>
          ) : (
            <>
              {/* QR */}
              <div className="flex flex-col items-center gap-2 w-full">
                {qrLoading ? (
                  <div className="w-56 h-56 rounded-xl bg-[var(--bg-muted)] animate-pulse" />
                ) : qrData ? (
                  <div className="p-3 bg-[var(--bg-card)] rounded-xl border-2 border-[var(--brand)]/20 shadow-md">
                    <img
                      src={`data:image/png;base64,${qrData.qr_code_base64}`}
                      alt="QR del viaje"
                      className="w-56 h-56"
                    />
                  </div>
                ) : (
                  <div className="w-56 h-56 rounded-xl border-2 border-dashed border-[var(--border)] flex items-center justify-center">
                    <p className="text-sm text-[var(--text-muted)] text-center px-4">No se pudo cargar el QR.</p>
                  </div>
                )}
                <p className="text-xs font-mono text-[var(--text-muted)]">{trip.id}</p>
              </div>

              {/* Indicador de espera */}
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <div className="w-2 h-2 rounded-full bg-sky-400 dark:bg-sky-500 animate-pulse shrink-0" />
                Esperando que el operador escanee…
              </div>

              {/* Envíos que bajan — propios + pickups de paradas anteriores */}
              {currentStop && (currentStop.shipment_ids.length > 0 || pickupsInTransit.length > 0) && (() => {
                const allBajan = [...currentStop.shipment_ids, ...pickupsInTransit];
                return (
                  <div className="w-full">
                    <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                      ↓ Bajan {allBajan.length} envío{allBajan.length !== 1 ? "s" : ""}
                    </p>
                    <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden max-h-36 overflow-y-auto">
                      {currentStop.shipment_ids.map((tid) => (
                        <div key={tid} className="px-3 py-1.5">
                          <span className="text-xs font-mono text-[var(--text-primary)]">{tid}</span>
                        </div>
                      ))}
                      {pickupsInTransit.length > 0 && (
                        <>
                          <div className="px-3 py-1 bg-sky-50 dark:bg-sky-950/30">
                            <p className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
                              Cargados en parada anterior
                            </p>
                          </div>
                          {pickupsInTransit.map((tid) => (
                            <div key={tid} className="px-3 py-1.5 bg-sky-50/30 dark:bg-sky-950/20">
                              <span className="text-xs font-mono text-sky-800 dark:text-sky-300">{tid}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NoTripView() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center p-6 py-20">
      <div className="w-24 h-24 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-6">
        <Package className="w-12 h-12 text-[var(--text-muted)]" />
      </div>
      <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">Sin viajes asignados</h1>
      <p className="text-sm text-[var(--text-secondary)] text-center max-w-xs mb-8">
        No tenés ningún viaje inter-sucursal asignado por el momento. Si el operador ya asignó tu vehículo, escaneá el QR para tomar el viaje.
      </p>
      <Button
        onClick={() => navigate("/driver/scan")}
        className="h-14 px-8 rounded-xl text-base font-bold gap-2"
      >
        <QrCode className="w-5 h-5" />
        Escanear vehículo
        </Button>
      </div>
    );
  }

function TripSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      {/* Header skeleton */}
      <div className="sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">
        <div className="px-4 max-w-2xl mx-auto py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-11 h-11 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
      </div>

      {/* Content skeleton */}
      <div className="px-4 max-w-2xl mx-auto pt-4 space-y-4">
        {/* Stepper */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <Skeleton className="h-3 w-20 mb-3" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <Skeleton className="w-8 h-8 rounded-full" />
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))}
          </div>
        </div>

        {/* Hero card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-6 w-32 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>

        {/* Map */}
        <Skeleton className="h-48 w-full rounded-xl" />

        {/* Stop cards */}
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-14 shrink-0" />
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA skeleton */}
      <div className="fixed bottom-0 inset-x-0 bg-[var(--bg-card)] border-t border-[var(--border)] px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
