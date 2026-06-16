import { ChevronDown, ChevronRight, Package, Truck, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Shipment, ShipmentStatus } from "../api/shipments";
import { INCIDENT_TYPE_LABELS } from "../api/shipments";
import { fmtDate } from "../utils/date";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import type { TripGroup } from "../utils/groupShipmentsByTrip";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";

function corr(s: Shipment, key: string, fallback: string | number): string {
  const v = s.corrections?.[key];
  return v !== undefined ? v : String(fallback);
}

const thClass = "px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider";
const tdClass = "px-4 py-3 text-slate-700";

const BULK_ELIGIBLE_STATUSES: ShipmentStatus[] = ["at_hub", "delivery_failed"];

type ShipmentRowProps = {
  shipment: Shipment;
  canBulk: boolean;
  selected: Set<string>;
  onToggleSelect: (trackingId: string) => void;
};

function ShipmentRow({ shipment: s, canBulk, selected, onToggleSelect }: ShipmentRowProps) {
  const navigate = useNavigate();
  const isEligible = BULK_ELIGIBLE_STATUSES.includes(s.status as ShipmentStatus);
  const isChecked = selected.has(s.tracking_id);

  return (
    <tr
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT") return;
        navigate(`/shipments/${s.tracking_id}`);
      }}
      className={`border-b border-slate-100 cursor-pointer transition-colors ${
        isChecked ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"
      }`}
    >
      {canBulk && (
        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
          {isEligible && (
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => onToggleSelect(s.tracking_id)}
              className="cursor-pointer accent-[var(--sidebar-bg)]"
            />
          )}
        </td>
      )}
      <td className={tdClass}>
        <code className={`text-xs font-mono ${s.status === "draft" ? "text-slate-400" : "text-slate-700"}`}>
          {s.tracking_id}
        </code>
      </td>
      <td className={tdClass}>{corr(s, "sender_name", s.sender.name)}</td>
      <td className={tdClass}>{corr(s, "recipient_name", s.recipient.name)}</td>
      <td className={tdClass}>
        <span className="text-slate-600">{corr(s, "origin_city", s.sender.address.city)}</span>
        <span className="mx-1.5 text-slate-300">→</span>
        <span className="text-slate-600">{corr(s, "destination_city", s.recipient.address.city)}</span>
      </td>
      <td className={tdClass}>
        {s.status === "draft" && (!s.weight_kg || s.weight_kg <= 0) ? (
          <span className="text-slate-400 text-xs italic">Sin definir</span>
        ) : (
          <span className="tabular-nums whitespace-nowrap">{corr(s, "weight_kg", s.weight_kg)} kg</span>
        )}
      </td>
      <td className={tdClass}>
        <PriorityBadge priority={s.priority} />
      </td>
      <td className={tdClass}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge status={s.status} label={shipmentStatusLabelOverride(s)} />
          {s.has_incident && (
            <span
              title={s.incident_type ? INCIDENT_TYPE_LABELS[s.incident_type] : "Incidencia registrada"}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
            >
              <AlertTriangle className="w-3 h-3" />
            </span>
          )}
        </div>
      </td>
      <td className={`${tdClass} text-slate-500`}>{fmtDate(s.created_at)}</td>
      <td className={`${tdClass} text-slate-500`}>
        {s.estimated_delivery_at ? fmtDate(s.estimated_delivery_at) : "—"}
      </td>
    </tr>
  );
}

type TripGroupSectionProps = {
  group: TripGroup;
  expanded: boolean;
  onToggle: () => void;
  canBulk: boolean;
  selected: Set<string>;
  onToggleSelect: (trackingId: string) => void;
  driverName?: string;
};

