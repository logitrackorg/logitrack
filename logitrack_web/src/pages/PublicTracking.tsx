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
import { fmtDateTime, fmtRelative, fmtDate } from "../utils/date";
import { ChatbotWidget } from "../components/chatbot/ChatbotWidget";
import { useOrganizationTheme } from "../context/OrganizationThemeContext";
import { Button } from "../components/ui/button";
import {
  Search,
  Truck,
  Building2,
  PackageCheck,
  Bike,
  AlertTriangle,
  Store,
  Undo2,
  Ban,
  MessageSquare,
  ArrowRight,
  Clock,
  Weight,
  Hash,
  AlertCircle,
  PackageSearch,
  CheckCircle2,
  Package,
  RefreshCw,
  MapPin,
  CornerUpLeft,
  Circle,
  Flame,
} from "lucide-react";
import type { ReactNode } from "react";

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const EXAMPLE_TRACKING_IDS = [
  "LT-LM00001",
  "LT-PICKUP01",
  "LT-CDB00001",
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

// Public-friendly status descriptions — never expose internal codes.
const STATUS_FRIENDLY_LABELS: Record<ShipmentStatus, string> = {
  draft: "Borrador",
  pending_payment: "Pago pendiente",
  at_origin_hub: "Registrado en sucursal de origen",
  loaded: "Cargado y listo para despachar",
  in_transit: "Tu paquete está en camino",
  at_hub: "Llegó a un centro logístico",
  out_for_delivery: "Salió a reparto — llega hoy",
  delivery_failed: "El repartidor no pudo entregar",
  redelivery_scheduled: "Reentrega programada",
  no_entregado: "No pudo ser entregado",
  rechazado: "Envío rechazado por el destinatario",
  delivered: "¡Entregado!",
  ready_for_pickup: "Listo para retirar en sucursal",
  ready_for_return: "Preparando devolución al remitente",
  returned: "Devuelto al remitente",
  cancelled: "Envío cancelado",
  lost: "Envío extraviado",
  destroyed: "Envío destruido",
  expired: "Borrador expirado",
};

// 4-step progress for public view
const PROGRESS_STEPS = [
  { key: "received", label: "Recibido" },
  { key: "in_transit", label: "En camino" },
  { key: "at_hub", label: "En sucursal" },
  { key: "delivered", label: "Entregado" },
] as const;

const TERMINAL_FAILED: ShipmentStatus[] = [
  "cancelled", "lost", "destroyed", "rechazado", "no_entregado",
];

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

type StatusTone = "success" | "info" | "warn" | "danger" | "muted";

interface StatusHero {
  tone: StatusTone;
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
        icon: <PackageCheck className={icnHero} />,
        title: "¡Tu envío fue entregado!",
        subtitle: s.delivered_at
          ? `Entregado el ${fmtDateTime(s.delivered_at)}`
          : "Listo y entregado.",
      };
    case "returned":
      return {
        tone: "muted",
        icon: <Undo2 className={icnHero} />,
        title: "Envío devuelto al remitente",
        subtitle: "Cerramos este envío con devolución completa.",
      };
    case "cancelled":
      return {
        tone: "muted",
        icon: <Ban className={icnHero} />,
        title: "Envío cancelado",
        subtitle: "Este envío fue cancelado y no continuará su viaje.",
      };
    case "lost":
      return {
        tone: "danger",
        icon: <Search className={icnHero} />,
        title: "Envío extraviado",
        subtitle: "Estamos investigando su paradero. Te contactaremos pronto.",
      };
    case "destroyed":
      return {
        tone: "danger",
        icon: <Flame className={icnHero} />,
        title: "Daño total",
        subtitle: "El envío sufrió un daño irreparable y no podrá ser entregado.",
      };
    case "delivery_failed":
    case "redelivery_scheduled":
      return {
        tone: "warn",
        icon: <AlertTriangle className={icnHero} />,
        title: "Intento de entrega fallido",
        subtitle: STATUS_FRIENDLY_LABELS[s.status],
      };
    case "no_entregado":
    case "rechazado":
      return {
        tone: "danger",
        icon: <Ban className={icnHero} />,
        title: STATUS_FRIENDLY_LABELS[s.status],
        subtitle: "Coordiná con el remitente los próximos pasos.",
      };
    case "out_for_delivery":
      return {
        tone: "info",
        icon: <Bike className={icnHero} />,
        title: "Tu envío está en camino",
        subtitle: s.relative_hours != null
          ? formatEtaHoursMessage(s.relative_hours)
          : (etaHoursMessage(s.estimated_delivery_at) ?? "Tu envío está en camino a tu domicilio."),
      };
    case "in_transit":
      return {
        tone: "info",
        icon: <Truck className={icnHero} />,
        title: "Tu envío está en tránsito",
        subtitle: etaHoursMessage(s.estimated_delivery_at) ?? STATUS_FRIENDLY_LABELS.in_transit,
      };
    case "loaded":
      return {
        tone: "info",
        icon: <Package className={icnHero} />,
        title: "Tu envío está en camino",
        subtitle: STATUS_FRIENDLY_LABELS.loaded,
      };
    case "ready_for_pickup":
      return {
        tone: "info",
        icon: <Store className={icnHero} />,
        title: "Listo para retirar",
        subtitle: "Te esperamos en la sucursal con tu DNI.",
      };
    default:
      return {
        tone: "info",
        icon: <Truck className={icnHero} />,
        title: "Tu envío está en camino",
        subtitle: STATUS_FRIENDLY_LABELS[s.status] ?? "",
      };
  }
}

