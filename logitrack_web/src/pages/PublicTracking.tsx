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
import "./PublicTracking.css";
import { ChatbotWidget } from "../components/chatbot/ChatbotWidget";

// User-facing one-liner explanation for each status. Shown under the badge in
// the summary card. Friendlier than the operational labels in StatusBadge.
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
  icon: string;
  title: string;
  subtitle?: string;
}

function describeEvent(ev: PublicShipmentEvent, branches: Branch[]): EventDescription {
  if (ev.event_type === "claim_created") {
    const statusLabel = ev.claim_status ? CLAIM_STATUS_LABELS[ev.claim_status] ?? "Abierto" : "Abierto";
    return { icon: "🧾", title: `En Reclamo · ${statusLabel}` };
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
      icon: "📍",
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

  if (!from && to === "at_origin_hub") return { icon: "📦", title: "Envío registrado", subtitle: cityLine };
  if (!from && to === "draft")          return { icon: "📋", title: "Borrador creado" };
  if (from === "draft" && to === "at_origin_hub") return { icon: "✅", title: "Envío confirmado", subtitle: cityLine };
  if (to === "loaded")                  return { icon: "🚛", title: "Cargado y listo para despachar", subtitle: cityLine };
  if (to === "in_transit")              return { icon: "🚀", title: "Despachado — en tránsito" };
  if (to === "at_hub" || to === "at_origin_hub") return { icon: "🏭", title: "Llegó al centro logístico", subtitle: cityLine };
  if (to === "out_for_delivery")        return { icon: "🛵", title: "En camino a domicilio", subtitle: cityLine };
  if (to === "delivered")               return { icon: "🎉", title: "Envío entregado" };
  if (to === "delivery_failed")         return { icon: "⚠️", title: "El intento de entrega no fue exitoso" };
  if (to === "redelivery_scheduled")    return { icon: "🔄", title: "Reentrega programada" };
  if (to === "no_entregado")            return { icon: "🚷", title: "No pudo ser entregado" };
  if (to === "rechazado")               return { icon: "🚫", title: "Envío rechazado por el destinatario" };
  if (to === "ready_for_pickup")        return { icon: "📬", title: "Disponible para retiro en el centro logístico", subtitle: cityLine };
  if (to === "ready_for_return")        return { icon: "↩️", title: "En espera de devolución al remitente", subtitle: cityLine };
  if (to === "returned")                return { icon: "📤", title: "Devuelto al remitente" };
  if (to === "cancelled")               return { icon: "🚫", title: "Envío cancelado" };
  if (to === "lost")                    return { icon: "🔍", title: "Envío extraviado" };
  if (to === "destroyed")               return { icon: "💥", title: "Daño total — envío destruido" };
  return { icon: "•", title: to, subtitle: cityLine };
}

// Phase stepper — 4 macro-stages every shipment goes through. Maps the 17
// internal statuses to "pending" / "active" / "done" / "failed" buckets.
type PhaseState = "pending" | "active" | "done" | "failed";
interface Phase {
  key: string;
  label: string;
}
const PHASES: Phase[] = [
  { key: "registered", label: "Registrado" },
  { key: "transit",    label: "En tránsito" },
  { key: "delivery",   label: "En reparto" },
  { key: "delivered",  label: "Entregado" },
];

function phaseStates(status: ShipmentStatus): PhaseState[] {
  // Returns one PhaseState per PHASES entry, in the same order.
  const failed: ShipmentStatus[] = ["cancelled", "lost", "destroyed", "no_entregado", "rechazado"];
  if (failed.includes(status)) {
    // Show the journey as far as it got, but mark the final phase as failed.
    return ["done", "done", "done", "failed"];
  }
  if (status === "returned") {
    return ["done", "done", "done", "done"]; // a return is also a successful resolution
  }
  if (status === "delivered") {
    return ["done", "done", "done", "done"];
  }
  if (status === "out_for_delivery" || status === "delivery_failed" || status === "redelivery_scheduled" || status === "ready_for_pickup") {
    return ["done", "done", "active", "pending"];
  }
  if (status === "in_transit" || status === "at_hub" || status === "loaded" || status === "ready_for_return") {
    return ["done", "active", "pending", "pending"];
  }
  // at_origin_hub, draft (drafts are filtered server-side, but be safe)
  return ["active", "pending", "pending", "pending"];
}

interface StatusHero {
  tone: "success" | "info" | "warn" | "danger" | "muted";
  icon: string;
  title: string;
  subtitle: string;
}

function statusHero(s: PublicShipment): StatusHero {
  switch (s.status) {
    case "delivered":
      return {
        tone: "success",
        icon: "🎉",
        title: "¡Tu envío fue entregado!",
        subtitle: s.delivered_at
          ? `Entregado el ${fmtDateTime(s.delivered_at)}`
          : "Listo y entregado.",
      };
    case "returned":
      return { tone: "muted", icon: "📤", title: "Envío devuelto al remitente", subtitle: "Cerramos este envío con devolución completa." };
    case "cancelled":
      return { tone: "muted", icon: "🚫", title: "Envío cancelado", subtitle: "Este envío fue cancelado y no continuará su viaje." };
    case "lost":
      return { tone: "danger", icon: "🔍", title: "Envío extraviado", subtitle: "Estamos investigando su paradero. Te vamos a contactar." };
    case "destroyed":
      return { tone: "danger", icon: "💥", title: "Daño total", subtitle: "El envío sufrió un daño irreparable y no podrá ser entregado." };
    case "delivery_failed":
    case "redelivery_scheduled":
      return { tone: "warn", icon: "⚠️", title: "Intento de entrega fallido", subtitle: STATUS_BLURBS[s.status] };
    case "no_entregado":
    case "rechazado":
      return { tone: "danger", icon: "🚷", title: STATUS_BLURBS[s.status], subtitle: "Coordiná con el remitente los próximos pasos." };
    case "out_for_delivery":
      return { tone: "info", icon: "🛵", title: "Tu envío está en camino", subtitle: "Hoy puede llegar a tu domicilio." };
    case "ready_for_pickup":
      return { tone: "info", icon: "📬", title: "Listo para retirar", subtitle: "Te esperamos en la sucursal con tu DNI." };
    default:
      return { tone: "info", icon: "🚚", title: "Tu envío está en camino", subtitle: STATUS_BLURBS[s.status] ?? "" };
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
  if (status === "delivered" || status === "returned" || status === "cancelled" || status === "lost" || status === "destroyed") {
    return undefined;
  }
  return { line: fmtDateTime(iso), rel: fmtRelative(iso) };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const lastUpdate = events.length > 0 ? events[0].timestamp : shipment?.updated_at;

  const hero = shipment ? statusHero(shipment) : null;
  const phases = shipment ? phaseStates(shipment.status) : null;
  const eta = shipment ? etaSummary(shipment.estimated_delivery_at, shipment.status) : undefined;

  return (
    <div className="pt-root">
      <header className="pt-header">
        <div className="pt-brand">
          <span className="pt-brand-name">LogiTrack</span>
          <span className="pt-brand-tag">· Seguimiento de envíos</span>
        </div>
      </header>

      <section className="pt-hero">
        <h1>¿Dónde está mi envío?</h1>
        <p>Ingresá tu número de seguimiento para ver el estado actual</p>
        <form onSubmit={handleSearch} className="pt-search-form" role="search" aria-label="Buscar envío">
          <label htmlFor="pt-tracking-input" className="visually-hidden" style={{ position: "absolute", left: -9999 }}>
            Número de seguimiento
          </label>
          <input
            id="pt-tracking-input"
            className="pt-search-input"
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
            className="pt-search-btn"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Buscando..." : "Rastrear"}
          </button>
        </form>
        <details className="pt-example-box">
          <summary>Ejemplos válidos para probar</summary>
          <div className="pt-example-list">
            {EXAMPLE_TRACKING_IDS.map((item) => (
              <button
                key={item.trackingId}
                type="button"
                className="pt-example-btn"
                onClick={() => handleExampleClick(item.trackingId)}
                disabled={loading}
              >
                <span className="pt-example-id">{item.trackingId}</span>
                <span className="pt-example-meta">
                  Remitente: {item.sender.name} (DNI {item.sender.dni}) · Destinatario: {item.recipient.name} (DNI {item.recipient.dni})
                </span>
              </button>
            ))}
          </div>
        </details>
        <p className="pt-search-hint">Tu número aparece en el comprobante o en el mail de confirmación.</p>
      </section>

      <main className="pt-container" aria-live="polite">
        {error && <div className="pt-error" role="alert">{error}</div>}

        {loading && !shipment && (
          <div className="pt-skeleton" aria-hidden="true">
            <div className="pt-skel-line" data-w="sm" />
            <div className="pt-skel-line" data-w="md" />
            <div className="pt-skel-line" data-w="lg" />
            <div className="pt-skel-line" data-w="md" />
          </div>
        )}

        {shipment && hero && phases && (
          <>
            <section
              className="pt-status-hero"
              data-tone={hero.tone}
              aria-label="Estado del envío"
            >
              <div className="pt-status-hero-icon" aria-hidden="true">{hero.icon}</div>
              <div>
                <h2 className="pt-status-hero-title">{hero.title}</h2>
                <p className="pt-status-hero-sub">{hero.subtitle}</p>
              </div>
            </section>

            {shipment.is_returning && shipment.status !== "returned" && (
              <div className="pt-banner" data-tone="warn" role="status">
                <span className="pt-banner-icon" aria-hidden="true">↩️</span>
                <div>
                  <p className="pt-banner-title">Volviendo al remitente</p>
                  <p className="pt-banner-body">Este envío inició su devolución y está viajando de regreso.</p>
                </div>
              </div>
            )}

            {(shipment.delivery_attempts ?? 0) > 0 && shipment.status !== "delivered" && shipment.status !== "returned" && (
              <div className="pt-banner" data-tone="warn" role="status">
                <span className="pt-banner-icon" aria-hidden="true">🔁</span>
                <div>
                  <p className="pt-banner-title">
                    {shipment.delivery_attempts === 1 ? "1 intento de entrega" : `${shipment.delivery_attempts} intentos de entrega`}
                  </p>
                  <p className="pt-banner-body">
                    {shipment.status === "redelivery_scheduled"
                      ? "Vamos a hacer un nuevo intento de entrega."
                      : shipment.status === "ready_for_pickup"
                      ? "Tu envío te espera para retiro en sucursal."
                      : "Coordinaremos los próximos pasos según el estado actual."}
                  </p>
                </div>
              </div>
            )}

            <section className="pt-stepper" aria-label="Progreso del envío">
              <h2 className="pt-stepper-title">Progreso</h2>
              <ol className="pt-steps">
                {PHASES.map((p, i) => {
                  const state = phases[i];
                  return (
                    <li key={p.key} className="pt-step" data-state={state} aria-current={state === "active" ? "step" : undefined}>
                      <div className="pt-step-bar" aria-hidden="true" />
                      <span className="pt-step-label">{p.label}</span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="pt-card" aria-label="Resumen del envío">
              <div className="pt-card-row">
                <div>
                  <div className="pt-label">Número de seguimiento</div>
                  <code className="pt-tracking-id">{shipment.tracking_id}</code>
                </div>
              </div>

              <div className="pt-meta-grid">
                {eta && (
                  <div>
                    <div className="pt-label">Entrega estimada</div>
                    <div className="pt-meta-value">{eta.line}</div>
                    {eta.rel && <div className="pt-meta-eta">{eta.rel}</div>}
                  </div>
                )}
                {shipment.delivered_at && (
                  <div>
                    <div className="pt-label">Entregado</div>
                    <div className="pt-meta-value">{fmtDateTime(shipment.delivered_at)}</div>
                    <div className="pt-meta-eta">{fmtRelative(shipment.delivered_at)}</div>
                  </div>
                )}
                {lastUpdate && shipment.status !== "delivered" && (
                  <div>
                    <div className="pt-label">Última actualización</div>
                    <div className="pt-meta-value">{fmtDateTime(lastUpdate)}</div>
                    <div className="pt-meta-eta">{fmtRelative(lastUpdate)}</div>
                  </div>
                )}
                {timeWindowLabel(shipment.time_window) && shipment.delivery_method !== "retiro_sucursal" && (
                  <div>
                    <div className="pt-label">Ventana horaria</div>
                    <div className="pt-meta-value">{timeWindowLabel(shipment.time_window)}</div>
                  </div>
                )}
                {deliveryMethodLabel(shipment.delivery_method) && (
                  <div>
                    <div className="pt-label">Modalidad</div>
                    <div className="pt-meta-value">{deliveryMethodLabel(shipment.delivery_method)}</div>
                  </div>
                )}
                <div>
                  <div className="pt-label">Tipo</div>
                  <div className="pt-meta-value">
                    {shipmentTypeLabel(shipment.shipment_type)}
                    {shipment.is_fragile && " · Frágil"}
                  </div>
                </div>
              </div>

              <div className="pt-route">
                <div className="pt-route-node">
                  <div className="pt-label">Origen</div>
                  <div className="pt-meta-value">
                    {shipment.origin.city}, {shipment.origin.province}
                  </div>
                </div>
                <span className="pt-route-arrow" aria-hidden="true">→</span>
                <div className="pt-route-node">
                  <div className="pt-label">Destino</div>
                  <div className="pt-meta-value">
                    {shipment.destination.city}, {shipment.destination.province}
                  </div>
                </div>
              </div>
            </section>

            {chronological.length > 0 && (
              <section className="pt-timeline-card" aria-label="Historial del envío">
                <h2 className="pt-timeline-title">Historial del envío</h2>
                <ol className="pt-timeline">
                  {chronological.map((ev, i) => {
                    const isCurrent = i === 0;
                    const desc = describeEvent(ev, branches);
                    const eventTime = ev.event_type === "claim_created" && ev.claim_updated_at
                      ? ev.claim_updated_at
                      : ev.timestamp;
                    return (
                      <li key={ev.id} className="pt-event" data-current={isCurrent || undefined}>
                        <div className="pt-event-dot" aria-current={isCurrent ? "step" : undefined} aria-hidden="true">
                          {desc.icon}
                        </div>
                        <div className="pt-event-content">
                          <div className="pt-event-title">{desc.title}</div>
                          {desc.subtitle && <div className="pt-event-loc">📍 {desc.subtitle}</div>}
                          <div className="pt-event-time">
                            {fmtDateTime(eventTime)} · <span className="pt-event-time-rel">{fmtRelative(eventTime)}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <section className="pt-claim-card" aria-label="Reclamos">
              <div className="pt-claim-header">
                <div>
                  <h2 className="pt-claim-title">¿Tuviste algún inconveniente con este envío?</h2>
                  <p className="pt-claim-sub">Podemos ayudarte con un reclamo y darte seguimiento.</p>
                </div>
                <button
                  type="button"
                  className="pt-claim-toggle"
                  onClick={() => setClaimOpen((prev) => !prev)}
                  disabled={claimSubmitting || !!claimResult}
                >
                  Solicitar ayuda
                </button>
              </div>

              {claimResult && (
                <div className="pt-claim-success" role="status">
                  <div className="pt-claim-success-title">Reclamo creado</div>
                  <div className="pt-claim-success-body">
                    Código: <strong>{claimResult.id}</strong> · Estado: {CLAIM_STATUS_LABELS[claimResult.status]}
                  </div>
                </div>
              )}

              {claimOpen && !claimResult && (
                <form className="pt-claim-form" onSubmit={handleClaimSubmit}>
                  <PublicClaimFormFields
                    values={claimForm}
                    onChange={patchClaimForm}
                    disabled={claimSubmitting}
                  />

                  {claimError && <div className="pt-claim-error" role="alert">{claimError}</div>}

                  <div className="pt-claim-actions">
                    <button type="button" className="pt-claim-cancel" onClick={() => setClaimOpen(false)}>
                      Cancelar
                    </button>
                    <button type="submit" className="pt-claim-submit" disabled={claimSubmitting}>
                      {claimSubmitting ? "Enviando..." : "Enviar reclamo"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}

        {!shipment && !error && !loading && (
          <div className="pt-empty">
            <p>Ingresá un número de seguimiento para comenzar.</p>
            <p className="pt-empty-tip">
              Formato: <code>LT-XXXXXXXX</code>
            </p>
          </div>
        )}
      </main>

      <footer className="pt-footer">
        © {new Date().getFullYear()} LogiTrack · Seguimiento de envíos
      </footer>
        <ChatbotWidget />
    </div>
  );
}
