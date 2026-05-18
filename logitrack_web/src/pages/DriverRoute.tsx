import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Play,
  Truck,
  XCircle,
} from "lucide-react";
import { driverApi, type DriverRouteResponse, type TouchEventPayload } from "../api/driver";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { shipmentApi, type Shipment } from "../api/shipments";
import { Card } from "../components/ui/card";
import { MapView } from "../components/ui/MapView";
import { NextStopCard } from "../components/ui/NextStopCard";
import { ZoneAlert } from "../components/ui/ZoneAlert";
import { BottomSheet } from "../components/ui/bottom-sheet";
import { useGeolocation } from "../hooks/useGeolocation";
import { zoneApi, type Zone } from "../api/zones";
import { isInDangerZone } from "../utils/pointInPolygon";
import {
  FAILED_REASONS,
  TIME_WINDOW_HOURS,
  TIME_WINDOW_LABEL,
  recipientView,
  telHref,
  timeWindowTone,
  waHref,
} from "../utils/driverActions";

type Tab = "pendientes" | "completados";

export function DriverRoute() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // La jornada arranca a las 08:00. La clave incluye driver_id + fecha de jornada
  // para que cada chofer tenga su propio registro y no colisionen en dispositivos compartidos.
  const jornadaKey = (() => {
    if (!user) return null;
    const now = new Date();
    // Si son antes de las 8am, la jornada vigente es la del día anterior
    const jornada = new Date(now);
    if (now.getHours() < 8) jornada.setDate(jornada.getDate() - 1);
    return `kss_checkin_${user.id}_${jornada.toDateString()}`;
  })();

  // null = verificando contra backend, true = hecho, false = pendiente
  const [checkInDone, setCheckInDone] = useState<boolean | null>(null);
  const [data, setData] = useState<DriverRouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRoute, setNoRoute] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);

  // sheets
  const [deliverShipment, setDeliverShipment] = useState<Shipment | null>(null);
  const [failedShipment, setFailedShipment] = useState<Shipment | null>(null);
  const [recipientDni, setRecipientDni] = useState("");
  const [failedReason, setFailedReason] = useState<string>("");
  const [failedNotes, setFailedNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [startingRoute, setStartingRoute] = useState(false);
  const [actionError, setActionError] = useState("");
  const [tab, setTab] = useState<Tab>("pendientes");

  // Verifica contra el backend si el check-in ya fue completado hoy.
  // localStorage se usa solo como cache optimista; el backend es fuente de verdad.
  // Esto garantiza que un reset de base de datos invalide el estado persistido en el browser.
  useEffect(() => {
    if (!jornadaKey) {
      setCheckInDone(true);
      return;
    }
    driverApi.getTodayCheckin()
      .then(() => {
        localStorage.setItem(jornadaKey, "done");
        setCheckInDone(true);
      })
      .catch((err: { response?: { status?: number } }) => {
        if (err?.response?.status === 404) {
          // El backend no tiene registro → limpiar cache stale y mostrar modal.
          localStorage.removeItem(jornadaKey);
          setCheckInDone(false);
        } else {
          // Error de red o 5xx → confiar en localStorage como fallback.
          setCheckInDone(localStorage.getItem(jornadaKey) === "done");
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = () =>
    driverApi
      .getRoute()
      .then((d) => { setData(d); setNoRoute(false); })
      .catch(() => setNoRoute(true))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useEffect(() => { zoneApi.list().then(setZones).catch(() => {}); }, []);

  const handleStartRoute = async () => {
    setStartingRoute(true);
    setActionError("");
    try {
      await driverApi.startRoute();
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo iniciar la ruta.");
    } finally {
      setStartingRoute(false);
    }
  };

  const closeSheets = () => {
    setDeliverShipment(null);
    setFailedShipment(null);
    setRecipientDni("");
    setFailedReason("");
    setFailedNotes("");
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
      load();
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
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo registrar el intento fallido.");
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

  const [simActive, setSimActive] = useState(false);

  const { position: userLocation, mode: simulationMode, isPaused, pause, play, reset } =
    useGeolocation(routePoints, simActive ? "simulate" : undefined, 360);

  // Mientras se verifica contra el backend, mostrar skeleton para evitar flash del modal.
  if (checkInDone === null) return <RouteSkeleton />;

  if (!checkInDone && user && jornadaKey) {
    return (
      <KssCheckIn
        driverId={user.id}
        onDone={() => {
          localStorage.setItem(jornadaKey, "done");
          setCheckInDone(true);
        }}
      />
    );
  }

  if (loading) return <RouteSkeleton />;
  if (noRoute) return <NoRouteView />;
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

  if (routeStatus === "finalizada" && done > 0) {
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
              simulationControls={{ isPaused, pause, play, reset, onExit: () => setSimActive(false) }}
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
                    onDeliver={() => setDeliverShipment(shipment)}
                    onFailed={() => setFailedShipment(shipment)}
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
          onDeliver={() => nextShipment && setDeliverShipment(nextShipment)}
          onFailed={() => nextShipment && setFailedShipment(nextShipment)}
        />
      )}

      {/* Sticky CTA para iniciar ruta */}
      {routeStatus === "pendiente" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={handleStartRoute}
              disabled={startingRoute}
              className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-base font-bold cursor-pointer disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Play className="w-5 h-5" />
              {startingRoute ? "Iniciando…" : "Iniciar ruta"}
            </button>
          </div>
        </div>
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
      className={`relative h-10 px-4 text-sm font-semibold cursor-pointer transition-colors ${active ? "text-[#1e3a5f]" : "text-slate-500 hover:text-slate-700"
        }`}
    >
      {children}
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full bg-[#1e3a5f]" />
      )}
    </button>
  );
}

function ShipmentCard({
  shipment,
  order,
  canAct,
  onDeliver,
  onFailed,
  onOpen,
}: {
  shipment: Shipment;
  order?: number;
  canAct: boolean;
  onDeliver: () => void;
  onFailed: () => void;
  onOpen: () => void;
}) {
  // US4: Tactile event tracking — refs to avoid re-renders
  const renderTimeRef = useRef<number>(Date.now());
  const misfireCountRef = useRef<number>(0);

  /** Fire async touch event to backend without blocking the UI. */
  const fireTouchEvent = (action: TouchEventPayload["action"]) => {
    driverApi.submitTouchEvent({
      tracking_id: shipment.tracking_id,
      action,
      reaction_time_ms: Date.now() - renderTimeRef.current,
      misfires: misfireCountRef.current,
    }).catch(() => {}); // silent failure — never block delivery workflow
  };

  /**
   * Detect misfires: pointer down on the action area that doesn't land on
   * either "Entregar" or "No entregado". Uses data-action attributes set
   * on the buttons themselves.
   */
  const handleActionAreaPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      !target.closest('[data-action="deliver"]') &&
      !target.closest('[data-action="failed"]')
    ) {
      misfireCountRef.current++;
    }
  };

  const handleDeliverClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fireTouchEvent("entregado");
    onDeliver();
  };

  const handleFailedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fireTouchEvent("no_entregado");
    onFailed();
  };

  const { name, phone, fullAddress, specialInstructions } = recipientView(shipment);
  const isCompleted = shipment.status === "delivered" || shipment.status === "delivery_failed";
  const isFailed = shipment.status === "delivery_failed";
  const isDelivered = shipment.status === "delivered";

  const cor = shipment.corrections ?? {};
  const tw = (cor.time_window ?? shipment.time_window) as typeof shipment.time_window;
  const twTone = timeWindowTone(tw);
  const fragile = !!shipment.is_fragile;
  const attempts = shipment.delivery_attempts ?? 0;

  return (
    <Card
      className={
        isCompleted
          ? "p-0 bg-slate-50/60 border-slate-200"
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
          <div className="grid grid-cols-2 gap-2 mt-3">
            <a
              href={telHref(phone)}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Llamar</span>
            </a>
            <a
              href={waHref(phone)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">WhatsApp</span>
            </a>
          </div>

          {canAct && (
            /* US4: onPointerDown on the action container detects misfires */
            <div
              className="grid grid-cols-2 gap-2 mt-2"
              onPointerDown={handleActionAreaPointerDown}
            >
              <button
                data-action="deliver"
                onClick={handleDeliverClick}
                className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                Entregar
              </button>
              <button
                data-action="failed"
                onClick={handleFailedClick}
                className="h-12 rounded-xl border-2 border-rose-300 bg-white hover:bg-rose-50 text-rose-700 text-sm font-bold cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <XCircle className="w-4 h-4" />
                No entregado
              </button>
            </div>
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
        className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-white text-base placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500"
      />
      <p className="mt-1.5 text-[11px] text-slate-500">
        Solo dígitos. Debe coincidir con el DNI registrado al crear el envío.
      </p>

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={onClose}
          className="h-12 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
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
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
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
        className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-rose-500/20 focus:border-rose-500 resize-y"
      />

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={onClose}
          className="h-12 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={!canSubmit || submitting}
          className="h-12 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar"}
        </button>
      </div>
    </BottomSheet>
  );
}

function NoRouteView() {
  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-start gap-3 mb-6 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
          <p className="mt-1 text-sm text-slate-500">No tenés ninguna ruta asignada para hoy.</p>
        </div>
      </div>
      <Card className="p-8 text-center">
        <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">Cuando un supervisor te asigne envíos, los vas a ver acá.</p>
      </Card>
    </div>
  );
}

function RouteCompletedView({ data, today }: { data: DriverRouteResponse; today: string }) {
  const navigate = useNavigate();
  const done = data.shipments.filter((s) => s.status === "delivered").length;
  const failed = data.shipments.filter((s) => s.status === "delivery_failed").length;

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

      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
        Resumen del día
      </p>
      <div className="grid gap-2">
        {data.shipments.map((shipment) => {
          const { name } = recipientView(shipment);
          const delivered = shipment.status === "delivered";
          return (
            <Card
              key={shipment.tracking_id}
              onClick={() => navigate(`/shipments/${shipment.tracking_id}`)}
              className="px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-3"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${delivered ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                }`}>
                {delivered ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
                <code className="text-[10px] font-mono text-slate-400">{shipment.tracking_id}</code>
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
