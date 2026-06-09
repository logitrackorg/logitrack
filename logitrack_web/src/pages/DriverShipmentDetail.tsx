import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle, AlertTriangle, Ban, CheckCircle2, ChevronDown,
  Clock, MapPin, MessageCircle, Package, Phone, User, XCircle,
} from "lucide-react";
import { shipmentApi, type Shipment } from "../api/shipments";
import { driverApi, type DriverRoute as DriverRouteType } from "../api/driver";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { Button } from "../components/ui/button";
import { DriverShell } from "../components/DriverShell";
import { DeliverSheet } from "../components/driver/DeliverSheet";
import { FailedSheet } from "../components/driver/FailedSheet";
import { RejectedSheet } from "../components/driver/RejectedSheet";
import { useCurrentSpeed } from "../hooks/useCurrentSpeed";
import { useGeolocation } from "../hooks/useGeolocation";
import { waHrefWithText } from "../utils/driverActions";
import {
  FAILED_REASONS, REJECTED_REASONS,
  TIME_WINDOW_HOURS, TIME_WINDOW_LABEL,
  recipientView, timeWindowTone,
} from "../utils/driverActions";

const PACKAGE_LABELS: Record<string, string> = { envelope: "Sobre", box: "Caja" };
const DELIVERY_METHOD_LABEL: Record<string, string> = {
  ultima_milla: "Última milla", retiro_sucursal: "Retiro en sucursal",
};

