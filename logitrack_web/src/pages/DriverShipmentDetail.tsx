import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle, AlertTriangle, Ban, CheckCircle2, ChevronLeft,
  Clock, MapPin, MessageCircle, WifiOff, XCircle,
} from "lucide-react";
import { compare as bcryptCompare } from "bcryptjs";
import { shipmentApi, type Shipment } from "../api/shipments";
import { driverApi, type DriverRoute as DriverRouteType, type DriverRouteResponse } from "../api/driver";
import { useAuth } from "../context/AuthContext";
import { useOffline } from "../offline/useOffline";
import {
  getCachedRoute,
  enqueueAction,
  getKeywordAttempts,
  incrementKeywordAttempts,
} from "../offline/db";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { GEOFENCE_RADIUS_M, distanceMeters } from "../utils/geo";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "../components/ui/button";

import { DeliveryActionSheet } from "../components/driver/DeliveryActionSheet";
import { CameraCapture } from "../components/ui/CameraCapture";
import { useCurrentSpeed } from "../hooks/useCurrentSpeed";
import { useGeolocation } from "../hooks/useGeolocation";
import {
  FAILED_REASONS, REJECTED_REASONS,
  TIME_WINDOW_HOURS, TIME_WINDOW_LABEL,
  WA_QUICK_MESSAGES, waHrefWithText,
  recipientView, timeWindowTone,
} from "../utils/driverActions";

const PACKAGE_LABELS: Record<string, string> = { envelope: "Sobre", box: "Caja" };

