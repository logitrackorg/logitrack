import { Link } from "react-router-dom";
import { MapPin, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDate } from "@/utils/date";
import type { ShipmentEvent, ShipmentStatus } from "@/api/shipments";
import { CLAIM_EVENT_LABELS, type ClaimEventType } from "@/api/claims";
import type { Branch } from "@/api/branches";

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft:                "Borrador",
  at_origin_hub:        "En sucursal de origen",
  loaded:               "Cargado en vehículo",
  in_transit:           "En tránsito",
  at_hub:               "En sucursal",
  out_for_delivery:     "Última milla",
  delivery_failed:      "Entrega fallida",
  redelivery_scheduled: "Reentrega programada",
  no_entregado:         "No entregado",
  rechazado:            "Rechazado",
  delivered:            "Entregado",
  ready_for_pickup:     "Listo para retiro",
  ready_for_return:     "Listo para devolución",
  returned:             "Devuelto",
  cancelled:            "Cancelado",
  lost:                 "Extraviado",
  destroyed:            "Daño total",
  expired:              "Borrador expirado",
  pending_payment:      "Pago pendiente",
};

const formatShipmentEventLabel = (ev: ShipmentEvent) => {
  const claimEventType = ev.event_type as ClaimEventType | undefined;
  if (claimEventType && claimEventType in CLAIM_EVENT_LABELS) {
    return CLAIM_EVENT_LABELS[claimEventType];
  }

  if (ev.event_type === "incident_reported") {
    return "Incidencia reportada";
  }

  if (ev.event_type === "edited") {
    return STATUS_LABELS[ev.to_status];
  }

  if (ev.from_status) {
    return `${STATUS_LABELS[ev.from_status]} → ${STATUS_LABELS[ev.to_status]}`;
  }

  return ev.to_status ? STATUS_LABELS[ev.to_status] : "Evento registrado";
};

const resolveBranch = (loc: string, branches: Branch[]): Branch | undefined => {
  return branches.find((b) => b.address.city === loc) ?? branches.find((b) => b.id === loc);
};

const formatChangedBy = (changedBy: string): string => {
  if (changedBy?.startsWith("chatbot-recipient")) return "chatbot-Destinatario";
  if (changedBy === "system" || !changedBy) return "sistema";
  return changedBy;
};

interface EventTimelineProps {
  events: ShipmentEvent[];
  branches: Branch[];
  showHeading?: boolean;
  className?: string;
}

export function EventTimeline({ events, branches, showHeading, className }: EventTimelineProps) {
  return (
    <div className={cn(className)}>
      {showHeading && (
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border)]">
          <Clock className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-heading)] uppercase tracking-wide">Historial de eventos</h2>
          {events.length > 0 && (
            <span className="ml-auto text-[11px] font-medium text-[var(--text-muted)]">{events.length} eventos</span>
          )}
        </div>
      )}

      {events.length === 0 ? (
        <p className="text-[var(--text-secondary)] text-sm">Sin eventos registrados.</p>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-[var(--border)]" />

          {[...events].reverse().map((ev) => (
            <div key={ev.id} className="relative mb-3">
              <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-blue-700 border-2 border-[var(--bg-card)] shadow-[0_0_0_2px_var(--border)]" />

              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-2.5 text-[13px]">
                {ev.event_type === "rescheduled" && ev.current_location && ev.rescheduled_date ? (
                  <>
                    <div className="flex justify-between mb-0.5">
                      <span className="font-semibold">
                        {ev.current_location.type === "DESTINATION_BRANCH"
                          ? "En Sucursal Destino"
                          : ev.current_location.type === "ORIGIN_BRANCH"
                          ? `En Sucursal Origen (${ev.current_location.branch_code})`
                          : "En tránsito"}{" "}
                        — {ev.current_location.status}
                      </span>
                      <span className="text-[var(--text-muted)]">{fmtDateTime(ev.timestamp)}</span>
                    </div>
                    <div className="text-[var(--text-secondary)] flex gap-4 flex-wrap">
                      <span>
                        por{" "}
                        <strong>{formatChangedBy(ev.changed_by)}</strong>
                      </span>
                    </div>
                    <p className="mt-1 mb-0 text-[var(--danger-text)] font-medium">
                      Entrega reprogramada para el {fmtDate(ev.rescheduled_date)}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between mb-0.5">
                      <span className="font-semibold">{formatShipmentEventLabel(ev)}</span>
                      <span className="text-[var(--text-muted)]">{fmtDateTime(ev.timestamp)}</span>
                    </div>
                    <div className="text-[var(--text-secondary)] flex gap-4 flex-wrap">
                      <span>
                        por{" "}
                        <strong>{formatChangedBy(ev.changed_by)}</strong>
                      </span>
                      {ev.location && (
                        <span>
                          <MapPin className="w-4 h-4 inline" />{" "}
                          <strong>
                            {resolveBranch(ev.location, branches)?.name ?? ev.location}
                          </strong>
                          {(() => {
                            const b = resolveBranch(ev.location, branches);
                            return (
                              b && (
                                <>
                                  {" "}
                                  · {b.address.city} ·{" "}
                                  <span className="text-[var(--text-muted)]">{b.province}</span>
                                </>
                              )
                            );
                          })()}
                        </span>
                      )}
                    </div>
                    {ev.notes && (
                      <p className="mt-1 mb-0 text-[var(--text-secondary)]">{ev.notes}</p>
                    )}
                    {ev.event_type === "claim_created" && ev.notes && (
                      (() => {
                        const m = ev.notes!.match(/REC-\d+/);
                        if (m) {
                          const claimId = m[0];
                          return (
                            <p className="mt-1.5 mb-0">
                              <Link
                                to={`/claims/${claimId}`}
                                className="text-[var(--text-heading)] font-bold"
                              >
                                Ver reclamo {claimId}
                              </Link>
                            </p>
                          );
                        }
                        return null;
                      })()
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
