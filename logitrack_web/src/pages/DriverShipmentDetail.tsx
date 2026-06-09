import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle, AlertTriangle, Ban, CheckCircle2, ChevronLeft,
  Clock, MapPin, MessageCircle, Phone, User, XCircle,
} from "lucide-react";
import { shipmentApi, type Shipment } from "../api/shipments";
import { driverApi, type DriverRoute as DriverRouteType } from "../api/driver";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "../components/ui/button";
import { DriverShell } from "../components/DriverShell";
import { DeliverSheet } from "../components/driver/DeliverSheet";
import { FailedSheet } from "../components/driver/FailedSheet";
import { RejectedSheet } from "../components/driver/RejectedSheet";
import { useCurrentSpeed } from "../hooks/useCurrentSpeed";
import { useGeolocation } from "../hooks/useGeolocation";
import { waHref } from "../utils/driverActions";
import {
  FAILED_REASONS, REJECTED_REASONS,
  TIME_WINDOW_HOURS, TIME_WINDOW_LABEL,
  recipientView, timeWindowTone,
} from "../utils/driverActions";

const PACKAGE_LABELS: Record<string, string> = { envelope: "Sobre", box: "Caja" };

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

  useEffect(() => { if (trackingId) { setLoading(true); reload(trackingId).catch(() => setError("Envío no encontrado.")).finally(() => setLoading(false)); } }, [trackingId]);

  const handleDeliver = async () => {
    if (!shipment || !recipientDni.trim()) return;
    const isLastMile = shipment.delivery_method === "ultima_milla";
    if (isLastMile) { const locked = (shipment.keyword_attempts ?? 0) >= 3; if (useContingency) { if (!recipientDni.trim()) return; } else { if (locked || !deliveryKeyword.trim()) return; } }
    setSubmitting(true); setActionError("");
    try {
      if (isLastMile) await shipmentApi.deliver(shipment.tracking_id, { keyword: useContingency ? undefined : deliveryKeyword.trim(), recipient_dni: useContingency ? recipientDni.trim() : undefined, contingency: useContingency, current_speed: effectiveSpeed, speed_source: speedSource });
      else await shipmentApi.updateStatus(shipment.tracking_id, { status: "delivered", location: "", recipient_dni: recipientDni.trim(), current_speed: effectiveSpeed, speed_source: speedSource });
      setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false);
      await reload(shipment.tracking_id);
    } catch (err: unknown) { const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error; if (msg?.includes("intento") || msg?.includes("bloqueado")) { setDeliveryKeyword(""); const u = await shipmentApi.get(shipment.tracking_id).catch(() => null); if (u) setShipment(u); } setActionError(msg ?? "No se pudo registrar la entrega."); } finally { setSubmitting(false); }
  };

  const handleFailed = async () => {
    if (!shipment) return;
    const reasonLabel = FAILED_REASONS.find((r) => r.id === failedReason)?.label ?? "";
    const note = [reasonLabel, failedNotes.trim()].filter(Boolean).join(" — ");
    if (!note) return;
    setSubmitting(true); setActionError("");
    try { await shipmentApi.updateStatus(shipment.tracking_id, { status: "delivery_failed", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource }); setFailedOpen(false); setFailedReason(""); setFailedNotes(""); await reload(shipment.tracking_id); }
    catch (err: unknown) { setActionError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo registrar el intento fallido."); } finally { setSubmitting(false); }
  };

  const handleRejected = async () => {
    if (!shipment) return;
    const r = REJECTED_REASONS.find((x) => x.id === rejectedReason); if (!r) return;
    if (r.id === "otro" && !rejectedNotes.trim()) return;
    const note = r.id === "otro" ? rejectedNotes.trim() : `${r.label}${rejectedNotes.trim() ? ` — ${rejectedNotes.trim()}` : ""}`;
    setSubmitting(true); setActionError("");
    try { await shipmentApi.updateStatus(shipment.tracking_id, { status: "rechazado", location: "", notes: note, current_speed: effectiveSpeed, speed_source: speedSource }); setRejectedOpen(false); setRejectedReason(""); setRejectedNotes(""); await reload(shipment.tracking_id); }
    catch (err: unknown) { setActionError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "No se pudo registrar el rechazo."); } finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <DriverShell title="Detalle de envío">
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
      </DriverShell>
    );
  }

  if (error || !shipment) {
    return (
      <DriverShell title="Detalle de envío">
        <div className="px-4 pt-2">
          <Button variant="ghost" onClick={() => navigate("/driver/route")} className="flex items-center gap-2 min-h-[44px] px-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ChevronLeft className="w-5 h-5" /> Mi ruta
          </Button>
          <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-6 text-center text-sm text-[var(--danger-text)] mt-2">{error || "No encontrado."}</div>
        </div>
      </DriverShell>
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

  return (
    <DriverShell title="Detalle de envío">
      <div className="px-4 pt-2 pb-[200px] space-y-4">
        {/* Back + status row */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/driver/route")} className="flex items-center gap-1.5 min-h-[44px] px-2 -ml-2 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ChevronLeft className="w-5 h-5" /> Mi ruta
          </Button>
          <StatusBadge status={shipment.status} label={statusOverride} />
        </div>

        {/* Error */}
        {actionError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError("")} className="text-xs font-semibold opacity-80 hover:opacity-100 shrink-0">Cerrar</button>
          </div>
        )}

        {/* Recipient card */}
        <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
          {/* Name + address */}
          <div className="p-4 pb-3">
            <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight">{name}</h2>
            <div className="flex items-start gap-2 mt-2">
              <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{fullAddress}</p>
            </div>
          </div>

          {/* Chips */}
          <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3 h-3" />{TIME_WINDOW_LABEL[tw] ?? tw}{TIME_WINDOW_HOURS[tw] && ` · ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]">
              {weightKg} kg
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border)]">
              {PACKAGE_LABELS[packageType] ?? packageType}
            </span>
            {fragile && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40">
                <AlertTriangle className="w-3 h-3" />Frágil
              </span>
            )}
            {attempts > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40">
                Reintento {attempts + 1}
              </span>
            )}
          </div>

          {/* Contact actions */}
          <div className="border-t border-[var(--border)] flex divide-x divide-[var(--border)]">
            <a href={`tel:${phone}`} className="flex-1 flex items-center justify-center gap-2 h-12 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors no-underline cursor-pointer">
              <Phone size={16} className="text-[var(--brand)]" />Llamar
            </a>
            <a href={waHref(phone)} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 h-12 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors no-underline cursor-pointer">
              <MessageCircle size={16} className="text-emerald-500" />WhatsApp
            </a>
          </div>
        </div>

        {/* Route not started */}
        {!routeStarted && isOutForDelivery && (
          <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-xs text-center text-[var(--info-text)]">
            Iniciá tu ruta para habilitar las acciones de entrega.
          </div>
        )}

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

        {/* Sender */}
        <div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] p-3 flex items-center gap-3">
          <User className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{senderName}</p>
            {senderPhone && <p className="text-xs text-[var(--text-secondary)] mt-0.5">{senderPhone}</p>}
          </div>
        </div>
      </div>

      {/* Sticky CTAs */}
      {canAct && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-2.5 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="flex flex-col gap-2 max-w-sm mx-auto">
            <Button onClick={() => setDeliverOpen(true)} className="h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-base font-bold gap-2">
              <CheckCircle2 className="w-5 h-5" />Entregar
            </Button>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => setFailedOpen(true)} className="flex-1 h-11 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold gap-1.5">
                <XCircle className="w-4 h-4" />No entregado
              </Button>
              <Button onClick={() => setRejectedOpen(true)} className="flex-1 h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold gap-1.5">
                <Ban className="w-4 h-4" />Rechazado
              </Button>
            </div>
          </div>
        </div>
      )}

      <DeliverSheet open={deliverOpen} onClose={() => { setDeliverOpen(false); setRecipientDni(""); setDeliveryKeyword(""); setUseContingency(false); }} shipment={shipment} keyword={deliveryKeyword} onKeywordChange={setDeliveryKeyword} useContingency={useContingency} onUseContingency={setUseContingency} dni={recipientDni} onDniChange={setRecipientDni} submitting={submitting} onConfirm={handleDeliver} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} error={actionError} />
      <FailedSheet open={failedOpen} onClose={() => { setFailedOpen(false); setFailedReason(""); setFailedNotes(""); }} shipment={shipment} reason={failedReason} onReasonChange={setFailedReason} notes={failedNotes} onNotesChange={setFailedNotes} submitting={submitting} onConfirm={handleFailed} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} />
      <RejectedSheet open={rejectedOpen} onClose={() => { setRejectedOpen(false); setRejectedReason(""); setRejectedNotes(""); }} shipment={shipment} reason={rejectedReason} onReasonChange={setRejectedReason} notes={rejectedNotes} onNotesChange={setRejectedNotes} submitting={submitting} onConfirm={handleRejected} speedBlocked={deliveryBlocked} blockMessage={blockMessage} needsLocation={locationMissing} onRequestLocation={requestLocation} />
    </DriverShell>
  );
}