export function DriverShipmentDetail() {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
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
  const [senderExpanded, setSenderExpanded] = useState(false);

  const { speedKmh: gpsSpeedKmh, locationReady, requestLocation } = useCurrentSpeed();
  const [simActive] = useState(false);
  const routePoints = useMemo(() => [], []);
  const { mode: simulationMode } = useGeolocation(routePoints, simActive ? "simulate" : undefined);
  const simulationActive = simulationMode === "simulate";
  const effectiveSpeed = simulationActive ? 0 : gpsSpeedKmh;
  const speedSource: "simulation" | "real_gps" = simulationActive ? "simulation" : "real_gps";
  const movingTooFast = effectiveSpeed > 5;
  const locationMissing = !simulationActive && !locationReady;
  const deliveryBlocked = movingTooFast || locationMissing;
  const blockMessage = movingTooFast
    ? "Detenga el vehículo para entregar"
    : locationMissing ? "Ubicación requerida. Active el GPS y deténgase para entregar" : "";

  const reload = (id: string) =>
    Promise.all([
      shipmentApi.get(id).then(setShipment),
      driverApi.getRoute().then((d) => setRoute(d.route)).catch(() => setRoute(null)),
    ]);

  useEffect(() => {
    if (!trackingId) return;
    setLoading(true);
    reload(trackingId).catch(() => setError("Envío no encontrado.")).finally(() => setLoading(false));
  }, [trackingId]);

  const handleDeliver = async () => {
    if (!shipment || !recipientDni.trim()) return;
    const isLastMile = shipment.delivery_method === "ultima_milla";
    if (isLastMile) {
      const locked = (shipment.keyword_attempts ?? 0) >= 3;
      if (useContingency) { if (!recipientDni.trim()) return; }
      else { if (locked || !deliveryKeyword.trim()) return; }
    }
    setSubmitting(true); setActionError("");
    try {
      if (isLastMile) {
        await shipmentApi.deliver(shipment.tracking_id, { keyword: useContingency ? undefined : deliveryKeyword.trim(), recipient_dni: useContingency ? recipientDni.trim() : undefined, contingency: useContingency, current_speed: effectiveSpeed, speed_source: speedSource });
      } else {
        await shipmentApi.updateStatus(shipment.tracking_id, { status: "delivered", location: "", recipient_dni: recipientDni.trim(), current_speed: effectiveSpeed, speed_source: speedSource });
      }
      setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false);
      await reload(shipment.tracking_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (msg?.includes("intento") || msg?.includes("bloqueado")) { setDeliveryKeyword(""); const u = await shipmentApi.get(shipment.tracking_id).catch(() => null); if (u) setShipment(u); }
      setActionError(msg ?? "No se pudo registrar la entrega.");
    } finally { setSubmitting(false); }
  };

  const handleFailed = async () => {
    if (!shipment) return;
    const reasonLabel = FAILED_REASONS.find((r) => r.id === failedReason)?.label ?? "";
    const note = [reasonLabel, failedNotes.trim()].filter(Boolean).join(" — ");
    if (!note) return;
    setSubmitting(true); setActionError("");
    try {
      await shipmentApi.updateStatus(shipment.tracking_id, { status: "delivery_failed", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource });
      setFailedOpen(false); setFailedReason(""); setFailedNotes("");
      await reload(shipment.tracking_id);
    } catch (err: unknown) {
      setActionError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo registrar el intento fallido.");
    } finally { setSubmitting(false); }
  };

  const handleRejected = async () => {
    if (!shipment) return;
    const r = REJECTED_REASONS.find((x) => x.id === rejectedReason);
    if (!r) return;
    if (r.id === "otro" && !rejectedNotes.trim()) return;
    const note = r.id === "otro" ? rejectedNotes.trim() : `${r.label}${rejectedNotes.trim() ? ` — ${rejectedNotes.trim()}` : ""}`;
    setSubmitting(true); setActionError("");
    try {
      await shipmentApi.updateStatus(shipment.tracking_id, { status: "rechazado", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource });
      setRejectedOpen(false); setRejectedReason(""); setRejectedNotes("");
      await reload(shipment.tracking_id);
    } catch (err: unknown) {
      setActionError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo registrar el rechazo.");
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <DriverShell title="Detalle de envío">
        <div className="px-4 py-4 space-y-4">
          <div className="flex justify-center"><div className="h-7 w-28 rounded-full bg-[var(--bg-muted)] animate-pulse" /></div>
          <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 space-y-3">
            <div className="h-7 w-3/5 rounded bg-[var(--bg-muted)] animate-pulse" />
            <div className="h-5 w-4/5 rounded bg-[var(--bg-muted)] animate-pulse" />
            <div className="h-5 w-32 rounded bg-[var(--bg-muted)] animate-pulse" />
            <div className="flex gap-2">
              <div className="h-6 w-20 rounded-full bg-[var(--bg-muted)] animate-pulse" />
              <div className="h-6 w-16 rounded-full bg-[var(--bg-muted)] animate-pulse" />
              <div className="h-6 w-24 rounded-full bg-[var(--bg-muted)] animate-pulse" />
            </div>
          </div>
        </div>
      </DriverShell>
    );
  }

  if (error || !shipment) {
    return (
      <DriverShell title="Detalle de envío">
        <div className="px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/driver/route")} className="flex items-center gap-2 h-12 text-base font-semibold text-[var(--text-primary)]">
            <ChevronDown className="w-5 h-5 rotate-90" /> Mi ruta
          </Button>
          <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-6 text-center text-sm text-[var(--danger-text)] mt-2">
            {error || "No encontrado."}
          </div>
        </div>
      </DriverShell>
    );
  }

  const { name, phone, street, city, province, postal, fullAddress, specialInstructions } = recipientView(shipment);
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
  const deliveryMethod = shipment.delivery_method ?? "ultima_milla";
  const statusOverride = shipmentStatusLabelOverride(shipment);

  return (
    <DriverShell title="Detalle de envío">
      <div className="px-4 py-4 space-y-4">
        {/* Action error */}
        {actionError && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError("")} className="text-xs font-semibold opacity-80 hover:opacity-100 shrink-0">Cerrar</button>
          </div>
        )}

        {/* Status badge centered */}
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold border bg-[var(--brand-tint)] text-[var(--brand)] border-[var(--brand-tint-border)]">
            {statusOverride ?? shipment.status}
          </span>
        </div>

        {/* Recipient card */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4">
          <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight">{name}</h2>

          <div className="mt-2 flex items-start gap-2">
            <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-1" />
            <p className="text-base text-[var(--text-primary)]">{fullAddress}</p>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Phone className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
            <span className="text-base text-[var(--text-primary)]">{phone}</span>
          </div>

          <a
            href={waHrefWithText(phone, `Hola ${name}, soy de LogiTrack.`) }
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-[var(--border)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors no-underline"
          >
            <MessageCircle size={16} className="text-emerald-500" />
            Enviar WhatsApp
          </a>

          {/* Chips row */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3 h-3" />{TIME_WINDOW_LABEL[tw] ?? tw}{TIME_WINDOW_HOURS[tw] && ` · ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-strong)] border-[var(--border)]">
              <Package className="w-3 h-3" />{weightKg} kg
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-strong)] border-[var(--border)]">
              {PACKAGE_LABELS[packageType] ?? packageType}
            </span>
            {fragile && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40">
                <AlertTriangle className="w-3 h-3" />Frágil
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-strong)] border-[var(--border)]">
              {DELIVERY_METHOD_LABEL[deliveryMethod] ?? deliveryMethod}
            </span>
            {attempts > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40">
                Reintento {attempts + 1}
              </span>
            )}
          </div>
        </div>

        {/* Special instructions */}
        {specialInstructions && (
          <div className="rounded-xl border-2 border-[var(--warn-border)] bg-[var(--warn-bg)] p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[var(--warn)] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--warn-text)] mb-1">Instrucciones especiales</p>
              <p className="text-sm text-[var(--warn-text)] leading-relaxed">{specialInstructions}</p>
            </div>
          </div>
        )}

        {/* Route not started */}
        {!routeStarted && isOutForDelivery && (
          <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-xs text-center text-[var(--info-text)]">
            Iniciá tu ruta desde "Mi ruta" para habilitar las acciones de entrega.
          </div>
        )}

        {/* Sender — collapsible */}
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setSenderExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer bg-transparent border-0 transition-colors"
          >
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Remitente: {senderName}
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${senderExpanded ? "rotate-180" : ""}`} />
          </button>
          {senderExpanded && (
            <div className="px-4 pb-3 pt-1 border-t border-[var(--border)] bg-[var(--bg-subtle)]">
              <p className="text-sm text-[var(--text-primary)]">{senderName}</p>
              {senderPhone && <p className="text-xs text-[var(--text-secondary)] mt-1">{senderPhone}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Sticky CTAs */}
      {canAct && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="flex flex-col gap-2 max-w-sm mx-auto">
            <Button onClick={() => setDeliverOpen(true)} className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-base font-bold gap-2">
              <CheckCircle2 className="w-5 h-5" />Entregar
            </Button>
            <Button variant="destructive" onClick={() => setFailedOpen(true)} className="h-12 rounded-xl bg-red-500 hover:bg-red-600 text-white text-base font-bold gap-2">
              <XCircle className="w-5 h-5" />No entregado
            </Button>
            <Button onClick={() => setRejectedOpen(true)} className="h-12 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-base font-bold gap-2">
              <Ban className="w-5 h-5" />Rechazado por destinatario
            </Button>
          </div>
        </div>
      )}

      <DeliverSheet open={deliverOpen} onClose={() => { setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false); }} shipment={shipment} keyword={deliveryKeyword} onKeywordChange={setDeliveryKeyword} useContingency={useContingency} onUseContingency={setUseContingency} dni={recipientDni} onDniChange={setRecipientDni} submitting={submitting} onConfirm={handleDeliver} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} error={actionError} />
      <FailedSheet open={failedOpen} onClose={() => { setFailedOpen(false); setFailedReason(""); setFailedNotes(""); }} shipment={shipment} reason={failedReason} onReasonChange={setFailedReason} notes={failedNotes} onNotesChange={setFailedNotes} submitting={submitting} onConfirm={handleFailed} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} />
      <RejectedSheet open={rejectedOpen} onClose={() => { setRejectedOpen(false); setRejectedReason(""); setRejectedNotes(""); }} shipment={shipment} reason={rejectedReason} onReasonChange={setRejectedReason} notes={rejectedNotes} onNotesChange={setRejectedNotes} submitting={submitting} onConfirm={handleRejected} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} />
    </DriverShell>
  );
}
