import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  Phone,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { shipmentApi, type Shipment } from "../api/shipments";
import { driverApi, type DriverRoute as DriverRouteType } from "../api/driver";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { BottomSheet } from "../components/ui/bottom-sheet";
import { WhatsAppQuickButton } from "../components/ui/WhatsAppQuickButton";
import {
  FAILED_REASONS,
  REJECTED_REASONS,
  TIME_WINDOW_HOURS,
  TIME_WINDOW_LABEL,
  recipientView,
  timeWindowTone,
} from "../utils/driverActions";

const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Sobre",
  box: "Caja",
};

const DELIVERY_METHOD_LABEL: Record<string, string> = {
  ultima_milla: "Última milla",
  retiro_sucursal: "Retiro en sucursal",
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
  const [failedReason, setFailedReason] = useState("");
  const [failedNotes, setFailedNotes] = useState("");
  const [rejectedReason, setRejectedReason] = useState("");
  const [rejectedNotes, setRejectedNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const reload = (id: string) =>
    Promise.all([
      shipmentApi.get(id).then(setShipment),
      driverApi.getRoute().then((d) => setRoute(d.route)).catch(() => setRoute(null)),
    ]);

  useEffect(() => {
    if (!trackingId) return;
    setLoading(true);
    reload(trackingId)
      .catch(() => setError("Envío no encontrado."))
      .finally(() => setLoading(false));
  }, [trackingId]);

  const handleDeliver = async () => {
    if (!shipment || !recipientDni.trim()) return;
    setSubmitting(true);
    setActionError("");
    try {
      await shipmentApi.updateStatus(shipment.tracking_id, {
        status: "delivered",
        location: "",
        recipient_dni: recipientDni.trim(),
      });
      setDeliverOpen(false);
      setRecipientDni("");
      await reload(shipment.tracking_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo registrar la entrega.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFailed = async () => {
    if (!shipment) return;
    const reasonLabel = FAILED_REASONS.find((r) => r.id === failedReason)?.label ?? "";
    const note = [reasonLabel, failedNotes.trim()].filter(Boolean).join(" — ");
    if (!note) return;
    setSubmitting(true);
    setActionError("");
    try {
      await shipmentApi.updateStatus(shipment.tracking_id, {
        status: "delivery_failed",
        location: "",
        notes: note,
      });
      setFailedOpen(false);
      setFailedReason("");
      setFailedNotes("");
      await reload(shipment.tracking_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo registrar el intento fallido.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejected = async () => {
    if (!shipment) return;
    const r = REJECTED_REASONS.find((x) => x.id === rejectedReason);
    if (!r) return;
    if (r.id === "otro" && !rejectedNotes.trim()) return;
    const note = r.id === "otro"
      ? rejectedNotes.trim()
      : `${r.label}${rejectedNotes.trim() ? ` — ${rejectedNotes.trim()}` : ""}`;
    setSubmitting(true);
    setActionError("");
    try {
      await shipmentApi.updateStatus(shipment.tracking_id, {
        status: "rechazado",
        location: "",
        notes: note,
      });
      setRejectedOpen(false);
      setRejectedReason("");
      setRejectedNotes("");
      await reload(shipment.tracking_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo registrar el rechazo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <DetailSkeleton />;
  if (error || !shipment) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] px-4 py-3">
        <button
          onClick={() => navigate("/driver/route")}
          className="flex items-center gap-2 h-12 w-full text-base font-semibold text-[var(--text-primary)] cursor-pointer mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          Mi ruta
        </button>
        <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-6 text-center text-sm text-[var(--danger-text)]">
          {error || "No encontrado."}
        </div>
      </div>
    );
  }

  const { name, phone, street, city, province, postal, specialInstructions } =
    recipientView(shipment);
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
    <div className="min-h-screen bg-[var(--bg-page)] pb-[calc(theme(spacing.52)+env(safe-area-inset-bottom,0px))]">
      {/* Back button — large h-12, prominent */}
      <div className="sticky top-0 z-30 bg-[var(--bg-card)]/95 backdrop-blur border-b border-[var(--border)]">
        <button
          onClick={() => navigate("/driver/route")}
          className="flex items-center gap-2 h-12 w-full px-4 text-base font-semibold text-[var(--text-primary)] cursor-pointer active:bg-[var(--bg-hover)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Mi ruta
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Action error banner */}
        {actionError && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              onClick={() => setActionError("")}
              className="text-xs font-semibold opacity-80 hover:opacity-100 cursor-pointer shrink-0"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Status badge — large, prominent, centered */}
        <div className="flex justify-center py-1">
          <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-bold border bg-[var(--brand-tint)] text-[var(--brand)] border-[var(--brand-tint-border)]">
            {statusOverride ?? (() => {
              const cfg: Record<string, string> = {
                out_for_delivery: "Última milla",
                delivered: "Entregado",
                delivery_failed: "Entrega fallida",
                rechazado: "Rechazado",
                at_hub: "En sucursal",
              };
              return cfg[shipment.status] ?? shipment.status;
            })()}
          </span>
        </div>

        {/* Recipient card */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 shadow-sm">
          {/* Name */}
          <h2 className="text-lg font-bold text-[var(--text-primary)] leading-tight">{name}</h2>

          {/* Address */}
          <div className="mt-2 flex items-start gap-2 text-[var(--text-strong)]">
            <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug">{street}</p>
              <p className="text-xs text-[var(--text-secondary)] leading-snug mt-0.5">
                {[city, province, postal].filter(Boolean).join(", ")}
              </p>
            </div>
          </div>

          {/* Phone */}
          <div className="mt-2 flex items-center gap-2 text-[var(--text-strong)]">
            <Phone className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
            <span className="text-sm font-medium">{phone}</span>
          </div>

          {/* WhatsApp quick actions */}
          <div className="mt-3">
            <WhatsAppQuickButton
              phone={phone}
              recipientName={name}
              trackingId={shipment.tracking_id}
              compact
            />
          </div>

          {/* Chips: time window, fragile, package, retry */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}
              >
                <Clock className="w-3 h-3" />
                {TIME_WINDOW_LABEL[tw] ?? tw}
                {TIME_WINDOW_HOURS[tw] && ` · ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            {fragile && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40">
                <AlertTriangle className="w-3 h-3" />
                Frágil
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-[var(--bg-subtle)] text-[var(--text-strong)] border-[var(--border)]">
              <Package className="w-3 h-3" />
              {weightKg} kg · {PACKAGE_LABELS[packageType] ?? packageType}
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
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--warn-text)] mb-1">
                Instrucciones especiales
              </p>
              <p className="text-sm text-[var(--warn-text)] leading-relaxed">{specialInstructions}</p>
            </div>
          </div>
        )}

        {/* Route not started warning */}
        {!routeStarted && isOutForDelivery && (
          <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-xs text-center text-[var(--info-text)]">
            Iniciá tu ruta desde "Mi ruta" para habilitar las acciones de entrega.
          </div>
        )}

        {/* Package details — condensed, icons */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4">
          <div className="grid gap-2.5">
            <div className="flex items-center gap-3 py-1">
              <Package className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
              <span className="text-sm text-[var(--text-primary)]">
                {PACKAGE_LABELS[packageType] ?? packageType} · {weightKg} kg
              </span>
            </div>
            <div className="flex items-center gap-3 py-1">
              <Truck className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
              <span className="text-sm text-[var(--text-primary)]">
                {DELIVERY_METHOD_LABEL[deliveryMethod] ?? "Última milla"}
              </span>
            </div>
            {fragile && (
              <div className="flex items-center gap-3 py-1">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Frágil</span>
              </div>
            )}
          </div>
        </div>

        {/* Sender — condensed secondary info */}
        <div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] p-3 flex items-center gap-3">
          <User className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{senderName}</p>
            {senderPhone && (
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{senderPhone}</p>
            )}
          </div>
        </div>
      </div>

      {/* Sticky delivery actions */}
      {canAct && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-3 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="flex flex-col gap-2">
            {/* Deliver — primary, emerald */}
            <button
              onClick={() => setDeliverOpen(true)}
              className="w-full h-14 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700 dark:active:bg-emerald-800 text-white text-lg font-bold cursor-pointer inline-flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
            >
              <CheckCircle2 className="w-5 h-5" />
              Entregar
            </button>

            {/* Failed — red */}
            <button
              onClick={() => setFailedOpen(true)}
              className="w-full h-14 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 dark:active:bg-red-800 text-white text-lg font-bold cursor-pointer inline-flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
            >
              <XCircle className="w-5 h-5" />
              No entregado
            </button>

            {/* Rejected — orange */}
            <button
              onClick={() => setRejectedOpen(true)}
              className="w-full h-14 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 dark:bg-orange-600 dark:hover:bg-orange-700 dark:active:bg-orange-800 text-white text-lg font-bold cursor-pointer inline-flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
            >
              <Ban className="w-5 h-5" />
              Rechazado por destinatario
            </button>
          </div>
        </div>
      )}

      <DeliverSheet
        open={deliverOpen}
        onClose={() => { setDeliverOpen(false); setRecipientDni(""); }}
        recipientName={name}
        dni={recipientDni}
        onDniChange={setRecipientDni}
        submitting={submitting}
        onConfirm={handleDeliver}
      />
      <FailedSheet
        open={failedOpen}
        onClose={() => { setFailedOpen(false); setFailedReason(""); setFailedNotes(""); }}
        recipientName={name}
        reason={failedReason}
        onReasonChange={setFailedReason}
        notes={failedNotes}
        onNotesChange={setFailedNotes}
        submitting={submitting}
        onConfirm={handleFailed}
      />
      <RejectedSheet
        open={rejectedOpen}
        onClose={() => { setRejectedOpen(false); setRejectedReason(""); setRejectedNotes(""); }}
        recipientName={name}
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

function DeliverSheet({
  open,
  onClose,
  recipientName,
  dni,
  onDniChange,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  recipientName: string;
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

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Confirmar entrega"
      description={`Entrega a ${recipientName}`}
    >
      <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
        DNI del destinatario
      </label>
      <input
        ref={inputRef}
        value={dni}
        onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Ej: 30123456"
        className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500"
      />
      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
        Solo dígitos. Debe coincidir con el DNI registrado al crear el envío.
      </p>

      <div className="flex flex-col gap-2 mt-5">
        <button
          onClick={onConfirm}
          disabled={!dni.trim() || submitting}
          className="w-full h-14 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-muted)] text-white text-lg font-bold cursor-pointer disabled:cursor-not-allowed active:scale-95 transition-all"
        >
          {submitting ? "Guardando…" : "Confirmar entrega"}
        </button>
        <button
          onClick={onClose}
          className="w-full h-14 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-strong)] text-base font-semibold cursor-pointer transition-colors"
        >
          Cancelar
        </button>
      </div>
    </BottomSheet>
  );
}

function FailedSheet({
  open,
  onClose,
  recipientName,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  reason: string;
  onReasonChange: (s: string) => void;
  notes: string;
  onNotesChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const requiresNotes = reason === "otro";
  const canSubmit = !!reason && !(requiresNotes && !notes.trim());

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Marcar como no entregado"
      description={`No entrega a ${recipientName}`}
    >
      <p className="text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-2">
        ¿Qué pasó?
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {FAILED_REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onReasonChange(r.id)}
              className={`h-12 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-colors ${
                active
                  ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500"
                  : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-strong)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
        Notas {requiresNotes ? "(obligatorio)" : "(opcional)"}
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder={requiresNotes ? "Describí el motivo" : "Detalle adicional para el supervisor"}
        rows={3}
        className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-red-500/20 focus:border-red-500 resize-y"
      />

      <div className="flex flex-col gap-2 mt-5">
        <button
          onClick={onConfirm}
          disabled={!canSubmit || submitting}
          className="w-full h-14 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-muted)] text-white text-lg font-bold cursor-pointer disabled:cursor-not-allowed active:scale-95 transition-all"
        >
          {submitting ? "Guardando…" : "Confirmar"}
        </button>
        <button
          onClick={onClose}
          className="w-full h-14 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-strong)] text-base font-semibold cursor-pointer transition-colors"
        >
          Cancelar
        </button>
      </div>
    </BottomSheet>
  );
}

function RejectedSheet({
  open,
  onClose,
  recipientName,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  recipientName: string;
  reason: string;
  onReasonChange: (s: string) => void;
  notes: string;
  onNotesChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
}) {
  const requiresNotes = reason === "otro";
  const canSubmit = !!reason && !(requiresNotes && !notes.trim());

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Rechazado por destinatario"
      description={`${recipientName} rechazó el envío`}
    >
      <p className="text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-2">
        Motivo del rechazo
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {REJECTED_REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onReasonChange(r.id)}
              className={`h-12 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-colors ${
                active
                  ? "border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500"
                  : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-strong)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <r.icon className="w-5 h-5" /> {r.label}
            </button>
          );
        })}
      </div>

      <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
        Notas {requiresNotes ? "(obligatorio)" : "(opcional)"}
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder={requiresNotes ? "Describí el motivo" : "Detalle adicional"}
        rows={3}
        className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-orange-500/20 focus:border-orange-500 resize-y"
      />

      <div className="flex flex-col gap-2 mt-5">
        <button
          onClick={onConfirm}
          disabled={!canSubmit || submitting}
          className="w-full h-14 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:bg-[var(--bg-muted)] disabled:text-[var(--text-muted)] text-white text-lg font-bold cursor-pointer disabled:cursor-not-allowed active:scale-95 transition-all"
        >
          {submitting ? "Guardando…" : "Confirmar rechazo"}
        </button>
        <button
          onClick={onClose}
          className="w-full h-14 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-strong)] text-base font-semibold cursor-pointer transition-colors"
        >
          Cancelar
        </button>
      </div>
    </BottomSheet>
  );
}

function DetailSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      <div className="sticky top-0 z-30 bg-[var(--bg-card)]/95 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 h-12 px-4">
          <div className="w-5 h-5 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="h-4 w-20 rounded bg-[var(--bg-muted)] animate-pulse" />
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Status badge */}
        <div className="flex justify-center py-1">
          <div className="h-7 w-28 rounded-full bg-[var(--bg-muted)] animate-pulse" />
        </div>
        {/* Recipient card */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 space-y-3">
          <div className="h-6 w-3/5 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-4/5 rounded bg-[var(--bg-muted)] animate-pulse" />
            <div className="h-3 w-3/5 rounded bg-[var(--bg-muted)] animate-pulse" />
          </div>
          <div className="h-4 w-32 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="h-14 rounded-xl bg-[var(--bg-muted)] animate-pulse" />
          <div className="flex gap-2">
            <div className="h-6 w-20 rounded-full bg-[var(--bg-muted)] animate-pulse" />
            <div className="h-6 w-20 rounded-full bg-[var(--bg-muted)] animate-pulse" />
            <div className="h-6 w-16 rounded-full bg-[var(--bg-muted)] animate-pulse" />
          </div>
        </div>
        {/* Package card */}
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 space-y-2.5">
          <div className="h-4 w-3/5 rounded bg-[var(--bg-muted)] animate-pulse" />
          <div className="h-4 w-2/5 rounded bg-[var(--bg-muted)] animate-pulse" />
        </div>
        {/* Sender card */}
        <div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] p-3">
          <div className="h-4 w-48 rounded bg-[var(--bg-muted)] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