export function DriverShipmentDetail() {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOnline = useOffline();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [route, setRoute] = useState<DriverRouteType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [recipientDni, setRecipientDni] = useState("");
  const [deliveryKeyword, setDeliveryKeyword] = useState("");
  const [useContingency, setUseContingency] = useState(false);
  const [failedReason, setFailedReason] = useState("");
  const [failedNotes, setFailedNotes] = useState("");
  const [rejectedReason, setRejectedReason] = useState("");
  const [rejectedNotes, setRejectedNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deliveryPhoto, setDeliveryPhoto] = useState<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Aviso de geofence: el chofer está a > GEOFENCE_RADIUS_M del domicilio.
  const [geoWarning, setGeoWarning] = useState<{ distanceM: number; onConfirm: () => void } | null>(null);
  // Intentos fallidos de palabra clave validados localmente (offline).
  const [offlineKeywordAttempts, setOfflineKeywordAttempts] = useState(0);
  // Popover de mensajes rápidos de WhatsApp.
  const [waOpen, setWaOpen] = useState(false);
  const waRef = useRef<HTMLDivElement>(null);

  const { speedKmh: gpsSpeedKmh, locationReady, requestLocation } = useCurrentSpeed();
  const [simActive] = useState(false);
  const routePoints = useMemo(() => [], []);
  const { mode: simulationMode, position } = useGeolocation(routePoints, simActive ? "simulate" : undefined);
  const simulationActive = simulationMode === "simulate";
  const effectiveSpeed = simulationActive ? 0 : gpsSpeedKmh;
  const speedSource: "simulation" | "real_gps" = simulationActive ? "simulation" : "real_gps";
  const movingTooFast = effectiveSpeed > 5;
  const locationMissing = !simulationActive && !locationReady;
  const deliveryBlocked = movingTooFast || locationMissing;
  const blockMessage = movingTooFast
    ? "Detenga el vehículo para entregar"
    : locationMissing ? "Ubicación requerida. Active el GPS y deténgase para entregar" : "";

  // Carga el detalle del envío + estado de la ruta, con fallback a la cache
  // offline (IndexedDB) cuando no hay conexión:
  //  · GET /shipments/:id NO incluye keyword_hash (json:"-"); solo viene en
  //    GET /driver/route. Por eso completamos el hash desde la ruta cacheada,
  //    para poder validar la palabra clave localmente aunque el detalle se haya
  //    abierto online.
  //  · Si el fetch del envío falla (sin conexión), servimos el envío cacheado de
  //    la ruta del día. Misma estrategia para el estado de la ruta.
  const reload = async (id: string) => {
    const cached = user
      ? ((await getCachedRoute(user.id).catch(() => null)) as DriverRouteResponse | null)
      : null;
    const cachedShipment = cached?.shipments?.find((s) => s.tracking_id === id) ?? null;

    await driverApi
      .getRoute()
      .then((d) => setRoute(d.route))
      .catch(() => setRoute(cached?.route ?? null));

    try {
      const s = await shipmentApi.get(id);
      const merged = !s.keyword_hash && cachedShipment?.keyword_hash
        ? { ...s, keyword_hash: cachedShipment.keyword_hash }
        : s;
      setShipment(merged);
    } catch (err) {
      if (cachedShipment) { setShipment(cachedShipment); return; }
      throw err;
    }
  };

  useEffect(() => { if (trackingId) { setLoading(true); reload(trackingId).catch(() => setError("Envío no encontrado.")).finally(() => setLoading(false)); } }, [trackingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cierra el popover de WhatsApp al tocar fuera.
  useEffect(() => {
    if (!waOpen) return;
    const onDocPointer = (e: MouseEvent | TouchEvent) => {
      if (waRef.current && !waRef.current.contains(e.target as Node)) setWaOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("touchstart", onDocPointer);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("touchstart", onDocPointer);
    };
  }, [waOpen]);

  // Al abrir la hoja de entrega, sembrar los intentos offline persistidos.
  useEffect(() => {
    if (!deliverOpen || !shipment) return;
    setOfflineKeywordAttempts(0);
    getKeywordAttempts(shipment.tracking_id).then(setOfflineKeywordAttempts).catch(() => {});
  }, [deliverOpen, shipment?.tracking_id]);

  const handleDeliver = async () => {
    if (!shipment) return;
    const isLastMile = shipment.delivery_method === "ultima_milla";
    if (isLastMile) {
      const serverLocked = (shipment.keyword_attempts ?? 0) >= 3;
      if (useContingency) { if (!recipientDni.trim()) return; }
      else { if (serverLocked || !deliveryKeyword.trim()) return; }
      if (!deliveryPhoto) return;
    } else {
      if (!recipientDni.trim()) return;
    }

    // ── Path offline ────────────────────────────────────────────────────────
    if (!isOnline) {
      // El retiro en sucursal (updateStatus + DNI) no está soportado offline.
      if (!isLastMile) { setActionError("La entrega en sucursal requiere conexión."); return; }
      setSubmitting(true);
      if (!useContingency) {
        const offlineAttempts = await getKeywordAttempts(shipment.tracking_id);
        if (offlineAttempts >= 3) {
          setActionError("Palabra clave bloqueada (sin conexión). Usá el DNI como alternativa.");
          setSubmitting(false); return;
        }
        const hash = shipment.keyword_hash;
        if (!hash) {
          const newCount = await incrementKeywordAttempts(shipment.tracking_id);
          setOfflineKeywordAttempts(newCount);
          setDeliveryKeyword("");
          setActionError(newCount >= 3
            ? "Sin conexión y sin datos de verificación local. Intentos agotados. Usá el DNI como alternativa."
            : `Sin conexión y sin datos de verificación local. Intento ${newCount}/3. Usá el DNI como alternativa.`);
          setSubmitting(false); return;
        }
        const valid = await bcryptCompare(deliveryKeyword.trim().toUpperCase(), hash);
        if (!valid) {
          const newCount = await incrementKeywordAttempts(shipment.tracking_id);
          setOfflineKeywordAttempts(newCount);
          setDeliveryKeyword("");
          setActionError(newCount >= 3
            ? "Palabra clave incorrecta. Intentos agotados. Usá el DNI como alternativa."
            : `Palabra clave incorrecta. Intento ${newCount}/3.`);
          setSubmitting(false); return;
        }
      }
      await enqueueAction({
        type: "deliver",
        trackingId: shipment.tracking_id,
        payload: {
          keyword: useContingency ? undefined : deliveryKeyword.trim(),
          recipient_dni: useContingency ? recipientDni.trim() : undefined,
          contingency: useContingency || undefined,
          current_speed: effectiveSpeed,
          speed_source: speedSource,
          latitude: position?.lat,
          longitude: position?.lng,
        },
        photoBlob: deliveryPhoto ?? undefined,
        enqueuedAt: new Date().getTime(),
      });
      setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false); setDeliveryPhoto(null);
      setSubmitting(false);
      navigate("/driver/route");
      return;
    }

    // ── Path online ───────────────────────────────────────────────────────────
    setSubmitting(true); setActionError("");
    try {
      if (isLastMile) {
        await shipmentApi.deliver(shipment.tracking_id, { keyword: useContingency ? undefined : deliveryKeyword.trim(), recipient_dni: useContingency ? recipientDni.trim() : undefined, contingency: useContingency, current_speed: effectiveSpeed, speed_source: speedSource, photo: deliveryPhoto! });
      }
      else await shipmentApi.updateStatus(shipment.tracking_id, { status: "delivered", location: "", recipient_dni: recipientDni.trim(), current_speed: effectiveSpeed, speed_source: speedSource });
      setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false); setDeliveryPhoto(null);
      await reload(shipment.tracking_id);
    } catch (err: unknown) { const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error; if (msg?.includes("intento") || msg?.includes("bloqueado")) { setDeliveryKeyword(""); const u = await shipmentApi.get(shipment.tracking_id).catch(() => null); if (u) setShipment(u); } setActionError(msg ?? "No se pudo registrar la entrega."); } finally { setSubmitting(false); }
  };

  const handleFailed = async () => {
    if (!shipment) return;
    const reasonLabel = FAILED_REASONS.find((r) => r.id === failedReason)?.label ?? "";
    const note = [reasonLabel, failedNotes.trim()].filter(Boolean).join(" — ");
    if (!note) return;
    setSubmitting(true); setActionError("");

    if (!isOnline) {
      await enqueueAction({
        type: "delivery_failed",
        trackingId: shipment.tracking_id,
        payload: { status: "delivery_failed", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource, latitude: position?.lat, longitude: position?.lng },
        enqueuedAt: new Date().getTime(),
      });
      setFailedOpen(false); setFailedReason(""); setFailedNotes("");
      setSubmitting(false);
      navigate("/driver/route");
      return;
    }

    try { await shipmentApi.updateStatus(shipment.tracking_id, { status: "delivery_failed", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource }); setFailedOpen(false); setFailedReason(""); setFailedNotes(""); await reload(shipment.tracking_id); }
    catch (err: unknown) { setActionError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo registrar el intento fallido."); } finally { setSubmitting(false); }
  };

  const handleRejected = async () => {
    if (!shipment) return;
    const r = REJECTED_REASONS.find((x) => x.id === rejectedReason); if (!r) return;
    if (r.id === "otro" && !rejectedNotes.trim()) return;
    const note = r.id === "otro" ? rejectedNotes.trim() : `${r.label}${rejectedNotes.trim() ? ` — ${rejectedNotes.trim()}` : ""}`;
    setSubmitting(true); setActionError("");

    if (!isOnline) {
      await enqueueAction({
        type: "rejected",
        trackingId: shipment.tracking_id,
        payload: { status: "rechazado", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource, latitude: position?.lat, longitude: position?.lng },
        enqueuedAt: new Date().getTime(),
      });
      setRejectedOpen(false); setRejectedReason(""); setRejectedNotes("");
      setSubmitting(false);
      navigate("/driver/route");
      return;
    }

    try { await shipmentApi.updateStatus(shipment.tracking_id, { status: "rechazado", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource }); setRejectedOpen(false); setRejectedReason(""); setRejectedNotes(""); await reload(shipment.tracking_id); }
    catch (err: unknown) { setActionError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo registrar el rechazo."); } finally { setSubmitting(false); }
  };

  // Distancia (m) del chofer al domicilio del destinatario, o null si falta GPS o coords.
  const checkGeofence = (): number | null => {
    const addr = shipment?.recipient?.address;
    if (!position || addr?.latitude == null || addr?.longitude == null) return null;
    return distanceMeters(position.lat, position.lng, addr.latitude, addr.longitude);
  };

  // Ejecuta `proceed`, o muestra primero el aviso de geofence si el chofer está
  // fuera del radio (continúa solo si confirma). Igual que en DriverRoute.
  const withGeofence = (proceed: () => void) => {
    const d = checkGeofence();
    if (d !== null && d > GEOFENCE_RADIUS_M) {
      setGeoWarning({ distanceM: d, onConfirm: () => { setGeoWarning(null); proceed(); } });
    } else {
      proceed();
    }
  };

  if (loading) {
    return (
      <div className="px-4 pt-2 pb-[200px] space-y-3">
        <div className="h-8 w-24 rounded bg-[var(--bg-muted)] animate-pulse mx-auto" />
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 space-y-3">
          <div className="h-7 w-3/5 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="h-5 w-4/5 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="h-5 w-32 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="flex gap-2"><div className="h-6 w-16 rounded-full bg-[var(--bg-muted)] animate-pulse" /><div className="h-6 w-20 rounded-full bg-[var(--bg-muted)] animate-pulse" /></div>
        </div>
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-3">
          <div className="h-4 w-48 rounded bg-[var(--bg-muted)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div className="px-4 pt-2">
        <Button variant="ghost" onClick={() => navigate("/driver/route")} className="flex items-center gap-2 min-h-[44px] px-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <ChevronLeft className="w-5 h-5" /> Mi ruta
        </Button>
        <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-6 text-center text-sm text-[var(--danger-text)] mt-2">{error || "No encontrado."}</div>
      </div>
    );
  }

  const { name, phone, fullAddress, specialInstructions } = recipientView(shipment);
  const cor = shipment.corrections ?? {};
  const tw = (cor.time_window ?? shipment.time_window) as typeof shipment.time_window;
  const twTone = timeWindowTone(tw);
  const fragile = !!shipment.is_fragile;
  const attempts = shipment.delivery_attempts ?? 0;
  const isOutForDelivery = shipment.status === "out_for_delivery";
  const routeStarted = route?.status === "en_curso";
  const canAct = isOutForDelivery && routeStarted;
  const packageType = cor.package_type ?? shipment.package_type;
  const weightKg = cor.weight_kg ?? String(shipment.weight_kg);
  const senderName = cor.sender_name ?? shipment.sender.name;
  const senderPhone = cor.sender_phone ?? shipment.sender.phone;
  const statusOverride = shipmentStatusLabelOverride(shipment);

  const fmtPhone = (raw: string) => {
    const d = raw.replace(/\D/g, "");
    if (d.length === 10) return `${d.slice(0,4)}-${d.slice(4)}`;
    if (d.length >= 11) return `${d.slice(0,2)} ${d.slice(2,6)}-${d.slice(6)}`;
    return raw;
  };

  return (
    <>
    <div className="px-4 py-4 space-y-3 pb-[190px]">
      {/* Back + status row */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/driver/route")} className="flex items-center gap-1.5 min-h-[44px] px-2 -ml-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <ChevronLeft className="w-5 h-5" /> Mi ruta
        </Button>
        <StatusBadge status={shipment.status} label={statusOverride} />
      </div>

      {/* Tracking ID */}
      <p className="text-[11px] text-[var(--text-muted)] text-center font-mono tracking-tight">{shipment.tracking_id}</p>

      {/* Banner offline */}
      {!isOnline && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700 text-white text-xs font-semibold">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          Sin conexión — las acciones se guardan localmente y se sincronizan al volver la señal.
        </div>
      )}

      {/* Error */}
      {actionError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionError("")} className="shrink-0 opacity-80 hover:opacity-100">Cerrar</Button>
        </div>
      )}

      {/* Recipient card */}
      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
        <div className="p-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{name}</h2>
          <div className="flex items-start gap-1.5 mt-1.5">
            <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" />
            <p className="text-[13px] text-[var(--text-secondary)]">{fullAddress}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]">
              {weightKg} kg
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]">
              {PACKAGE_LABELS[packageType] ?? packageType}
            </span>
            {fragile && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40">
                <AlertTriangle className="w-3.5 h-3.5" />Frágil
              </span>
            )}
            {tw && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3.5 h-3.5" />{TIME_WINDOW_LABEL[tw] ?? tw}{TIME_WINDOW_HOURS[tw] && ` · ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            {attempts > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40">
                Reintento {attempts + 1}
              </span>
            )}
          </div>
        </div>
        <div className="border-t border-[var(--border)] px-3 py-2 flex items-center gap-1.5">
          <p className="text-[11px] text-[var(--text-muted)] truncate">
            Remitente: {senderName}{senderPhone ? ` · ${fmtPhone(senderPhone)}` : ""}
          </p>
        </div>
        <div className="border-t border-[var(--border)] relative" ref={waRef}>
          <button
            type="button"
            onClick={() => setWaOpen((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 h-11 text-[13px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-all cursor-pointer"
          >
            <MessageCircle size={15} className="text-emerald-500 dark:text-emerald-400" />WhatsApp
          </button>
          {waOpen && (
            <div className="absolute z-30 left-0 right-0 bottom-full mb-1 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-lg overflow-hidden">
              {WA_QUICK_MESSAGES.map((m) => (
                <a
                  key={m.id}
                  href={waHrefWithText(phone, m.build(name, shipment.tracking_id))}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setWaOpen(false)}
                  className="block px-4 py-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] border-b border-[var(--border)] last:border-b-0 no-underline"
                >
                  {m.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Route not started */}
      {!routeStarted && isOutForDelivery && (
        <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2.5 text-xs text-center text-[var(--warn-text)]">
          Iniciá tu ruta para habilitar las acciones de entrega.
        </div>
      )}

      {/* Special instructions */}
      {specialInstructions && (
        <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3 flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-[var(--warn)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--warn-text)] mb-1">Instrucciones especiales</p>
            <p className="text-[13px] text-[var(--warn-text)]">{specialInstructions}</p>
          </div>
        </div>
      )}
    </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(blob) => {
            setDeliveryPhoto(blob);
            setCameraOpen(false);
            setDeliverOpen(true);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

    {/* Sticky CTAs */}
    {canAct && (
      <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
        <div className="flex flex-col gap-2 max-w-2xl mx-auto">
          <Button onClick={() => withGeofence(() => { if (shipment.delivery_method === "ultima_milla") { setCameraOpen(true); } else { setDeliverOpen(true); } })} className="h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-base font-bold gap-2">
            <CheckCircle2 className="w-5 h-5" />Entregar
          </Button>
          <div className="flex gap-2">
          <Button onClick={() => withGeofence(() => setFailedOpen(true))} className="flex-1 h-11 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold gap-1.5">
            <XCircle className="w-4 h-4" />No entregado
          </Button>
          <Button onClick={() => withGeofence(() => setRejectedOpen(true))} className="flex-1 h-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold gap-1.5">
              <Ban className="w-4 h-4" />Rechazado
            </Button>
          </div>
        </div>
      </div>
    )}

    <DeliveryActionSheet mode="deliver" open={deliverOpen} onClose={() => { setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false); }} shipment={shipment} keyword={deliveryKeyword} onKeywordChange={setDeliveryKeyword} useContingency={useContingency} onUseContingency={setUseContingency} dni={recipientDni} onDniChange={setRecipientDni} submitting={submitting} onConfirm={handleDeliver} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} error={actionError} offlineKeywordAttempts={offlineKeywordAttempts} />
    <DeliveryActionSheet mode="failed" open={failedOpen} onClose={() => { setFailedOpen(false); setFailedReason(""); setFailedNotes(""); }} shipment={shipment} reason={failedReason} onReasonChange={setFailedReason} notes={failedNotes} onNotesChange={setFailedNotes} submitting={submitting} onConfirm={handleFailed} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} error={actionError} />
    <DeliveryActionSheet mode="rejected" open={rejectedOpen} onClose={() => { setRejectedOpen(false); setRejectedReason(""); setRejectedNotes(""); }} shipment={shipment} reason={rejectedReason} onReasonChange={setRejectedReason} notes={rejectedNotes} onNotesChange={setRejectedNotes} submitting={submitting} onConfirm={handleRejected} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} error={actionError} />

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
            <Button variant="outline" onClick={() => setGeoWarning(null)} className="flex-1 py-2.5 rounded-xl">
              Cancelar
            </Button>
            <Button variant="accent" onClick={geoWarning.onConfirm} className="flex-1 py-2.5 rounded-xl">
              Confirmar igual
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
