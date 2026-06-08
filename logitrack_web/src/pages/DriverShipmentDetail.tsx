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
  User,
  XCircle,
} from "lucide-react";
import { shipmentApi, type Shipment } from "../api/shipments";
import { driverApi, type DriverRoute as DriverRouteType } from "../api/driver";
import { Card } from "../components/ui/card";
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
      ? `${r.emoji} ${rejectedNotes.trim()}`
      : `${r.emoji} ${r.label}${rejectedNotes.trim() ? ` — ${rejectedNotes.trim()}` : ""}`;
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
      <div className="p-6 max-w-lg mx-auto">
        <button
          onClick={() => navigate("/driver/route")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--sidebar-bg)] mb-5 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Mi ruta
        </button>
        <Card className="p-8 text-center text-sm text-rose-600">
          {error || "No encontrado."}
        </Card>
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
  const isDelivered = shipment.status === "delivered";
  const isFailed = shipment.status === "delivery_failed";
  const isRejected = shipment.status === "rechazado";

  const packageType = cor.package_type ?? shipment.package_type;
  const weightKg = cor.weight_kg ?? String(shipment.weight_kg);
  const senderName = cor.sender_name ?? shipment.sender.name;
  const senderPhone = cor.sender_phone ?? shipment.sender.phone;

  return (
    <div className="pb-32">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b dark:border-gray-700 border-slate-200">
        <div className="px-4 sm:px-6 max-w-2xl mx-auto py-3 flex items-center gap-3">
          <button
            onClick={() => navigate("/driver/route")}
            className="-ml-1 w-9 h-9 rounded-full dark:hover:bg-gray-700 hover:bg-slate-100 flex items-center justify-center dark:text-gray-300 text-slate-700 cursor-pointer"
            aria-label="Volver a mi ruta"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono dark:text-gray-500 text-slate-400 leading-tight">{shipment.tracking_id}</p>
            <p className="text-sm font-bold dark:text-gray-100 text-slate-900 truncate leading-tight">Detalle del envío</p>
          </div>
          {isDelivered && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              Entregado
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100 px-2.5 py-1 rounded-full">
              <XCircle className="w-3 h-3" />
              Sin entregar
            </span>
          )}
          {isRejected && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
              <Ban className="w-3 h-3" />
              Rechazado
            </span>
          )}
          {isOutForDelivery && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
              Para entregar
            </span>
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

        {/* Hero: nombre + dirección */}
        <Card className="p-5 mb-3">
          <p className="text-[11px] font-bold uppercase tracking-wider dark:text-gray-400 text-slate-500 mb-2">
            Destinatario
          </p>
          <h2 className="text-xl font-bold dark:text-gray-100 text-slate-900 leading-tight">{name}</h2>
          <div className="mt-3 flex items-start gap-2 dark:text-gray-300 text-slate-700">
            <MapPin className="w-4 h-4 dark:text-gray-500 text-slate-400 shrink-0 mt-1" />
            <div className="flex-1">
              <p className="text-base font-semibold leading-snug">{street}</p>
              <p className="text-sm dark:text-gray-400 text-slate-500 leading-snug">
                {[city, province, postal].filter(Boolean).join(", ")}
              </p>
            </div>
          </div>

          {/* chips */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {tw && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${twTone.bg} ${twTone.text} ${twTone.border}`}>
                <Clock className="w-3 h-3" />
                {TIME_WINDOW_LABEL[tw] ?? tw}
                {TIME_WINDOW_HOURS[tw] && ` · ${TIME_WINDOW_HOURS[tw]}`}
              </span>
            )}
            {fragile && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="w-3 h-3" />
                Frágil
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border dark:bg-gray-800/50 bg-slate-50 dark:text-gray-300 text-slate-700 dark:border-gray-700 border-slate-200">
              <Package className="w-3 h-3" />
              {weightKg} kg · {PACKAGE_LABELS[packageType] ?? packageType}
            </span>
            {attempts > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                Reintento {attempts + 1}
              </span>
            )}
          </div>

          {/* Quick actions */}
          <div className="mt-4">
            <WhatsAppQuickButton
              phone={phone}
              recipientName={name}
              trackingId={shipment.tracking_id}
            />
          </div>

          <p className="mt-3 text-sm dark:text-gray-300 text-slate-700 font-medium">{phone}</p>
        </Card>

        {/* Special instructions: prominente */}
        {specialInstructions && (
          <div className="mb-3 p-4 rounded-xl border-2 border-amber-300 bg-amber-50 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">
                Instrucciones especiales
              </p>
              <p className="text-sm text-amber-900 leading-relaxed">{specialInstructions}</p>
            </div>
          </div>
        )}

        {/* Paquete */}
        <Card className="p-4 mb-3">
          <p className="text-[11px] font-bold uppercase tracking-wider dark:text-gray-400 text-slate-500 mb-3">
            Paquete
          </p>
          <div className="grid gap-2 text-sm">
            <Row label="Tipo" value={PACKAGE_LABELS[packageType] ?? packageType} />
            <Row label="Peso" value={`${weightKg} kg`} />
            <Row
              label="Entrega"
              value={DELIVERY_METHOD_LABEL[shipment.delivery_method ?? "ultima_milla"] ?? "Última milla"}
            />
            {fragile && <Row label="Frágil" value="Sí" highlight />}
          </div>
        </Card>

        {/* Remitente — colapsado por defecto, contenido secundario */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <User className="w-4 h-4 dark:text-gray-500 text-slate-400" />
            <p className="text-[11px] font-bold uppercase tracking-wider dark:text-gray-400 text-slate-500">
              Remitente
            </p>
          </div>
          <p className="text-sm font-semibold dark:text-gray-100 text-slate-900">{senderName}</p>
          {senderPhone && (
            <p className="text-xs dark:text-gray-400 text-slate-500 mt-0.5">{senderPhone}</p>
          )}
        </Card>

        {!routeStarted && isOutForDelivery && (
          <p className="mt-4 text-xs text-center dark:text-gray-400 text-slate-500 leading-relaxed">
            Iniciá tu ruta desde "Mi ruta" para habilitar las acciones de entrega.
          </p>
        )}
      </div>

      {/* Sticky CTAs cuando se puede actuar */}
      {canAct && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t dark:border-gray-700 border-slate-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setFailedOpen(true)}
                className="h-12 rounded-xl border-2 border-rose-300 dark:bg-gray-800 bg-white hover:bg-rose-50 text-rose-700 text-sm font-bold cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <XCircle className="w-4 h-4" />
                No entregado
              </button>
              <button
                onClick={() => setDeliverOpen(true)}
                className="h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                Entregar
              </button>
            </div>
            <button
              onClick={() => setRejectedOpen(true)}
              className="h-11 rounded-xl border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-bold cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <Ban className="w-4 h-4" />
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

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="dark:text-gray-400 text-slate-500 min-w-[90px]">{label}</span>
      <span className={highlight ? "font-semibold text-amber-700" : "font-medium dark:text-gray-100 text-slate-900"}>{value}</span>
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
      <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
        DNI del destinatario
      </label>
      <input
        ref={inputRef}
        value={dni}
        onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Ej: 30123456"
        className="w-full h-12 px-4 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white text-base placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500"
      />
      <p className="mt-1.5 text-[11px] dark:text-gray-400 text-slate-500">
        Solo dígitos. Debe coincidir con el DNI registrado al crear el envío.
      </p>

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={onClose}
          className="h-12 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white dark:hover:bg-gray-700 hover:bg-slate-50 dark:text-gray-300 text-slate-700 text-sm font-bold cursor-pointer"
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
              className={`h-12 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-colors ${
                active
                  ? "border-rose-500 bg-rose-50 text-rose-800"
                  : "dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700 hover:bg-slate-50"
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
        className="w-full px-4 py-3 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-rose-500/20 focus:border-rose-500 resize-y"
      />

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={onClose}
          className="h-12 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white dark:hover:bg-gray-700 hover:bg-slate-50 dark:text-gray-300 text-slate-700 text-sm font-bold cursor-pointer"
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
              className={`h-12 rounded-xl border-2 text-sm font-semibold cursor-pointer transition-colors ${
                active
                  ? "border-amber-500 bg-amber-50 text-amber-800"
                  : "dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700 hover:bg-slate-50"
              }`}
            >
              {r.emoji} {r.label}
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
        placeholder={requiresNotes ? "Describí el motivo" : "Detalle adicional"}
        rows={3}
        className="w-full px-4 py-3 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-amber-500/20 focus:border-amber-500 resize-y"
      />

      <div className="grid grid-cols-2 gap-2 mt-5">
        <button
          onClick={onClose}
          className="h-12 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white dark:hover:bg-gray-700 hover:bg-slate-50 dark:text-gray-300 text-slate-700 text-sm font-bold cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={!canSubmit || submitting}
          className="h-12 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Guardando…" : "Confirmar rechazo"}
        </button>
      </div>
    </BottomSheet>
  );
}

function DetailSkeleton() {
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="h-6 w-24 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse mb-5" />
      <div className="rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-5 mb-3">
        <div className="h-3 w-20 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse mb-3" />
        <div className="h-6 w-3/5 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse mb-3" />
        <div className="h-4 w-4/5 rounded dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
        <div className="grid grid-cols-3 gap-2 mt-5">
          <div className="h-16 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
          <div className="h-16 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
          <div className="h-16 rounded-xl dark:bg-gray-700/50 bg-slate-100 animate-pulse" />
        </div>
      </div>
      <div className="rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4 h-24 animate-pulse" />
    </div>
  );
}
