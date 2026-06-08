import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  publicTrackingApi,
  type PublicShipment,
  type PublicShipmentEvent,
  type PublicClaim,
  type ClaimStatus,
} from "../api/publicTracking";
import type { ShipmentStatus } from "../api/shipments";
import type { Branch } from "../api/branches";
import {
  PublicClaimFormFields,
  type PublicClaimFormValues,
} from "../components/PublicClaimFormFields";
import {
  emptyClaimFormValues,
  buildClaimDescription,
  resolveClaimType,
  validatePublicClaimForm,
} from "../utils/publicClaimForm";
import { fmtDateTime, fmtRelative } from "../utils/date";
import { ChatbotWidget } from "../components/chatbot/ChatbotWidget";
import {
  Package,
  Truck,
  CheckCircle2,
  Ban,
  Search,
  AlertTriangle,
  Bike,
  Rocket,
  Inbox,
  UserX,
  RefreshCw,
  ClipboardList,
  Factory,
  Undo2,
  Flame,
  Reply,
  Repeat,
  ReceiptText,
  MapPin,
  Circle,
  PartyPopper,
  ArrowRight,
  CornerUpLeft,
} from "lucide-react";
import type { ReactNode } from "react";

// User-facing one-liner explanation for each status.
const STATUS_BLURBS: Record<ShipmentStatus, string> = {
  draft:                "Aún no se confirmó este envío.",
  at_origin_hub:        "Tu envío está en la sucursal de origen, listo para iniciar el viaje.",
  loaded:               "Está cargado en el vehículo y listo para despachar.",
  in_transit:           "Tu envío viaja entre sucursales.",
  at_hub:               "Llegó a un centro logístico.",
  out_for_delivery:     "El cartero está en camino a tu domicilio.",
  delivery_failed:      "Hubo un intento de entrega que no fue exitoso.",
  redelivery_scheduled: "Programamos una nueva visita para entregarlo.",
  no_entregado:         "No pudo ser entregado al destinatario.",
  rechazado:            "El destinatario rechazó el envío.",
  delivered:            "¡Listo! Tu envío fue entregado.",
  ready_for_pickup:     "Tu envío te está esperando en la sucursal.",
  ready_for_return:     "Estamos preparando la devolución al remitente.",
  returned:             "El envío fue devuelto al remitente.",
  cancelled:            "Este envío fue cancelado.",
  lost:                 "Reportamos este envío como extraviado. Estamos en contacto.",
  destroyed:            "El envío sufrió un daño total y no podrá ser entregado.",
  expired:              "Este borrador ha expirado.",
  pending_payment:      "Tu envío está pendiente de confirmación de pago.",
};

const EXAMPLE_TRACKING_IDS = [
  {
    trackingId: "LT-LM00001",
    sender: { name: "Carlos Mendez", dni: "27845123" },
    recipient: { name: "Laura Gómez", dni: "31204567" },
  },
  {
    trackingId: "LT-DELIVER01",
    sender: { name: "Tech Store SA", dni: "20111222" },
    recipient: { name: "Marcela Suárez", dni: "30123456" },
  },
  {
    trackingId: "LT-PICKUP01",
    sender: { name: "MercadoLocal", dni: "27554433" },
    recipient: { name: "Sebastián Moyano", dni: "33112233" },
  },
];

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Abierto",
  in_review: "En revisión",
  pending_customer: "Pendiente del cliente",
  derived: "Derivado",
  resolved_operativa: "Resuelto",
  resolved_comercial: "Resuelto",
  resolved_rrhh: "Resuelto",
  resolved_improcedente: "Resuelto",
};