function computeProgressStep(status: ShipmentStatus): { step: number; completed: boolean } {
  if (status === "delivered" || status === "returned") return { step: 3, completed: true };
  if (TERMINAL_FAILED.includes(status)) return { step: -1, completed: false };

  switch (status) {
    case "pending_payment":
    case "at_origin_hub":
      return { step: 0, completed: false };
    case "loaded":
    case "in_transit":
    case "ready_for_return":
      return { step: 1, completed: false };
    case "at_hub":
    case "out_for_delivery":
    case "delivery_failed":
    case "redelivery_scheduled":
    case "ready_for_pickup":
      return { step: 2, completed: false };
    default:
      return { step: 0, completed: false };
  }
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

function etaSummary(
  iso: string | null,
  status: ShipmentStatus,
): { line: string; rel?: string } | undefined {
  if (!iso) return undefined;
  const HIDE: ShipmentStatus[] = [
    "delivered", "returned", "cancelled", "lost", "destroyed",
    "draft", "at_origin_hub",
  ];
  if ((HIDE as string[]).includes(status)) return undefined;
  return { line: fmtDateTime(iso), rel: fmtRelative(iso) };
}

function friendlyLocation(cityLine: string | undefined): string | undefined {
  if (!cityLine) return undefined;
  // Strip branch internal codes like "CDBA-01"
  return cityLine.replace(/^[A-Z]{4}-\d{2}\s*[-–]\s*/, "");
}

// ────────────────────────────────────────────────────────────────
// Event description for timeline
// ────────────────────────────────────────────────────────────────

interface EventDesc {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

const icnEv = "w-4 h-4 shrink-0";

function describeEvent(
  ev: PublicShipmentEvent,
  branches: Branch[],
): EventDesc {
  if (ev.event_type === "claim_created") {
    const label = ev.claim_status ? CLAIM_STATUS_LABELS[ev.claim_status] ?? "Abierto" : "Abierto";
    return { icon: <MessageSquare className={icnEv} />, title: `Reclamo · ${label}` };
  }

  if (ev.event_type === "rescheduled" && ev.current_location && ev.rescheduled_date) {
    const locText = ev.current_location.type === "DESTINATION_BRANCH"
      ? "En sucursal destino"
      : ev.current_location.type === "ORIGIN_BRANCH"
        ? "En sucursal origen"
        : "En tránsito";
    const date = fmtDate(ev.rescheduled_date);
    return {
      icon: <MapPin className={icnEv} />,
      title: `${locText} - ${ev.current_location.status}`,
      subtitle: `Entrega reprogramada para el ${date}`,
    };
  }

  const loc = ev.location;
  const branch = loc
    ? (branches.find((b) => b.address.city === loc) ?? branches.find((b) => b.id === loc))
    : undefined;
  const cityLine = friendlyLocation(
    branch ? `${branch.address.city}, ${branch.province}` : (loc ?? undefined),
  );
  const { from_status: from, to_status: to } = ev;

  // Map to → friendly label with city where applicable
  if (!from && to === "at_origin_hub") return { icon: <Package className={icnEv} />, title: "Envío registrado", subtitle: cityLine };
  if (!from && to === "draft")          return { icon: <Package className={icnEv} />, title: "Borrador creado" };
  if (from === "draft" && to === "at_origin_hub") return { icon: <CheckCircle2 className={icnEv} />, title: "Envío confirmado", subtitle: cityLine };
  if (to === "loaded")                  return { icon: <Truck className={icnEv} />, title: "Cargado y listo para despachar", subtitle: cityLine };
  if (to === "in_transit")              return { icon: <Truck className={icnEv} />, title: "Despachado — en tránsito" };
  if (to === "at_hub" || to === "at_origin_hub") return { icon: <Building2 className={icnEv} />, title: "Llegó al centro logístico", subtitle: cityLine };
  if (to === "out_for_delivery")        return { icon: <Bike className={icnEv} />, title: "En camino a domicilio", subtitle: cityLine };
  if (to === "delivered")               return { icon: <PackageCheck className={icnEv} />, title: "Envío entregado" };
  if (to === "delivery_failed")         return { icon: <AlertTriangle className={icnEv} />, title: "El intento de entrega no fue exitoso" };
  if (to === "redelivery_scheduled")    return { icon: <RefreshCw className={icnEv} />, title: "Reentrega programada" };
  if (to === "no_entregado")            return { icon: <Ban className={icnEv} />, title: "No pudo ser entregado" };
  if (to === "rechazado")               return { icon: <Ban className={icnEv} />, title: "Envío rechazado por el destinatario" };
  if (to === "ready_for_pickup")        return { icon: <Store className={icnEv} />, title: "Disponible para retiro en sucursal", subtitle: cityLine };
  if (to === "ready_for_return")        return { icon: <CornerUpLeft className={icnEv} />, title: "En espera de devolución al remitente", subtitle: cityLine };
  if (to === "returned")                return { icon: <Undo2 className={icnEv} />, title: "Devuelto al remitente" };
  if (to === "cancelled")               return { icon: <Ban className={icnEv} />, title: "Envío cancelado" };
  if (to === "lost")                    return { icon: <Search className={icnEv} />, title: "Envío extraviado" };
  if (to === "destroyed")               return { icon: <Flame className={icnEv} />, title: "Daño total — envío destruido" };
  return { icon: <Circle className={icnEv} />, title: STATUS_FRIENDLY_LABELS[to] ?? to, subtitle: cityLine };
}

// Status tone → gradient CSS classes (Tailwind, no hardcoded hex)
function toneGradient(tone: StatusTone): string {
  switch (tone) {
    case "success": return "from-emerald-600 to-emerald-500";
    case "info":    return "from-[var(--brand)] to-[var(--brand-strong)]";
    case "warn":    return "from-amber-600 to-amber-500";
    case "danger":  return "from-red-700 to-red-500";
    case "muted":   return "from-slate-500 to-slate-400";
    default:        return "from-[var(--brand)] to-[var(--brand-strong)]";
  }
}

// ────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────

export function PublicTracking() {
  const { config: org } = useOrganizationTheme();
  const orgName = org?.name?.trim() || "LogiTrack";
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

  // Fetch public branches on mount
  useEffect(() => {
    publicTrackingApi.getBranches().then(setBranches).catch(() => {});
  }, []);

  // Search from URL param on mount / param change
  useEffect(() => {
    const id = searchParams.get("id");
    if (id) runSearch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      claimForm.deliverySubtype,
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
    } catch (err) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      const msg = e.response?.data?.error ?? e.response?.data?.message;
      if (msg?.includes("no coinciden")) {
        setClaimError("Datos incorrectos");
      } else {
        setClaimError(msg ?? "No pudimos registrar el reclamo. Intentá nuevamente.");
      }
    } finally {
      setClaimSubmitting(false);
    }
  };

  // Derived
  const chronological = useMemo(() => [...events].reverse(), [events]);
  const lastUpdate = chronological.length > 0 ? chronological[0].timestamp : shipment?.updated_at;

  const hero = shipment ? statusHero(shipment) : null;
  const progress = shipment ? computeProgressStep(shipment.status) : null;
  const eta = shipment ? etaSummary(shipment.estimated_delivery_at, shipment.status) : undefined;

  const isFailed = shipment ? TERMINAL_FAILED.includes(shipment.status) : false;

  return (
    <div className="relative min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] font-sans pb-6">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-[var(--bg-card)]/[0.92] border-b border-[var(--border)] backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 max-sm:px-3">
          {org?.logo_url ? (
            <img
              src={org.logo_url}
              alt={org.name ?? "Organización"}
              className="h-8 w-auto rounded"
            />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-[var(--text-heading)] text-lg tracking-tight">{orgName}</span>
              <span className="text-[var(--text-muted)] text-sm max-sm:text-xs">
                · Seguimiento
              </span>
            </div>
          )}
          {org?.name && (
            <span className="text-[var(--text-secondary)] text-sm font-medium ml-auto truncate max-w-[200px]">
              {org.name}
            </span>
          )}
        </div>
      </header>

      {/* ── Hero / Search ── */}
      <section className="bg-gradient-to-br from-[var(--brand)] to-[var(--brand-strong)] px-4 py-14 text-center max-sm:py-10">
        <h1 className="text-white text-4xl font-bold mb-2 tracking-tight leading-[1.15] max-sm:text-2xl">
          ¿Dónde está mi envío?
        </h1>
        <p className="text-white/80 text-base mb-7 max-sm:text-sm max-sm:mb-5">
          Ingresá tu número de seguimiento para ver el estado actual
        </p>

        {/* Search form */}
        <form
          onSubmit={handleSearch}
          className="flex gap-2 max-w-lg mx-auto max-sm:flex-col max-sm:gap-2"
          role="search"
          aria-label="Buscar envío"
        >
          <label htmlFor="pt-tracking-input" className="sr-only">
            Número de seguimiento
          </label>
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              id="pt-tracking-input"
              className="w-full pl-10 pr-4 py-3.5 rounded-xl border-2 border-blue-200 dark:border-gray-600 text-base bg-white dark:bg-gray-800 dark:text-gray-100 outline-none shadow-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all uppercase"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ej. LT-LM00001"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Número de seguimiento"
            />
          </div>
          <Button
            type="submit"
            className="bg-white text-[var(--brand-strong)] rounded-xl px-6 py-3.5
                       font-bold text-base whitespace-nowrap shadow-sm shadow-blue-500/20
                       hover:bg-white/90 max-sm:px-5 max-sm:py-3 max-sm:text-sm"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Buscando..." : "Rastrear"}
          </Button>
        </form>

        {/* Example chips */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <span className="text-white/60 text-xs self-center mr-1 max-sm:hidden">Ejemplos:</span>
          {EXAMPLE_TRACKING_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs font-mono font-semibold hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer disabled:opacity-40"
              onClick={() => handleExampleClick(id)}
              disabled={loading}
            >
              <Hash className="w-3 h-3 opacity-70" />
              {id}
            </button>
          ))}
        </div>

        <p className="text-white/60 text-xs mt-3">
          Tu número aparece en el comprobante o en el mail de confirmación.
        </p>
      </section>

      {/* ── Main content ── */}
      <main
        className="max-w-3xl mx-auto px-4 py-8 max-sm:px-3 max-sm:py-6"
        aria-live="polite"
      >
        {/* ── Error state ── */}
        {error && (
          <div className="space-y-4" role="alert">
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">No encontramos tu envío</p>
                <p className="text-xs text-red-600 mt-0.5">{error}</p>
              </div>
            </div>
            <Button
              variant="default"
              size="sm"
              className="gap-2 rounded-xl shadow-sm shadow-blue-500/20"
              onClick={() => query.trim() && runSearch(query.trim())}
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </Button>
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && !shipment && (
          <div className="space-y-4" aria-hidden="true">
            <div className="bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border)] p-6">
              <div className="h-4 w-1/3 rounded-md bg-[var(--bg-muted)] animate-pulse mb-4" />
              <div className="h-3 w-2/3 rounded-md bg-[var(--bg-muted)] animate-pulse mb-3" />
              <div className="h-3 w-1/2 rounded-md bg-[var(--bg-muted)] animate-pulse" />
            </div>
            <div className="bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border)] p-6">
              <div className="h-4 w-1/4 rounded-md bg-[var(--bg-muted)] animate-pulse mb-4" />
              <div className="h-3 w-full rounded-md bg-[var(--bg-muted)] animate-pulse mb-3" />
              <div className="h-3 w-3/4 rounded-md bg-[var(--bg-muted)] animate-pulse" />
            </div>
          </div>
        )}

        {/* ── Empty state (no search yet) ── */}
        {!shipment && !error && !loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <PackageSearch className="w-16 h-16 text-[var(--text-muted)]" />
            <p className="text-[var(--text-muted)] text-base">
              Ingresá un número de seguimiento para empezar.
            </p>
            <p className="text-[var(--text-secondary)] text-sm">
              Formato:{" "}
              <code className="bg-[var(--bg-muted)] px-1.5 py-0.5 rounded font-mono text-[var(--text-primary)]">
                LT-XXXXXXXX
              </code>
            </p>
          </div>
        )}

        {/* ── Shipment data ── */}
        {shipment && hero && (
          <div className="space-y-5">
            {/* Status hero card */}
            <section
              className={`rounded-xl p-6 text-white flex items-center gap-5 shadow-lg
                          bg-gradient-to-br ${toneGradient(hero.tone)}
                          animate-[fadeIn_0.4s_ease-out] motion-reduce:animate-none
                          max-sm:p-4 max-sm:gap-3`}
              aria-label="Estado del envío"
            >
              <div className="shrink-0" aria-hidden="true">{hero.icon}</div>
              <div>
                <h2 className="text-xl font-extrabold max-sm:text-lg">{hero.title}</h2>
                <p className="mt-1 text-sm opacity-90">{hero.subtitle}</p>
              </div>
            </section>

            {/* Return banner */}
            {shipment.is_returning && shipment.status !== "returned" && (
              <div
                className="rounded-xl p-4 flex items-start gap-3 text-sm
                           bg-[var(--warn-bg)] border border-[var(--warn)] text-[var(--warn-text)]
                           animate-[fadeIn_0.4s_ease-out_0.1s_both] motion-reduce:animate-none"
                role="status"
              >
                <CornerUpLeft className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-0.5">Volviendo al remitente</p>
                  <p>Este envío inició su devolución y está viajando de regreso.</p>
                </div>
              </div>
            )}

            {/* Delivery attempts banner */}
            {(shipment.delivery_attempts ?? 0) > 0 &&
             shipment.status !== "delivered" &&
             shipment.status !== "returned" && (
              <div
                className="rounded-xl p-4 flex items-start gap-3 text-sm
                           bg-[var(--warn-bg)] border border-[var(--warn)] text-[var(--warn-text)]
                           animate-[fadeIn_0.4s_ease-out_0.15s_both] motion-reduce:animate-none"
                role="status"
              >
                <RefreshCw className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-0.5">
                    {shipment.delivery_attempts === 1
                      ? "1 intento de entrega"
                      : `${shipment.delivery_attempts} intentos de entrega`}
                    {shipment.max_delivery_attempts != null &&
                     shipment.delivery_attempts != null && (
                      <span className="font-normal ml-1.5 opacity-80">
                        — {(() => {
                          const left = Math.max(0, shipment.max_delivery_attempts - shipment.delivery_attempts);
                          if (left === 0) return "disponible para retiro en sucursal";
                          return `${left} ${left === 1 ? "intento restante" : "intentos restantes"}`;
                        })()}
                      </span>
                    )}
                  </p>
                  <p>
                    {shipment.status === "redelivery_scheduled"
                      ? "Vamos a hacer un nuevo intento de entrega."
                      : shipment.status === "ready_for_pickup"
                        ? "Tu envío te espera para retiro en sucursal."
                        : shipment.max_delivery_attempts != null &&
                          shipment.delivery_attempts != null &&
                          shipment.delivery_attempts >= shipment.max_delivery_attempts
                          ? null
                          : "Coordinaremos los próximos pasos según el estado actual."}
                  </p>
                </div>
              </div>
            )}

            {/* Progress bar */}
            {!isFailed && (
              <section
                className="bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border)] p-6
                           animate-[fadeIn_0.4s_ease-out_0.2s_both] motion-reduce:animate-none
                           max-sm:p-4"
                aria-label="Progreso del envío"
              >
                <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-5">
                  Progreso
                </h3>
                <div className="flex items-center gap-1">
                  {PROGRESS_STEPS.map((step, i) => {
                    const isDone = progress ? i < progress.step || (i === progress.step && progress.completed) : false;
                    const isActive = progress ? i === progress.step && !progress.completed : false;

                    return (
                      <div key={step.key} className="flex-1 flex flex-col items-center gap-2">
                        {/* Dot + line row */}
                        <div className="relative w-full flex items-center">
                          {/* Connecting line left (skip first) */}
                          {i > 0 && (
                            <div
                              className={`absolute right-1/2 left-0 h-1 rounded-full ${
                                isDone ? "bg-emerald-500" : "bg-[var(--border)]"
                              }`}
                            />
                          )}
                          {/* Connecting line right (skip last) */}
                          {i < PROGRESS_STEPS.length - 1 && (
                            <div
                              className={`absolute left-1/2 right-0 h-1 rounded-full ${
                                isDone ? "bg-emerald-500" : "bg-[var(--border)]"
                              }`}
                            />
                          )}
                          {/* Dot */}
                          <div
                            className={`relative z-10 mx-auto w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                              isDone
                                ? "bg-emerald-500 border-emerald-500"
                                : isActive
                                  ? "bg-[var(--brand)] border-[var(--brand)] animate-pulse motion-reduce:animate-none"
                                  : "bg-[var(--bg-card)] border-[var(--border)]"
                            }`}
                          >
                            {isDone && (
                              <CheckCircle2 className="w-3 h-3 text-white" />
                            )}
                            {isActive && (
                              <div className="w-1.5 h-1.5 rounded-full bg-white" />
                            )}
                          </div>
                        </div>
                        {/* Label */}
                        <span
                          className={`text-xs font-semibold text-center leading-tight ${
                            isDone || isActive
                              ? "text-[var(--text-primary)]"
                              : "text-[var(--text-muted)]"
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Info cards grid */}
            <section
              className="bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border)] p-6
                         animate-[fadeIn_0.4s_ease-out_0.25s_both] motion-reduce:animate-none
                         max-sm:p-4"
              aria-label="Resumen del envío"
            >
              {/* Tracking ID */}
              <div className="mb-5">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                  Número de seguimiento
                </div>
                <code className="text-xl font-extrabold text-[var(--text-heading)] font-mono tracking-widest max-sm:text-lg">
                  {shipment.tracking_id}
                </code>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                {eta && (
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-0.5">
                        Entrega estimada
                      </div>
                      <div className="font-semibold text-[var(--text-primary)]">{eta.line}</div>
                      {eta.rel && (
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5">{eta.rel}</div>
                      )}
                    </div>
                  </div>
                )}
                {shipment.delivered_at && (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-0.5">
                        Entregado
                      </div>
                      <div className="font-semibold text-[var(--text-primary)]">
                        {fmtDateTime(shipment.delivered_at)}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {fmtRelative(shipment.delivered_at)}
                      </div>
                    </div>
                  </div>
                )}
                {lastUpdate && shipment.status !== "delivered" && (
                  <div className="flex items-start gap-3">
                    <RefreshCw className="w-5 h-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-0.5">
                        Última actualización
                      </div>
                      <div className="font-semibold text-[var(--text-primary)]">
                        {fmtDateTime(lastUpdate)}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {fmtRelative(lastUpdate)}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <Weight className="w-5 h-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-0.5">
                      Tipo
                    </div>
                    <div className="font-semibold text-[var(--text-primary)]">
                      {shipment.shipment_type === "express" ? "Express" : "Estándar"}
                      {shipment.is_fragile && " · Frágil"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Origin → Destination */}
              <div className="flex items-center gap-3 mt-5 pt-5 border-t border-[var(--border)]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    Origen
                  </div>
                  <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    {shipment.origin.city}, {shipment.origin.province}
                  </div>
                </div>
                <ArrowRight className="shrink-0 text-[var(--text-muted)] w-5 h-5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                    Destino
                  </div>
                  <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    {shipment.destination.city}, {shipment.destination.province}
                  </div>
                </div>
              </div>
            </section>

            {/* Timeline */}
            {chronological.length > 0 && (
              <section
                className="bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border)] p-6
                           animate-[fadeIn_0.4s_ease-out_0.3s_both] motion-reduce:animate-none
                           max-sm:p-4"
                aria-label="Historial del envío"
              >
                <h3 className="text-base font-bold text-[var(--text-heading)] mb-6">
                  Historial del envío
                </h3>
                <ol className="relative list-none p-0 m-0
                               before:content-[''] before:absolute before:left-[15px] before:top-2 before:bottom-2
                               before:w-px before:bg-[var(--border)]">
                  {chronological.map((ev, i) => {
                    const isCurrent = i === 0;
                    const desc = describeEvent(ev, branches);
                    const eventTime =
                      ev.event_type === "claim_created" && ev.claim_updated_at
                        ? ev.claim_updated_at
                        : ev.timestamp;
                    return (
                      <li key={ev.id} className="flex gap-3 relative pb-5 last:pb-0">
                        {/* Dot */}
                        <div
                          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10
                                      border-2 transition-colors ${
                                        isCurrent
                                          ? "bg-[var(--brand)] border-[var(--brand)] shadow-sm shadow-blue-500/20"
                                          : "bg-[var(--bg-muted)] border-[var(--border)]"
                                      }`}
                          aria-current={isCurrent ? "step" : undefined}
                        >
                          <span className={isCurrent ? "text-white" : "text-[var(--text-secondary)]"}>
                            <span className="w-4 h-4">{desc.icon}</span>
                          </span>
                        </div>
                        {/* Content */}
                        <div className="pt-1 min-w-0">
                          <div
                            className={`text-sm leading-snug ${
                              isCurrent
                                ? "font-bold text-[var(--text-primary)]"
                                : "font-medium text-[var(--text-primary)]"
                            }`}
                          >
                            {desc.title}
                          </div>
                          {desc.subtitle && (
                            <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                              {desc.subtitle}
                            </div>
                          )}
                          <div
                            className="text-xs text-[var(--text-muted)] mt-1"
                            title={fmtDateTime(eventTime)}
                          >
                            {fmtRelative(eventTime)} — {fmtDateTime(eventTime)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* Claim section */}
            <section
              className="bg-[var(--bg-card)] rounded-xl shadow-sm border border-[var(--border)] p-6
                         animate-[fadeIn_0.4s_ease-out_0.35s_both] motion-reduce:animate-none
                         max-sm:p-4"
              aria-label="Reclamos"
            >
              {/* Claim button / header */}
              <div className="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-heading)] mb-1">
                    ¿Tuviste algún inconveniente con este envío?
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Podemos ayudarte con un reclamo y darte seguimiento.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="gap-2 rounded-xl border-blue-200 text-blue-700 whitespace-nowrap max-sm:w-full max-sm:justify-center"
                  onClick={() => setClaimOpen((prev) => !prev)}
                  disabled={claimSubmitting || !!claimResult}
                >
                  <MessageSquare className="w-4 h-4" />
                  {claimOpen ? "Cerrar" : "¿Algún problema? Hacé tu reclamo"}
                </Button>
              </div>

              {/* Success state */}
              {claimResult && (
                <div
                  className="mt-4 flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3"
                  role="status"
                >
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-green-700">Recibimos tu reclamo</p>
                    <p className="text-xs text-green-600 mt-0.5">
                      Código: <strong>{claimResult.id}</strong> · Estado:{" "}
                      {CLAIM_STATUS_LABELS[claimResult.status]}
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">
                      Te responderemos pronto.
                    </p>
                  </div>
                </div>
              )}

              {/* Claim form accordion */}
              {claimOpen && !claimResult && (
                <div className="mt-4">
                  <form className="flex flex-col gap-4" onSubmit={handleClaimSubmit}>
                    <PublicClaimFormFields
                      values={claimForm}
                      onChange={patchClaimForm}
                      disabled={claimSubmitting}
                    />

                    {claimError && (
                      <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3" role="alert">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                        <p className="text-sm text-red-700">{claimError}</p>
                      </div>
                    )}

                    <div className="flex justify-end gap-3 max-sm:flex-col max-sm:items-stretch pt-2">
                      <Button variant="outline" className="rounded-xl border-blue-200 text-blue-700" onClick={() => setClaimOpen(false)}>
                        Cancelar
                      </Button>
                      <Button type="submit" disabled={claimSubmitting} className="rounded-xl shadow-sm shadow-blue-500/20">
                        {claimSubmitting ? "Enviando..." : "Enviar reclamo"}
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="text-center px-5 py-8 text-[var(--text-muted)] text-xs border-t border-[var(--border)] mt-6">
        Powered by{" "}
        <span className="font-semibold text-[var(--text-secondary)]">LogiTrack</span>
        {" · "}
        {new Date().getFullYear()}
      </footer>

      <ChatbotWidget />
    </div>
  );
}
