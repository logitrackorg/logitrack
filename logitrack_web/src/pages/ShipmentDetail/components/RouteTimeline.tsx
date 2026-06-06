import { Circle, Truck, Check, Flag } from "lucide-react";
import type { ShipmentEvent, ShipmentStatus } from "../../../api/shipments";
import type { Branch } from "../../../api/branches";
import { fmtDate } from "../../../utils/date";

interface RouteTimelineProps {
  events: ShipmentEvent[];
  origin: string;
  receivingBranchId?: string;
  finalBranchId?: string;
  destination: string;
  branches: Branch[];
}

export function RouteTimeline({ events, origin, receivingBranchId, finalBranchId, destination, branches }: RouteTimelineProps) {
  if (events.length === 0) return null;

  const receivingBranch = receivingBranchId ? branches.find((b) => b.id === receivingBranchId) : undefined;
  const firstStop = receivingBranch ? receivingBranch.id : origin;
  const finalBranch = finalBranchId ? branches.find((b) => b.id === finalBranchId) : undefined;

  const stops: { location: string; status: ShipmentStatus; timestamp: string; current: boolean }[] = [];

  stops.push({ location: firstStop, status: "at_origin_hub" as ShipmentStatus, timestamp: events[0].timestamp, current: false });

  for (const ev of events.slice(1)) {
    if ((ev.to_status === "at_hub" || ev.to_status === "at_origin_hub") && ev.location) {
      stops.push({ location: ev.location, status: ev.to_status, timestamp: ev.timestamp, current: false });
    }
  }

  stops[stops.length - 1].current = true;

  const lastEvent = events[events.length - 1];
  const isInTransit = lastEvent?.to_status === "in_transit";
  const nextBranch = isInTransit ? lastEvent.location : null;
  const isDelivering = lastEvent?.to_status === "out_for_delivery";
  const isDelivered = lastEvent?.to_status === "delivered";

  const statusColors: Record<ShipmentStatus, string> = {
    draft: "bg-gray-400 border-gray-400",
    at_origin_hub: "bg-amber-500 border-amber-500",
    loaded: "bg-cyan-500 border-cyan-500",
    in_transit: "bg-blue-500 border-blue-500",
    at_hub: "bg-violet-500 border-violet-500",
    out_for_delivery: "bg-orange-500 border-orange-500",
    delivery_failed: "bg-red-500 border-red-500",
    redelivery_scheduled: "bg-orange-400 border-orange-400",
    no_entregado: "bg-gray-500 border-gray-500",
    rechazado: "bg-red-600 border-red-600",
    delivered: "bg-green-500 border-green-500",
    ready_for_pickup: "bg-cyan-600 border-cyan-600",
    ready_for_return: "bg-violet-600 border-violet-600",
    returned: "bg-gray-500 border-gray-500",
    cancelled: "bg-red-700 border-red-700",
    lost: "bg-gray-700 border-gray-700",
    destroyed: "bg-gray-800 border-gray-800",
    expired: "bg-gray-400 border-gray-400",
    pending_payment: "bg-amber-600 border-amber-600",
  };

  const statusRingColors: Record<ShipmentStatus, string> = {
    draft: "ring-gray-400/20",
    at_origin_hub: "ring-amber-500/20",
    loaded: "ring-cyan-500/20",
    in_transit: "ring-blue-500/20",
    at_hub: "ring-violet-500/20",
    out_for_delivery: "ring-orange-500/20",
    delivery_failed: "ring-red-500/20",
    redelivery_scheduled: "ring-orange-400/20",
    no_entregado: "ring-gray-500/20",
    rechazado: "ring-red-600/20",
    delivered: "ring-emerald-500/20",
    ready_for_pickup: "ring-cyan-600/20",
    ready_for_return: "ring-violet-600/20",
    returned: "ring-gray-500/20",
    cancelled: "ring-red-700/20",
    lost: "ring-gray-700/20",
    destroyed: "ring-gray-800/20",
    expired: "ring-gray-400/20",
    pending_payment: "ring-amber-600/20",
  };

  // Solid connector between two completed stops
  const solidConnector = (
    <div className="w-10 h-0.5 bg-[var(--border-strong)] shrink-0 mx-1 self-start mt-[11px]" />
  );

  // Dashed connector after the last completed stop
  const dashedConnector = (
    <div className="w-10 h-0.5 shrink-0 mx-1 self-start mt-[11px] bg-[repeating-linear-gradient(to_right,var(--border-strong)_0,var(--border-strong)_6px,transparent_6px,transparent_10px)]" />
  );

  const stopNodeComplete = (status: ShipmentStatus, isCurrent: boolean) => {
    if (isCurrent) {
      // Current stop: colored with outer ring
      return (
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${statusColors[status]} border-[3px] ${statusRingColors[status]} ring-[3px]`}>
          <Circle className="w-2.5 h-2.5 text-white" fill="currentColor" />
        </div>
      );
    }
    // Past completed stop: neutral filled circle
    return (
      <div className="w-6 h-6 rounded-full bg-[var(--border-strong)] border-[3px] border-[var(--border-strong)] flex items-center justify-center">
        <Circle className="w-2.5 h-2.5 text-white" fill="currentColor" />
      </div>
    );
  };

  return (
    <div className="bg-[var(--bg-subtle)] rounded-xl p-4 mb-4">
      <h3 className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border)] text-sm font-semibold text-[var(--text-heading)] uppercase tracking-wide">
        <Truck className="w-4 h-4 text-[var(--text-muted)]" />
        Ruta · {origin} → {destination}
      </h3>

      <div className="relative mt-3">
        {/* Right edge fade indicator — shows there's more content */}
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--bg-subtle)] to-transparent pointer-events-none z-10" />

        <div className="flex justify-center overflow-x-auto scrollbar-hide pr-4 pb-1">
          <div className="flex items-start shrink-0">
          {stops.map((stop, i) => (
            <div key={i} className="flex items-start shrink-0">
              <div className="flex flex-col items-center gap-1.5">
                {stopNodeComplete(stop.status, stop.current)}
                <div className="text-center w-[110px]">
                  {(() => {
                    const b = branches.find(x => x.id === stop.location);
                    return (
                      <>
                        <div className={`text-[11px] leading-tight truncate ${
                          stop.current
                            ? "font-bold text-[var(--text-primary)]"
                            : "font-medium text-[var(--text-secondary)]"
                        }`}>
                          {b?.name ?? stop.location}
                        </div>
                        {b && (
                          <div className="text-[10px] text-[var(--text-muted)] leading-tight truncate">
                            {b.address.city}, {b.address.province}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">{fmtDate(stop.timestamp)}</div>
                  {stop.location === finalBranchId && (
                    <div className="text-[10px] text-[var(--purple-text)] font-semibold mt-0.5">Sucursal final</div>
                  )}
                </div>
              </div>
              {i < stops.length - 1 && solidConnector}
            </div>
          ))}

          {isDelivering && (
            <>
              {dashedConnector}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="w-6 h-6 rounded-full bg-[var(--bg-subtle)] border-[3px] border-dashed border-[var(--warn)] flex items-center justify-center">
                  <Truck className="w-3.5 h-3.5 text-[var(--warn)]" />
                </div>
                <div className="text-[11px] text-[var(--warn-text)] font-semibold whitespace-nowrap">Destinatario</div>
              </div>
            </>
          )}

          {isInTransit && nextBranch && (
            <>
              {dashedConnector}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="w-6 h-6 rounded-full bg-[var(--bg-subtle)] border-[3px] border-dashed border-[var(--border-strong)] flex items-center justify-center">
                  <Circle className="w-3.5 h-3.5 text-[var(--border-strong)]" />
                </div>
                <div className="text-center w-[110px]">
                  {(() => {
                    const b = branches.find(x => x.id === nextBranch);
                    return (
                      <div className="text-[11px] text-[var(--text-muted)] truncate">{b?.name ?? nextBranch}</div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}

          {finalBranch && !stops.some(s => s.location === finalBranchId) && !isDelivered && !isDelivering && (
            <>
              {dashedConnector}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className="w-6 h-6 rounded-full bg-[var(--bg-subtle)] border-[3px] border-dashed border-[var(--purple)] flex items-center justify-center">
                  <Circle className="w-3.5 h-3.5 text-[var(--purple)]" />
                </div>
                <div className="text-center w-[110px]">
                  <div className="text-[11px] text-[var(--purple-text)] font-semibold truncate">{finalBranch.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">Sucursal final</div>
                </div>
              </div>
            </>
          )}

          <>
            {isDelivered ? (
              <div className="w-10 h-0.5 shrink-0 mx-1 self-start mt-[11px] bg-[var(--ok)]" />
            ) : (
              dashedConnector
            )}
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                isDelivered
                  ? "bg-[var(--ok)] border-[3px] border-[var(--ok)] ring-[3px] ring-emerald-500/20"
                  : "bg-[var(--bg-subtle)] border-[3px] border-dashed border-[var(--border-strong)]"
              }`}>
                {isDelivered ? (
                  <Check className="w-3.5 h-3.5 text-white" />
                ) : (
                  <Flag className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                )}
              </div>
              <div className={`text-[11px] whitespace-nowrap ${
                isDelivered
                  ? "font-bold text-[var(--ok-text)]"
                  : "font-normal text-[var(--text-muted)]"
              }`}>
                Destinatario
              </div>
            </div>
          </>
          </div>
        </div>
      </div>
    </div>
  );
}