interface EventDescription {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

function describeEvent(ev: PublicShipmentEvent, branches: Branch[]): EventDescription {
  if (ev.event_type === "claim_created") {
    const statusLabel = ev.claim_status ? CLAIM_STATUS_LABELS[ev.claim_status] ?? "Abierto" : "Abierto";
    return { icon: <ReceiptText className="w-4 h-4" />, title: `En Reclamo · ${statusLabel}` };
  }

  if (ev.event_type === "rescheduled" && ev.current_location && ev.rescheduled_date) {
    const locationText = ev.current_location.type === "DESTINATION_BRANCH"
      ? "En Sucursal Destino"
      : ev.current_location.type === "ORIGIN_BRANCH"
      ? `En Sucursal Origen (${ev.current_location.branch_code})`
      : "En tránsito";
    const formattedDate = new Date(ev.rescheduled_date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    return {
      icon: <MapPin className="w-4 h-4" />,
      title: `${locationText} - ${ev.current_location.status}`,
      subtitle: `Entrega reprogramada para el ${formattedDate}`
    };
  }

  const loc = ev.location;
  const branch = loc
    ? (branches.find((b) => b.address.city === loc) ?? branches.find((b) => b.id === loc))
    : undefined;
  const cityLine = branch ? `${branch.address.city}, ${branch.province}` : loc ?? undefined;
  const { from_status: from, to_status: to } = ev;
  const icn = "w-4 h-4 shrink-0";

  if (!from && to === "at_origin_hub") return { icon: <Package className={icn} />, title: "Envío registrado", subtitle: cityLine };
  if (!from && to === "draft")          return { icon: <ClipboardList className={icn} />, title: "Borrador creado" };
  if (from === "draft" && to === "at_origin_hub") return { icon: <CheckCircle2 className={icn} />, title: "Envío confirmado", subtitle: cityLine };
  if (to === "loaded")                  return { icon: <Truck className={icn} />, title: "Cargado y listo para despachar", subtitle: cityLine };
  if (to === "in_transit")              return { icon: <Rocket className={icn} />, title: "Despachado — en tránsito" };
  if (to === "at_hub" || to === "at_origin_hub") return { icon: <Factory className={icn} />, title: "Llegó al centro logístico", subtitle: cityLine };
  if (to === "out_for_delivery")        return { icon: <Bike className={icn} />, title: "En camino a domicilio", subtitle: cityLine };
  if (to === "delivered")               return { icon: <PartyPopper className={icn} />, title: "Envío entregado" };
  if (to === "delivery_failed")         return { icon: <AlertTriangle className={icn} />, title: "El intento de entrega no fue exitoso" };
  if (to === "redelivery_scheduled")    return { icon: <RefreshCw className={icn} />, title: "Reentrega programada" };
  if (to === "no_entregado")            return { icon: <UserX className={icn} />, title: "No pudo ser entregado" };
  if (to === "rechazado")               return { icon: <Ban className={icn} />, title: "Envío rechazado por el destinatario" };
  if (to === "ready_for_pickup")        return { icon: <Inbox className={icn} />, title: "Disponible para retiro en el centro logístico", subtitle: cityLine };
  if (to === "ready_for_return")        return { icon: <CornerUpLeft className={icn} />, title: "En espera de devolución al remitente", subtitle: cityLine };
  if (to === "returned")                return { icon: <Undo2 className={icn} />, title: "Devuelto al remitente" };
  if (to === "cancelled")               return { icon: <Ban className={icn} />, title: "Envío cancelado" };
  if (to === "lost")                    return { icon: <Search className={icn} />, title: "Envío extraviado" };
  if (to === "destroyed")               return { icon: <Flame className={icn} />, title: "Daño total — envío destruido" };
  return { icon: <Circle className={icn} />, title: to, subtitle: cityLine };
}

type PhaseState = "pending" | "active" | "done" | "failed" | "warn";

interface Phase {
  key: string;
  label: string;
}

interface PhaseInfo {
  phases: Phase[];
  states: Array<{ state: PhaseState; pct: number }>;
  failedPhaseLabel?: string;
}

const TERMINAL_FAILED: ShipmentStatus[] = ["cancelled", "lost", "destroyed", "rechazado", "no_entregado"];
const WARN_STATUSES: ShipmentStatus[] = ["delivery_failed", "redelivery_scheduled"];

const PHASES_ULTIMA_MILLA: Phase[] = [
  { key: "registered", label: "Registrado" },
  { key: "transit",    label: "En camino" },
  { key: "at_dest",    label: "En sucursal destino" },
  { key: "delivery",   label: "En reparto" },
  { key: "delivered",  label: "Entregado" },
];

const PHASES_BRANCH_PICKUP: Phase[] = [
  { key: "registered", label: "Registrado" },
  { key: "transit",    label: "En camino" },
  { key: "at_branch",  label: "En sucursal" },
  { key: "ready",      label: "Listo para retirar" },
  { key: "retrieved",  label: "Retirado" },
];

const PHASES_RETURN: Phase[] = [
  { key: "registered",     label: "Registrado" },
  { key: "return_started", label: "Retorno iniciado" },
  { key: "return_transit", label: "En camino de regreso" },
  { key: "returned",       label: "Devuelto al remitente" },
];

function lastActiveStatusBeforeTerminal(
  events: PublicShipmentEvent[],
  terminalStatus: ShipmentStatus
): ShipmentStatus | null {
  const terminalEvent = [...events]
    .reverse()
    .find(e => e.to_status === terminalStatus && e.from_status != null);
  return terminalEvent?.from_status ?? null;
}

function getActivePhaseInfo(
  status: ShipmentStatus,
  shipment: PublicShipment
): { phase: number; pct: number } {
  const isFinalHub =
    status === "at_hub" &&
    shipment.current_location != null &&
    shipment.final_branch_id != null &&
    shipment.current_location === shipment.final_branch_id;
  const isBranchPickup = shipment.delivery_method === "retiro_sucursal";
  const isReturning = !!shipment.is_returning;

  if (isReturning) {
    switch (status) {
      case "pending_payment":   return { phase: 0, pct: 40 };
      case "at_origin_hub":     return { phase: 0, pct: 80 };
      case "ready_for_return":  return { phase: 1, pct: 80 };
      case "loaded":            return { phase: 2, pct: 20 };
      case "in_transit":        return { phase: 2, pct: 60 };
      case "at_hub":            return { phase: 2, pct: 90 };
      case "returned":          return { phase: 3, pct: 100 };
      default:                  return { phase: 0, pct: 40 };
    }
  }

  switch (status) {
    case "pending_payment":      return { phase: 0, pct: 40 };
    case "at_origin_hub":        return { phase: 0, pct: 80 };
    case "loaded": {
      const isLoadedAtFinalHub =
        shipment.current_location != null &&
        shipment.final_branch_id != null &&
        shipment.current_location === shipment.final_branch_id;
      return isLoadedAtFinalHub ? { phase: 2, pct: 100 } : { phase: 1, pct: 20 };
    }
    case "in_transit":           return { phase: 1, pct: 60 };
    case "at_hub":
      return isFinalHub ? { phase: 2, pct: 100 } : { phase: 1, pct: 90 };
    case "ready_for_pickup":
      return isBranchPickup ? { phase: 2, pct: 100 } : { phase: 3, pct: 90 };
    case "ready_for_return":     return { phase: 2, pct: 60 };
    case "out_for_delivery":     return { phase: 3, pct: 40 };
    case "delivery_failed":      return { phase: 3, pct: 60 };
    case "redelivery_scheduled": return { phase: 3, pct: 80 };
    case "delivered":            return { phase: 4, pct: 100 };
    case "returned":             return { phase: 4, pct: 100 };
    default:                     return { phase: 0, pct: 40 };
  }
}

function computePhaseInfo(
  shipment: PublicShipment,
  events: PublicShipmentEvent[]
): PhaseInfo {
  const isReturning = !!shipment.is_returning;
  const isBranchPickup = shipment.delivery_method === "retiro_sucursal";

  const phases = isReturning
    ? PHASES_RETURN
    : isBranchPickup
    ? PHASES_BRANCH_PICKUP
    : PHASES_ULTIMA_MILLA;

  const { status } = shipment;

  if (status === "delivered" || status === "returned") {
    return {
      phases,
      states: phases.map(() => ({ state: "done" as PhaseState, pct: 100 })),
    };
  }

  if (TERMINAL_FAILED.includes(status)) {
    const fromStatus = lastActiveStatusBeforeTerminal(events, status);
    const { phase: failedPhase } = fromStatus
      ? getActivePhaseInfo(fromStatus, shipment)
      : { phase: 0 };
    const failedPhaseLabel = status === "rechazado" ? "Rechazado en entrega" : undefined;
    return {
      phases,
      states: phases.map((_, i): { state: PhaseState; pct: number } => {
        if (i < failedPhase) return { state: "done", pct: 100 };
        if (i === failedPhase) return { state: "failed", pct: 100 };
        return { state: "pending", pct: 0 };
      }),
      failedPhaseLabel,
    };
  }

  const { phase: activePhase, pct } = getActivePhaseInfo(status, shipment);
  const isWarn = WARN_STATUSES.includes(status);

  return {
    phases,
    states: phases.map((_, i): { state: PhaseState; pct: number } => {
      if (i < activePhase) return { state: "done", pct: 100 };
      if (i === activePhase) return { state: isWarn ? "warn" : "active", pct };
      return { state: "pending", pct: 0 };
    }),
  };
}

interface StatusHero {
  tone: "success" | "info" | "warn" | "danger" | "muted";
  icon: ReactNode;
  title: string;
  subtitle: string;
}

const icnHero = "w-10 h-10 max-sm:w-8 max-sm:h-8 shrink-0";

function statusHero(s: PublicShipment): StatusHero {
  switch (s.status) {
    case "delivered":
      return {
        tone: "success",
        icon: <PartyPopper className={icnHero} />,
        title: "¡Tu envío fue entregado!",
        subtitle: s.delivered_at
          ? `Entregado el ${fmtDateTime(s.delivered_at)}`
          : "Listo y entregado.",
      };
    case "returned":
      return { tone: "muted", icon: <Undo2 className={icnHero} />, title: "Envío devuelto al remitente", subtitle: "Cerramos este envío con devolución completa." };
    case "cancelled":
      return { tone: "muted", icon: <Ban className={icnHero} />, title: "Envío cancelado", subtitle: "Este envío fue cancelado y no continuará su viaje." };
    case "lost":
      return { tone: "danger", icon: <Search className={icnHero} />, title: "Envío extraviado", subtitle: "Estamos investigando su paradero. Te vamos a contactar." };
    case "destroyed":
      return { tone: "danger", icon: <Flame className={icnHero} />, title: "Daño total", subtitle: "El envío sufrió un daño irreparable y no podrá ser entregado." };
    case "delivery_failed":
    case "redelivery_scheduled":
      return { tone: "warn", icon: <AlertTriangle className={icnHero} />, title: "Intento de entrega fallido", subtitle: STATUS_BLURBS[s.status] };
    case "no_entregado":
    case "rechazado":
      return { tone: "danger", icon: <UserX className={icnHero} />, title: STATUS_BLURBS[s.status], subtitle: "Coordiná con el remitente los próximos pasos." };
    case "out_for_delivery":
      return {
        tone: "info",
        icon: <Bike className={icnHero} />,
        title: "Tu envío está en camino",
        subtitle:
          (s.relative_hours != null
            ? formatEtaHoursMessage(s.relative_hours)
            : etaHoursMessage(s.estimated_delivery_at)
          ) ?? "Tu envío está en camino a tu domicilio.",
      };
    case "in_transit":
      return {
        tone: "info",
        icon: <Rocket className={icnHero} />,
        title: "Tu envío está en tránsito",
        subtitle: etaHoursMessage(s.estimated_delivery_at) ?? STATUS_BLURBS["in_transit"],
      };
    case "loaded": {
      const isLoadedAtFinalHub =
        s.current_location != null &&
        s.final_branch_id != null &&
        s.current_location === s.final_branch_id;
      return {
        tone: "info",
        icon: <Package className={icnHero} />,
        title: isLoadedAtFinalHub ? "Próximo a salir" : "Tu envío está en camino",
        subtitle: STATUS_BLURBS["loaded"],
      };
    }
    case "ready_for_pickup":
      return { tone: "info", icon: <Inbox className={icnHero} />, title: "Listo para retirar", subtitle: "Te esperamos en la sucursal con tu DNI." };
    default:
      return { tone: "info", icon: <Truck className={icnHero} />, title: "Tu envío está en camino", subtitle: STATUS_BLURBS[s.status] ?? "" };
  }
}

function shipmentTypeLabel(t: PublicShipment["shipment_type"]): string {
  if (t === "express") return "Express";
  return "Estándar";
}

function timeWindowLabel(w: PublicShipment["time_window"]): string | undefined {
  if (w === "morning") return "Mañana";
  if (w === "afternoon") return "Tarde";
  if (w === "flexible") return "Horario flexible";
  return undefined;
}

function deliveryMethodLabel(m: PublicShipment["delivery_method"]): string | undefined {
  if (m === "ultima_milla") return "Entrega a domicilio";
  if (m === "retiro_sucursal") return "Retiro en sucursal";
  return undefined;
}

function etaSummary(iso: string | null, status: ShipmentStatus): { line: string; rel?: string } | undefined {
  if (!iso) return undefined;
  const HIDE_STATUSES: ShipmentStatus[] = [
    "delivered", "returned", "cancelled", "lost", "destroyed",
    "draft", "at_origin_hub",
  ];
  if ((HIDE_STATUSES as string[]).includes(status)) return undefined;
  return { line: fmtDateTime(iso), rel: fmtRelative(iso) };
}

function formatEtaHoursMessage(hours: number): string {
  return hours === 1
    ? "Tu envío llegará dentro de la próxima 1 hora."
    : `Tu envío llegará dentro de las próximas ${hours} horas.`;
}

function etaHoursMessage(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return undefined;
  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  return formatEtaHoursMessage(hours);
}

export function PublicTracking() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("id") ?? "");
  const [shipment, setShipment] = useState<PublicShipment | null>(null);
  const [events, setEvents] = useState<PublicShipmentEvent[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimForm, setClaimForm] = useState<PublicClaimFormValues>(emptyClaimFormValues);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimResult, setClaimResult] = useState<PublicClaim | null>(null);

  useEffect(() => {
    publicTrackingApi.getBranches().then(setBranches).catch(() => {});
  }, []);

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) runSearch(id);
  }, [searchParams]);

  const resetClaimForm = () => {
    setClaimOpen(false);
    setClaimForm(emptyClaimFormValues);
    setClaimSubmitting(false);
    setClaimError("");
    setClaimResult(null);
  };

  const patchClaimForm = (patch: Partial<PublicClaimFormValues>) => {
    setClaimForm((prev) => ({ ...prev, ...patch }));
  };

  const runSearch = async (trackingId: string) => {
    setLoading(true);
    setError("");
    setShipment(null);
    setEvents([]);
    resetClaimForm();
    try {
      const id = trackingId.trim().toUpperCase();
      const [s, ev] = await Promise.all([
        publicTrackingApi.getShipment(id),
        publicTrackingApi.getEvents(id),
      ]);
      setShipment(s);
      setEvents(ev);
    } catch {
      setError("No encontramos un envío con ese número. Verificá el formato (LT-XXXXXXXX) e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchParams({ id: query.trim().toUpperCase() });
    runSearch(query.trim());
  };

  const handleExampleClick = (id: string) => {
    const normalized = id.trim().toUpperCase();
    setQuery(normalized);
    setSearchParams({ id: normalized });
    runSearch(normalized);
  };

  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimSubmitting(true);
    setClaimError("");

    const validationError = validatePublicClaimForm(claimForm);
    if (validationError) {
      setClaimError(validationError);
      setClaimSubmitting(false);
      return;
    }

    if (!shipment) {
      setClaimError("No se pudo encontrar el envío para asociar el reclamo.");
      setClaimSubmitting(false);
      return;
    }

    if (!claimForm.category) {
      setClaimError("Seleccioná qué problema tuviste con el envío.");
      setClaimSubmitting(false);
      return;
    }

    const claimType = resolveClaimType(
      claimForm.category,
      claimForm.damageSubtypes,
      claimForm.deliverySubtype
    );
    const description = buildClaimDescription({
      category: claimForm.category,
      damageSubtypes: claimForm.damageSubtypes,
      deliverySubtype: claimForm.deliverySubtype,
      staffDescription: claimForm.staffDescription,
      evidenceName: claimForm.evidence?.name,
    });

    if (!claimType || !description) {
      setClaimError("No se pudo determinar el tipo o la descripción del reclamo.");
      setClaimSubmitting(false);
      return;
    }

    try {
      const createdClaim = await publicTrackingApi.createClaim({
        tracking_id: shipment.tracking_id,
        claim_type: claimType,
        description,
        created_by: claimForm.createdBy,
        dni: claimForm.dni,
        damage_subtypes: claimForm.damageSubtypes.join(","),
        evidence: claimForm.evidence,
      });
      setClaimResult(createdClaim);
      setClaimOpen(false);
    } catch (error) {
      const e = error as { response?: { data?: { error?: string; message?: string } } };
      const msg = e.response?.data?.error ?? e.response?.data?.message;
      if (msg?.includes("no coinciden")) {
        setClaimError("Datos incorrectos");
      } else {
        setClaimError(
          msg ?? "No pudimos registrar el reclamo. Intentá nuevamente."
        );
      }
    } finally {
      setClaimSubmitting(false);
    }
  };

  const chronological = useMemo(() => [...events].reverse(), [events]);
  const lastUpdate = chronological.length > 0 ? chronological[0].timestamp : shipment?.updated_at;

  const hero = shipment ? statusHero(shipment) : null;
  const phaseInfo = shipment ? computePhaseInfo(shipment, events) : null;
  const eta = shipment ? etaSummary(shipment.estimated_delivery_at, shipment.status) : undefined;

  const skelLine = (w: "sm" | "md" | "lg") => (
    <div
      className="h-3.5 rounded-md bg-gradient-to-r from-[var(--bg-muted)] via-[var(--border)] to-[var(--bg-muted)] bg-[length:200%_100%] animate-[pt-skel_1.4s_ease-in-out_infinite] mb-3"
      style={{ width: w === "sm" ? "30%" : w === "md" ? "60%" : "90%" }}
    />
  );

  const toneBg = (tone: string) => {
    switch (tone) {
      case "success": return "from-[#059669] to-[#10b981]";
      case "info":    return "from-[#1e3a5f] to-[#2563eb]";
      case "warn":    return "from-[#b45309] to-[#f59e0b]";
      case "danger":  return "from-[#991b1b] to-[#ef4444]";
      case "muted":   return "from-[#4b5563] to-[#6b7280]";
      default:        return "from-[#1e3a5f] to-[#2563eb]";
    }
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg-page)] font-[system-ui,-apple-system,Segoe_UI,Roboto,sans-serif] text-[var(--text-primary)] pb-6">
      <header className="bg-[#1e3a5f] text-white px-10 py-[18px] flex items-center gap-3 max-sm:px-4 max-sm:py-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-black text-[22px] tracking-[1px] max-sm:text-lg">LogiTrack</span>
          <span className="text-[#93c5fd] text-[15px] font-normal max-sm:text-[13px]">· Seguimiento de envíos</span>
        </div>
      </header>

      <section className="bg-gradient-to-br from-[#1e3a5f] to-[#2563eb] px-10 py-[52px] text-center max-sm:px-4 max-sm:py-8">
        <h1 className="text-white m-0 mb-2 text-[30px] font-extrabold max-sm:text-[22px]">¿Dónde está mi envío?</h1>
        <p className="text-[#bfdbfe] m-0 mb-7 text-base max-sm:text-sm max-sm:mb-5">Ingresá tu número de seguimiento para ver el estado actual</p>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-[560px] mx-auto max-sm:flex-col max-sm:gap-2" role="search" aria-label="Buscar envío">
          <label htmlFor="pt-tracking-input" className="sr-only">Número de seguimiento</label>
          <input
            id="pt-tracking-input"
            className="flex-1 py-3.5 px-[18px] rounded-[10px] border-2 border-transparent text-base outline-none shadow-[0_2px_8px_rgba(0,0,0,0.15)] uppercase focus:border-[var(--warn)] placeholder:normal-case placeholder:text-[var(--text-muted)] max-sm:py-3 max-sm:px-3.5 max-sm:text-[15px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ej. LT-A1B2C3D4"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Número de seguimiento"
          />
          <button
            type="submit"
            className="bg-[var(--warn)] text-[#1e3a5f] border-none rounded-[10px] px-7 py-3.5 cursor-pointer font-bold text-base whitespace-nowrap transition-[background,opacity] duration-[120ms] hover:not-disabled:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-70 max-sm:px-[18px] max-sm:py-3 max-sm:text-sm"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Buscando..." : "Rastrear"}
          </button>
        </form>
        <details className="mt-3.5 mx-auto max-w-[560px] text-left text-[#e2e8f0] max-sm:text-center">
          <summary className="cursor-pointer text-[13px] font-semibold text-[#dbeafe]">Ejemplos válidos para probar</summary>
          <div className="flex flex-wrap gap-2 pt-2.5 max-sm:justify-center">
            {EXAMPLE_TRACKING_IDS.map((item) => (
              <button
                key={item.trackingId}
                type="button"
                className="bg-[rgba(15,23,42,0.45)] border border-[rgba(191,219,254,0.35)] text-[#e2e8f0] rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer text-left disabled:opacity-70 disabled:cursor-not-allowed"
                onClick={() => handleExampleClick(item.trackingId)}
                disabled={loading}
              >
                <span className="block text-xs font-bold text-[#e2e8f0]">{item.trackingId}</span>
                <span className="block mt-0.5 text-[11px] font-medium text-[rgba(226,232,240,0.85)]">
                  Remitente: {item.sender.name} (DNI {item.sender.dni}) · Destinatario: {item.recipient.name} (DNI {item.recipient.dni})
                </span>
              </button>
            ))}
          </div>
        </details>
        <p className="text-[rgba(191,219,254,0.85)] text-[13px] mt-3.5 mb-0">Tu número aparece en el comprobante o en el mail de confirmación.</p>
      </section>

      <main className="max-w-[720px] mx-auto px-5 py-10 max-sm:px-3.5 max-sm:py-6 max-[768px]:pb-[100px]" aria-live="polite">
        {error && (
          <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-[10px] p-4 text-[var(--danger-text)] text-center text-[15px]" role="alert">
            {error}
          </div>
        )}

        {loading && !shipment && (
          <div className="bg-[var(--bg-card)] rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6 mb-5" aria-hidden="true">
            {skelLine("sm")}
            {skelLine("md")}
            {skelLine("lg")}
            {skelLine("md")}
          </div>
        )}

        {shipment && hero && phaseInfo && (
          <>
            <section
              className={`rounded-xl p-6 mb-5 text-white flex items-center gap-[18px] shadow-[0_4px_14px_rgba(0,0,0,0.1)] bg-gradient-to-br ${toneBg(hero.tone)} max-sm:p-[18px] max-sm:gap-3.5`}
              aria-label="Estado del envío"
            >
              <div className="text-[40px] leading-none max-sm:text-[32px]" aria-hidden="true">
                {hero.icon}
              </div>
              <div>
                <h2 className="text-[22px] font-extrabold m-0 max-sm:text-lg">{hero.title}</h2>
                <p className="mt-1 mb-0 text-sm opacity-[0.92]">{hero.subtitle}</p>
              </div>
            </section>

            {shipment.is_returning && shipment.status !== "returned" && (
              <div className="rounded-[10px] p-[14px_18px] mb-5 flex items-start gap-3 text-sm leading-[1.4] bg-[var(--warn-bg)] border border-[var(--warn)] text-[var(--warn-text)]" role="status">
                <span className="text-[22px] leading-none shrink-0" aria-hidden="true">
                  <CornerUpLeft className="w-5 h-5" />
                </span>
                <div>
                  <p className="font-bold m-0 mb-0.5">Volviendo al remitente</p>
                  <p className="m-0">Este envío inició su devolución y está viajando de regreso.</p>
                </div>
              </div>
            )}

            {(shipment.delivery_attempts ?? 0) > 0 && shipment.status !== "delivered" && shipment.status !== "returned" && (
              <div className="rounded-[10px] p-[14px_18px] mb-5 flex items-start gap-3 text-sm leading-[1.4] bg-[var(--warn-bg)] border border-[var(--warn)] text-[var(--warn-text)]" role="status">
                <span className="text-[22px] leading-none shrink-0" aria-hidden="true">
                  <Repeat className="w-5 h-5" />
                </span>
                <div>
                  <p className="font-bold m-0 mb-0.5">
                    {shipment.delivery_attempts === 1 ? "1 intento de entrega" : `${shipment.delivery_attempts} intentos de entrega`}
                    {shipment.max_delivery_attempts != null && shipment.delivery_attempts != null && (
                      <span className="font-normal ml-1.5 opacity-80">
                        — {(() => {
                            const left = Math.max(0, shipment.max_delivery_attempts - shipment.delivery_attempts);
                            if (left === 0) return "disponible para retiro en sucursal";
                            return `${left} ${left === 1 ? "intento restante" : "intentos restantes"}`;
                          })()}
                      </span>
                    )}
                  </p>
                  <p className="m-0">
                    {shipment.status === "redelivery_scheduled"
                      ? "Vamos a hacer un nuevo intento de entrega."
                      : shipment.status === "ready_for_pickup"
                      ? "Tu envío te espera para retiro en sucursal."
                      : shipment.max_delivery_attempts != null && shipment.delivery_attempts != null && shipment.delivery_attempts >= shipment.max_delivery_attempts
                      ? null
                      : "Coordinaremos los próximos pasos según el estado actual."}
                  </p>
                </div>
              </div>
            )}

            <section className="bg-[var(--bg-card)] rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6 mb-5 max-sm:p-[18px]" aria-label="Progreso del envío">
              <h2 className="text-[13px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.6px] m-0 mb-4">Progreso</h2>
              <ol className="flex items-stretch gap-1.5 list-none p-0 m-0 max-sm:gap-1">
                {phaseInfo.phases.map((p, i) => {
                  const { state, pct } = phaseInfo.states[i];
                  const label =
                    state === "failed" && phaseInfo.failedPhaseLabel != null
                      ? phaseInfo.failedPhaseLabel
                      : p.label;

                  const barBg = state === "done"
                    ? "var(--ok)"
                    : state === "failed"
                    ? "var(--danger-c)"
                    : state === "active"
                    ? `linear-gradient(90deg, var(--ok) ${pct}%, var(--border) ${pct}%)`
                    : state === "warn"
                    ? `linear-gradient(90deg, #f59e0b ${pct}%, var(--border) ${pct}%)`
                    : "var(--border)";

                  const labelColor = state === "done" || state === "active" || state === "warn"
                    ? "text-[var(--text-primary)]"
                    : state === "failed"
                    ? "text-[var(--danger-text)]"
                    : "text-[var(--text-secondary)]";

                  return (
                    <li
                      key={p.key}
                      className="flex-1 flex flex-col items-center gap-2 text-center relative"
                      aria-current={state === "active" || state === "warn" ? "step" : undefined}
                    >
                      <div className="w-full h-1.5 rounded-full" style={{ background: barBg }} aria-hidden="true" />
                      <span className={`text-xs font-semibold leading-[1.25] max-sm:text-[11px] ${labelColor}`}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="bg-[var(--bg-card)] rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6 mb-5 max-sm:p-[18px]" aria-label="Resumen del envío">
              <div className="flex justify-between items-start flex-wrap gap-3">
                <div>
                  <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Número de seguimiento</div>
                  <code className="text-[22px] font-extrabold text-[var(--text-heading)] font-mono tracking-[0.5px] max-sm:text-lg">{shipment.tracking_id}</code>
                </div>
              </div>

              <div className="mt-[18px] grid grid-cols-2 gap-[18px_24px] max-sm:grid-cols-1 max-sm:gap-3.5">
                {eta && (
                  <div>
                    <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Entrega estimada</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">{eta.line}</div>
                    {eta.rel && <div className="text-[13px] text-[var(--text-secondary)] mt-0.5">{eta.rel}</div>}
                  </div>
                )}
                {shipment.delivered_at && (
                  <div>
                    <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Entregado</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">{fmtDateTime(shipment.delivered_at)}</div>
                    <div className="text-[13px] text-[var(--text-secondary)] mt-0.5">{fmtRelative(shipment.delivered_at)}</div>
                  </div>
                )}
                {lastUpdate && shipment.status !== "delivered" && (
                  <div>
                    <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Última actualización</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">{fmtDateTime(lastUpdate)}</div>
                    <div className="text-[13px] text-[var(--text-secondary)] mt-0.5">{fmtRelative(lastUpdate)}</div>
                  </div>
                )}
                {timeWindowLabel(shipment.time_window) && shipment.delivery_method !== "retiro_sucursal" && (
                  <div>
                    <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Ventana horaria</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">{timeWindowLabel(shipment.time_window)}</div>
                  </div>
                )}
                {deliveryMethodLabel(shipment.delivery_method) && (
                  <div>
                    <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Modalidad</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">{deliveryMethodLabel(shipment.delivery_method)}</div>
                  </div>
                )}
                <div>
                  <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Tipo</div>
                  <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                    {shipmentTypeLabel(shipment.shipment_type)}
                    {shipment.is_fragile && " · Frágil"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-[18px] pt-[18px] border-t border-[var(--border)] max-sm:gap-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Origen</div>
                  <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                    {shipment.origin.city}, {shipment.origin.province}
                  </div>
                </div>
                <ArrowRight className="shrink-0 text-[var(--text-muted)] max-sm:w-3.5 max-sm:h-3.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.5px] mb-1">Destino</div>
                  <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                    {shipment.destination.city}, {shipment.destination.province}
                  </div>
                </div>
              </div>
            </section>

            {chronological.length > 0 && (
              <section className="bg-[var(--bg-card)] rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-7 max-sm:p-[18px]" aria-label="Historial del envío">
                <h2 className="text-[15px] font-bold text-[var(--text-heading)] m-0 mb-6">Historial del envío</h2>
                <ol className="relative list-none p-0 m-0 before:content-[''] before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--border)]">
                  {chronological.map((ev, i) => {
                    const isCurrent = i === 0;
                    const desc = describeEvent(ev, branches);
                    const eventTime = ev.event_type === "claim_created" && ev.claim_updated_at
                      ? ev.claim_updated_at
                      : ev.timestamp;
                    return (
                      <li key={ev.id} className="flex gap-4 relative pb-6 last:pb-0">
                        <div
                          className={`shrink-0 w-10 h-10 rounded-full bg-[var(--bg-muted)] border-2 border-[var(--border)] flex items-center justify-center text-lg z-[1] ${
                            isCurrent ? "!bg-[#1e3a5f] !border-[#1e3a5f] shadow-[0_0_0_4px_var(--brand-tint)]" : ""
                          }`}
                          aria-current={isCurrent ? "step" : undefined}
                          aria-hidden="true"
                        >
                          {desc.icon}
                        </div>
                        <div className="pt-1.5 min-w-0">
                          <div className={`text-sm leading-[1.3] ${isCurrent ? "font-bold text-[var(--text-primary)]" : "font-medium text-[var(--text-strong)]"}`}>
                            {desc.title}
                          </div>
                          {desc.subtitle && (
                            <div className="text-[13px] text-[var(--text-secondary)] mt-[3px]">
                              {desc.subtitle}
                            </div>
                          )}
                          <div className="text-xs text-[var(--text-muted)] mt-1">
                            {fmtDateTime(eventTime)} · <span className="text-[var(--text-secondary)] font-medium">{fmtRelative(eventTime)}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <section className="bg-[var(--bg-card)] rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-6 mt-5 max-sm:p-[18px]" aria-label="Reclamos">
              <div className="flex items-start justify-between gap-4 mb-4 max-sm:flex-col max-sm:items-stretch">
                <div>
                  <h2 className="m-0 mb-1.5 text-base font-extrabold text-[var(--text-heading)]">¿Tuviste algún inconveniente con este envío?</h2>
                  <p className="m-0 text-sm text-[var(--text-secondary)]">Podemos ayudarte con un reclamo y darte seguimiento.</p>
                </div>
                <button
                  type="button"
                  className="bg-[#1e3a5f] text-white border-none rounded-[10px] py-2.5 px-4 font-bold cursor-pointer whitespace-nowrap transition-[background,opacity] duration-[120ms] hover:not-disabled:bg-[#274a78] disabled:opacity-70 disabled:cursor-not-allowed"
                  onClick={() => setClaimOpen((prev) => !prev)}
                  disabled={claimSubmitting || !!claimResult}
                >
                  Solicitar ayuda
                </button>
              </div>

              {claimResult && (
                <div className="bg-[var(--ok-bg)] border border-[var(--ok-border)] text-[var(--ok-text)] rounded-[10px] p-[12px_14px] mb-4" role="status">
                  <div className="font-bold mb-0.5">Reclamo creado</div>
                  <div className="text-[13px]">
                    Código: <strong>{claimResult.id}</strong> · Estado: {CLAIM_STATUS_LABELS[claimResult.status]}
                  </div>
                </div>
              )}

              {claimOpen && !claimResult && (
                <form className="flex flex-col gap-3.5" onSubmit={handleClaimSubmit}>
                  <PublicClaimFormFields
                    values={claimForm}
                    onChange={patchClaimForm}
                    disabled={claimSubmitting}
                  />

                  {claimError && <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)] p-2.5 rounded-lg text-[13px]" role="alert">{claimError}</div>}

                  <div className="flex justify-end gap-2.5 max-sm:flex-col max-sm:items-stretch">
                    <button type="button" className="bg-[var(--bg-muted)] text-[var(--text-primary)] border-none rounded-[10px] py-2.5 px-4 font-semibold cursor-pointer" onClick={() => setClaimOpen(false)}>
                      Cancelar
                    </button>
                    <button type="submit" className="bg-[var(--warn)] text-[#1e3a5f] border-none rounded-[10px] py-2.5 px-4 font-bold cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed" disabled={claimSubmitting}>
                      {claimSubmitting ? "Enviando..." : "Enviar reclamo"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}

        {!shipment && !error && !loading && (
          <div className="text-center text-[var(--text-muted)] mt-8 text-[15px]">
            <p>Ingresá un número de seguimiento para comenzar.</p>
            <p className="mt-3 text-[13px] text-[var(--text-secondary)]">
              Formato: <code className="bg-[var(--bg-muted)] px-1.5 py-0.5 rounded font-mono text-[var(--text-primary)]">LT-XXXXXXXX</code>
            </p>
          </div>
        )}
      </main>

      <footer className="text-center px-5 py-6 text-[var(--text-muted)] text-[13px] border-t border-[var(--border)] mt-10 max-[768px]:mb-20">
        © {new Date().getFullYear()} LogiTrack · Seguimiento de envíos
      </footer>
      <ChatbotWidget />
    </div>
  );
}
