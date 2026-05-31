import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock,
  MapPin,
  Package,
  Truck,
  XCircle,
} from "lucide-react";
import { driverApi, type DriverRouteResponse, type TouchEventPayload } from "../api/driver";
import { interBranchTripsApi } from "../api/interBranchTrips";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { shipmentApi, type Shipment } from "../api/shipments";
import { Card } from "../components/ui/card";
import { MapView } from "../components/ui/MapView";
import { NextStopCard } from "../components/ui/NextStopCard";
import { ZoneAlert } from "../components/ui/ZoneAlert";
import { BottomSheet } from "../components/ui/bottom-sheet";
import { WhatsAppQuickButton } from "../components/ui/WhatsAppQuickButton";
import { useGeolocation } from "../hooks/useGeolocation";
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
  const [failedReason, setFailedReason] = useState<string>("");
  const [failedNotes, setFailedNotes] = useState("");
  const [rejectedReason, setRejectedReason] = useState<string>("");
  const [rejectedNotes, setRejectedNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [tab, setTab] = useState<Tab>("pendientes");

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
    if (!deliverShipment || !recipientDni.trim()) return;
    setSubmitting(true);
    setActionError("");
    try {
      await shipmentApi.updateStatus(deliverShipment.tracking_id, {
        status: "delivered",
        location: "",
        recipient_dni: recipientDni.trim(),
      });
      closeSheets();
      await checkReTestGate();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
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
    try {
      await shipmentApi.updateStatus(rejectedShipment.tracking_id, {
        status: "delivery_failed",
        location: "",
        notes: note,
        rejected_by_recipient: true,
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
    <div className="pb-32">
      {/* Header sticky con progreso y tabs */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="px-4 sm:px-6 max-w-2xl mx-auto pt-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center shrink-0">
                <Truck className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-900 leading-tight tracking-tight">Mi ruta</h1>
                <p className="text-[11px] text-slate-500 leading-tight">
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
                    ? 'bg-[#1e3a5f] text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                    }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  Lista
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${viewMode === 'map'
                    ? 'bg-[#1e3a5f] text-white'
                    : 'text-slate-500 hover:bg-slate-100'
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
                🎬
              </button>
            )}

            <RouteStatusPill status={routeStatus} />
          </div>

          <div className="mt-3">
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-500"
                style={{ width: `${progressPct}%` }}
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
            <ZoneAlert zones={activeDangerZones} />
          </>
        ) : (
          <>
            {visibleList.length === 0 ? (
              <Card className="p-8 text-center">
                {tab === "pendientes" ? (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-900">¡Todo listo por ahora!</p>
                    <p className="mt-1 text-xs text-slate-500">No quedan entregas pendientes.</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Aún no completaste ninguna entrega.</p>
                )}
              </Card>
            ) : (
              <div className="grid gap-3">
                {visibleList.map((shipment, idx) => (
                  <ShipmentCard
                    key={shipment.tracking_id}
                    shipment={shipment}
                    order={tab === "pendientes" ? idx + 1 : undefined}
                    canAct={canAct && tab === "pendientes"}
                    getMisfires={() => misfireRef.current}
                    onDeliver={() => setDeliverShipment(shipment)}
                    onFailed={() => setFailedShipment(shipment)}
                    onRejected={() => setRejectedShipment(shipment)}
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
        onClose={() => { setDeliverShipment(null); setRecipientDni(""); }}
        shipment={deliverShipment}
        dni={recipientDni}
        onDniChange={setRecipientDni}
        submitting={submitting}
        onConfirm={handleDeliver}
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
      />
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
      className={`relative h-10 px-4 text-sm font-semibold cursor-pointer transition-colors ${active ? "text-[#2563eb]" : "text-slate-500 hover:text-slate-700"
        }`}
    >
      {children}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full bg-[#2563eb]" />
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
          ? "p-0 bg-slate-50/60 dark:bg-slate-800/30 border-slate-200"
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
            <div className="shrink-0 w-9 h-9 rounded-xl bg-[#1e3a5f] text-white text-sm font-bold flex items-center justify-center">
              {String(order).padStart(2, "0")}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className={`text-base font-bold leading-snug ${isCompleted ? "text-slate-600" : "text-slate-900"}`}>
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
            <p className={`mt-1 text-sm leading-snug flex items-start gap-1.5 ${isCompleted ? "text-slate-500" : "text-slate-700"}`}>
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
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
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border bg-slate-50 text-slate-700 border-slate-200">
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
        <div className="px-4 pb-4 border-t border-slate-100">
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

          <p className="mt-3 text-[10px] font-mono text-slate-400 text-center">{shipment.tracking_id}</p>
        </div>
      )}

      {isCompleted && (
        <button
          type="button"
          onClick={onOpen}
          className="w-full px-4 pb-3 -mt-1 text-left cursor-pointer"
        >
          <p className="text-[10px] font-mono text-slate-400">{shipment.tracking_id}</p>
        </button>
      )}
    </Card>
  );
}

function DeliverSheet({
  open,
  onClose,
  shipment,
  dni,
  onDniChange,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  dni: string;
  onDniChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!shipment) return null;
  const { name } = recipientView(shipment);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Confirmar entrega"
      description={`Entrega a ${name}`}
    >
      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
        DNI del destinatario
      </label>
      <input
        ref={inputRef}
        value={dni}
        onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Ej: 30123456"
        className="w-full h-12 px-4 rounded-xl text-base focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500 driver-input"
      />
      <p className="mt-1.5 text-[11px] text-slate-500">
        Solo dígitos. Debe coincidir con el DNI registrado al crear el envío.
      </p>

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="h-12 rounded-xl border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!dni.trim() || submitting}
          className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar entrega"}
        </button>
      </div>
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
      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
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
                : "border-slate-200 bg-transparent text-slate-700 hover:bg-slate-50"
                }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
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
          className="h-12 rounded-xl border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!canSubmit || submitting}
          className="h-12 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar"}
        </button>
      </div>
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
      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
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
                  : "border-slate-200 bg-transparent text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-lg leading-none">{r.emoji}</span>
              <span className="text-xs leading-tight text-center">{r.label}</span>
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
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
          className="h-12 rounded-xl border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!canSubmit || submitting}
          className="h-12 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar rechazo"}
        </button>
      </div>
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
      <div className="flex items-start gap-3 mb-5 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
          <p className="mt-1 text-sm text-slate-500">{today}</p>
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
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 flex flex-col items-center gap-3 text-center mb-5">
          <div className="w-12 h-12 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center">
            <Truck className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-900">¿Empezás otro reparto?</p>
          <p className="text-xs text-slate-500">Escaneá el QR del vehículo o ingresá la patente para continuar.</p>
          <button
            onClick={() => navigate("/driver/scan")}
            className="h-10 px-6 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-bold cursor-pointer transition-colors"
          >
            Escanear vehículo
          </button>
        </div>
      )}

      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
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
              className="px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-3"
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
                <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                <code className="text-[10px] font-mono text-slate-400">{shipment.tracking_id}</code>
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
      <div className="flex items-start gap-3 mb-5 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-slate-100 animate-pulse" />
        <div className="flex-1">
          <div className="h-5 w-32 rounded bg-slate-100 animate-pulse" />
          <div className="mt-2 h-3 w-48 rounded bg-slate-100 animate-pulse" />
        </div>
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/5 rounded bg-slate-100 animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-slate-100 animate-pulse" />
                <div className="flex gap-2 mt-3">
                  <div className="h-6 w-16 rounded-full bg-slate-100 animate-pulse" />
                  <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