function TripGroupSection({
  group,
  expanded,
  onToggle,
  canBulk,
  selected,
  onToggleSelect,
  driverName,
}: TripGroupSectionProps) {
  const { trip, shipments, summary } = group;
  const progressPct =
    summary.total > 0 ? Math.round((summary.delivered / summary.total) * 100) : 0;

  const tripStatusBadge =
    trip.status === "pendiente"
      ? { label: "Pendiente", cls: "bg-amber-100 text-amber-800" }
      : trip.status === "en_transito"
        ? { label: "En tránsito", cls: "bg-sky-100 text-sky-800" }
        : { label: trip.status, cls: "bg-slate-100 text-slate-600" };

  const kindLabel =
    trip.kind === "last_mile" ? "Última milla" : "Inter-sucursal";

  const summaryParts: string[] = [];
  if (summary.delivered > 0) {
    summaryParts.push(
      `${summary.delivered} entregado${summary.delivered === 1 ? "" : "s"}`,
    );
  }
  if (summary.inProgress > 0) {
    summaryParts.push(
      `${summary.inProgress} en curso`,
    );
  }
  if (summary.problems > 0) {
    summaryParts.push(
      `${summary.problems} con problema${summary.problems === 1 ? "" : "s"}`,
    );
  }

  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-5 py-4 bg-slate-50/80 hover:bg-slate-100/80 transition-colors cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-slate-400 shrink-0">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Truck className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="font-mono font-semibold text-sm text-slate-900">{trip.license_plate}</span>
              <span className="text-xs text-slate-400 font-mono">{trip.id}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] font-medium">
                {kindLabel}
              </span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tripStatusBadge.cls}`}>
                {tripStatusBadge.label}
              </span>
            </div>
            <p className="text-xs text-slate-600 tabular-nums">
              {summary.total} envío{summary.total === 1 ? "" : "s"}
              {summaryParts.length > 0 && <> · {summaryParts.join(" · ")}</>}
              {driverName && <> · Chofer: {driverName}</>}
            </p>
            <div className="mt-2 h-1.5 w-full max-w-md rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-sm min-w-[900px]">
            <tbody>
              {shipments.map((s) => (
                <ShipmentRow
                  key={s.tracking_id}
                  shipment={s}
                  canBulk={canBulk}
                  selected={selected}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Props = {
  groups: TripGroup[];
  ungrouped: Shipment[];
  expandedTripIds: Set<string>;
  onToggleTrip: (tripId: string) => void;
  canBulk: boolean;
  selected: Set<string>;
  onToggleSelect: (trackingId: string) => void;
  driverMap: Record<string, string>;
};

export function ShipmentTripGroups({
  groups,
  ungrouped,
  expandedTripIds,
  onToggleTrip,
  canBulk,
  selected,
  onToggleSelect,
  driverMap,
}: Props) {
  return (
    <div>
      {groups.map((group) => (
        <TripGroupSection
          key={group.trip.id}
          group={group}
          expanded={expandedTripIds.has(group.trip.id)}
          onToggle={() => onToggleTrip(group.trip.id)}
          canBulk={canBulk}
          selected={selected}
          onToggleSelect={onToggleSelect}
          driverName={
            group.trip.driver_id ? driverMap[group.trip.driver_id] : undefined
          }
        />
      ))}

      {ungrouped.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-5 py-3 bg-slate-50/50 border-t border-slate-100">
            <Package className="w-4 h-4 text-slate-400" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Sin viaje asignado · {ungrouped.length}{" "}
              {ungrouped.length === 1 ? "envío" : "envíos"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <tbody>
                {ungrouped.map((s) => (
                  <ShipmentRow
                    key={s.tracking_id}
                    shipment={s}
                    canBulk={canBulk}
                    selected={selected}
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShipmentTableHeader({ canBulk, showSelectAll, allSelected, onSelectAll }: {
  canBulk: boolean;
  showSelectAll: boolean;
  allSelected: boolean;
  onSelectAll: () => void;
}) {
  return (
    <thead>
      <tr className="bg-slate-50/50 text-left border-b border-slate-100">
        {canBulk && (
          <th className="px-4 py-3 w-10 text-center">
            {showSelectAll && (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onSelectAll}
                title="Seleccionar todos los elegibles"
                className="cursor-pointer accent-[var(--sidebar-bg)]"
              />
            )}
          </th>
        )}
        <th className={thClass}>ID de seguimiento</th>
        <th className={thClass}>Remitente</th>
        <th className={thClass}>Destinatario</th>
        <th className={thClass}>Origen → Destino</th>
        <th className={thClass}>Peso</th>
        <th className={thClass}>Prioridad</th>
        <th className={thClass}>Estado</th>
        <th className={thClass}>Creado</th>
        <th className={thClass}>Entrega est.</th>
      </tr>
    </thead>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { ShipmentRow, thClass, tdClass };
