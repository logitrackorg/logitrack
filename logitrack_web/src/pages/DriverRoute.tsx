import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock,
  Film,
  MapPin,
  Package,
  Truck,
  XCircle,
} from "lucide-react";
import { DeliverSheet } from "../components/driver/DeliverSheet";
import { FailedSheet } from "../components/driver/FailedSheet";
import { RejectedSheet } from "../components/driver/RejectedSheet";
import { DriverShell } from "../components/DriverShell";
import { driverApi, type DriverRouteResponse } from "../api/driver";
import { interBranchTripsApi } from "../api/interBranchTrips";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { shipmentApi, type Shipment } from "../api/shipments";
import { Card } from "../components/ui/card";
import { MapView } from "../components/ui/MapView";
import { NextStopCard } from "../components/ui/NextStopCard";
import { ZoneAlert } from "../components/ui/ZoneAlert";
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

type Tab = "pendientes" | "completados";

export function DriverRoute() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // BUG-43: velocidad GPS real del chofer (sin fallback permisivo). El valor
  // efectivo y la fuente se computan más abajo, una vez conocido el estado del
  // simulador (ver simulationActive / effectiveSpeed).
  const { speedKmh: gpsSpeedKmh, locationReady, requestLocation } = useCurrentSpeed();

  const [data, setData] = useState<DriverRouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRoute, setNoRoute] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);

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
  const [useContingency, setUseContingency] = useState(false);
  const [failedReason, setFailedReason] = useState<string>("");
  const [failedNotes, setFailedNotes] = useState("");
  const [rejectedReason, setRejectedReason] = useState<string>("");
  const [rejectedNotes, setRejectedNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
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
      .then((d) => { setData(d); setNoRoute(false); })
      .catch(() => setNoRoute(true))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useEffect(() => { zoneApi.list().then(setZones).catch(() => {}); }, []);

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
      const locked = (deliverShipment.keyword_attempts ?? 0) >= 3;
      if (useContingency) {
        if (!recipientDni.trim()) return;
      } else {
        if (locked || !deliveryKeyword.trim()) return;
      }
    } else {
      if (!recipientDni.trim()) return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      if (isLastMile) {
        await shipmentApi.deliver(deliverShipment.tracking_id, {
          keyword: useContingency ? undefined : deliveryKeyword.trim(),
          recipient_dni: useContingency ? recipientDni.trim() : undefined,
          contingency: useContingency,
          current_speed: effectiveSpeed,
          speed_source: speedSource,
        });
      } else {
        await shipmentApi.updateStatus(deliverShipment.tracking_id, {
          status: "delivered",
          location: "",
          recipient_dni: recipientDni.trim(),
          current_speed: effectiveSpeed,
          speed_source: speedSource,
        });
      }
      closeSheets();
      await checkReTestGate();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      // Refresh shipment to get updated keyword_attempts from backend
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
    try {
      await shipmentApi.updateStatus(failedShipment.tracking_id, {
        status: "delivery_failed",
        location: "",
        notes: note,
        current_speed: effectiveSpeed,
        speed_source: speedSource,
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
    try {
      await shipmentApi.updateStatus(rejectedShipment.tracking_id, {
        status: "delivery_failed",
        location: "",
        notes: note,
        rejected_by_recipient: true,
        current_speed: effectiveSpeed,
        speed_source: speedSource,
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

  const pendingList = data.shipments.filter((s) => s.status === "out_for_delivery");
  const completedList = data.shipments.filter(
    (s) => s.status === "delivered" || s.status === "delivery_failed",
  );
  const total = data.shipments.length;
  const done = completedList.length;
  const pending = pendingList.length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  const routeEffectivelyDone =
    (routeStatus === "finalizada" && pending === 0) ||
    (routeStatus === "en_curso" && pending === 0 && total > 0);

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
     <DriverShell title="Mi ruta" subtitle={today}>

      {/* Toolbar: view toggle, simulator, danger badge, status pill */}
      <div className="flex items-center justify-between gap-3 mb-4 px-4 max-w-2xl mx-auto pt-3">
        {/* Toggle Lista/Mapa */}
        {canAct && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewMode('list')}
              className={viewMode === 'list' ? `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] bg-[var(--sidebar-bg)] text-white` : `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-100`}
            >
              <Package className="w-4 h-4" />
              Lista
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={viewMode === 'map' ? `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] bg-[var(--sidebar-bg)] text-white` : `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] dark:text-gray-400 text-slate-500 dark:hover:bg-gray-700 hover:bg-slate-100`}
            >
              <MapPin className="w-4 h-4" />
              Mapa
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {!simActive && simulationMode === "real" && (
            <button
              onClick={() => { setSimActive(true); setViewMode('map'); }}
              title="Activar simulación GPS"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center opacity-30 hover:opacity-70 transition-opacity cursor-pointer select-none"
            >
              <Film size={20} />
            </button>
          )}

          {/* Badge minimizado de zona peligrosa */}
          {isDangerDismissed && (
            <span
              title="Zona peligrosa activa"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-500/15 border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold shrink-0 animate-pulse"
            >
              <AlertTriangle size={14} className="mr-0.5" /> Zona
            </span>
          )}
          <RouteStatusPill status={routeStatus} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 px-4 max-w-2xl mx-auto">
        <div className="h-2 w-full rounded-full dark:bg-gray-700/50 bg-slate-100 overflow-hidden">
          <div
            ref={el => { if (el) el.style.width = `${progressPct}%`; }}
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-500"
          />
        </div>
      </div>

      {/* Stats line */}
      <p className="text-xs dark:text-gray-400 text-slate-500 mb-3 px-4 max-w-2xl mx-auto">
        {done}/{total} completados
      </p>

      {/* Tabs */}
      {canAct && viewMode === 'list' && (
        <div className="-mx-4 px-4 flex gap-1 mb-4 border-b dark:border-gray-700 border-slate-100 max-w-2xl mx-auto">
          <TabButton active={tab === "pendientes"} onClick={() => setTab("pendientes")}>
            Pendientes
            <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400">
              {pending}
            </span>
          </TabButton>
          <TabButton active={tab === "completados"} onClick={() => setTab("completados")}>
            Completados
            <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              {done}
            </span>
          </TabButton>
        </div>
      )}
      <div className="px-4 py-4 max-w-2xl mx-auto">
        {actionError && (
          <div className="flex items-start gap-3 mb-4 px-4 py-3.5 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="flex-1">{actionError}</span>
            <button
              onClick={() => setActionError("")}
              className="text-xs font-bold text-rose-700 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-200 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              Cerrar
            </button>
          </div>
        )}

        {routeStatus === "pendiente" && (
          <Card className="mb-4 border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/8">
            <div className="p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-300">Ruta sin iniciar</p>
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-400 leading-relaxed">
                  Iniciá la ruta para habilitar las acciones de entrega. Una vez iniciada, no se pueden agregar nuevos envíos.
                </p>
                {data.route.suggested_start_time && (
                  <p className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-100 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 text-xs font-semibold text-amber-900 dark:text-amber-300">
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
                  <ShipmentCard
                    key={shipment.tracking_id}
                    shipment={shipment}
                    order={tab === "pendientes" ? idx + 1 : undefined}
                    onOpen={() => navigate(`/shipments/${shipment.tracking_id}`)}
                  />
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
          onDeliver={() => { if (nextShipment) setDeliverShipment(nextShipment); }}
          onFailed={() => { if (nextShipment) setFailedShipment(nextShipment); }}
          onRejected={() => { if (nextShipment) setRejectedShipment(nextShipment); }}
        />
      )}


      {/* Bottom sheets */}
      <DeliverSheet
        open={!!deliverShipment}
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
      />
    </DriverShell>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Sub-componentes                                                      */
/* ─────────────────────────────────────────────────────────────────── */

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
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-12 px-4 text-sm font-semibold cursor-pointer transition-colors active:scale-95 transition-all duration-150 ${active ? "text-[var(--brand)]" : "dark:text-gray-400 text-slate-500 dark:hover:text-gray-200 hover:text-slate-700"
        }`}
    >
      {children}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-[3px] rounded-full bg-[var(--brand)]" />
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
          ? "p-0 dark:bg-gray-800/40 bg-slate-50/60 dark:border-gray-700/50 border-slate-200 mb-3"
          : "p-0 hover:shadow-md transition-shadow mb-3"
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
          {!isCompleted && <ChevronRight className="w-5 h-5 text-slate-300 mt-1.5 shrink-0" />}
        </div>

        {!isCompleted && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3.5 h-3.5" />
                {TIME_WINDOW_LABEL[tw] ?? tw} {TIME_WINDOW_HOURS[tw] && `· ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            {fragile && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30">
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
          <div className="mt-3 px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-900 dark:text-amber-300 flex items-start gap-2">
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
    <div className="px-4 py-4 max-w-2xl mx-auto pb-12">
      <div className="flex items-start gap-3 mb-5 pb-4 border-b dark:border-gray-700 border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-[var(--sidebar-bg)]/8 text-[var(--sidebar-bg)] flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold dark:text-gray-100 text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
          <p className="mt-1 text-sm dark:text-gray-400 text-slate-500">{today}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white p-5 mb-5 shadow-sm">
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
          </div>
        </div>
      </div>

      {/* QR de retorno — siempre que el viaje siga en_transito */}
      {tripActive && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/8 p-5 mb-5">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-300 mb-1">Mostrá este código al operador</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-4">
            {failed > 0
              ? `Al regresar a la sucursal, el operador escanea este ID para registrar el estado final de los ${failed} ${failed === 1 ? "envío pendiente" : "envíos pendientes"} y liberar el vehículo.`
              : "Al regresar a la sucursal, el operador escanea este ID para liberar el vehículo."
            }
          </p>
          {qrLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-8 h-8 border-3 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            qrBase64 && (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={`data:image/png;base64,${qrBase64}`}
                  alt="QR de retorno"
                  className="w-48 h-48 rounded-xl border border-amber-200 dark:border-amber-500/40"
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
          <button
            onClick={() => navigate("/driver/scan")}
            className="h-14 px-8 rounded-xl bg-[var(--sidebar-bg)] hover:bg-[#15294a] active:scale-95 text-white text-base font-bold cursor-pointer transition-all duration-150 w-full max-w-xs"
          >
            Escanear vehículo
          </button>
        </div>
      )}

      <p className="text-xs font-bold dark:text-gray-400 text-slate-500 uppercase tracking-wider mb-3 px-1">
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
              className="px-3 py-3 cursor-pointer dark:hover:bg-gray-700 hover:bg-slate-50 transition-colors flex items-center gap-3"
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                delivered
                  ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : rejected
                  ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400"
              }`}>
                {delivered ? (
                  <CheckCircle2 className="w-4.5 h-4.5" />
                ) : rejected ? (
                  <Ban className="w-4.5 h-4.5" />
                ) : (
                  <XCircle className="w-4.5 h-4.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 truncate">{name}</p>
                <code className="text-[11px] font-mono dark:text-gray-500 text-slate-400">{shipment.tracking_id}</code>
                {rejected && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Rechazado por destinatario</p>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
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
