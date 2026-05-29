import type { Shipment, ShipmentStatus } from "../api/shipments";

type KPI = {
  key: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  filterValue: ShipmentStatus | "active" | "sla_risk" | "problem" | "";
  count: (list: Shipment[]) => number;
};


const KPIS: KPI[] = [
  {
    key: "in_transit",
    label: "En tránsito",
    color: "var(--brand)",
    bg: "var(--brand-tint)",
    border: "var(--brand-tint-border)",
    filterValue: "in_transit",
    count: (list) => list.filter((s) => s.status === "in_transit").length,
  },
  {
    key: "out_for_delivery",
    label: "Última milla",
    color: "var(--warn)",
    bg: "var(--warn-bg)",
    border: "var(--warn-border)",
    filterValue: "out_for_delivery",
    count: (list) => list.filter((s) => s.status === "out_for_delivery").length,
  },
  {
    key: "at_hub",
    label: "En sucursal",
    color: "var(--purple-text)",
    bg: "var(--purple-bg)",
    border: "var(--purple-bg)",
    filterValue: "at_hub",
    count: (list) => list.filter((s) => s.status === "at_hub" || s.status === "at_origin_hub").length,
  },
  {
    key: "sla_risk",
    label: "Riesgo SLA",
    color: "var(--warn-text)",
    bg: "var(--warn-bg)",
    border: "var(--warn-border)",
    filterValue: "sla_risk",
    count: (list) => {
      const cutoff = Date.now() + 24 * 60 * 60 * 1000;
      return list.filter(
        (s) =>
          s.priority === "alta" &&
          s.estimated_delivery_at &&
          new Date(s.estimated_delivery_at).getTime() < cutoff &&
          !["delivered", "returned", "cancelled", "lost", "destroyed"].includes(s.status),
      ).length;
    },
  },
];

type Props = {
  shipments: Shipment[];
  activeFilter: string;
  onFilter: (v: ShipmentStatus | "active" | "sla_risk" | "") => void;
};

export function ShipmentKPIStrip({ shipments, activeFilter, onFilter }: Props) {
  if (shipments.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      {KPIS.map((kpi) => {
        const count = kpi.count(shipments);
        const isActive = activeFilter === kpi.filterValue;
        return (
          <button
            key={kpi.key}
            onClick={() => onFilter(isActive ? "active" : kpi.filterValue as ShipmentStatus | "active" | "sla_risk" | "")}
            className="text-left rounded-xl p-3.5 border transition-all cursor-pointer"
            style={{
              background: isActive ? kpi.bg : "var(--bg-card)",
              borderColor: isActive ? kpi.border : "var(--border)",
              boxShadow: isActive ? `0 0 0 2px ${kpi.border}` : "0 1px 3px rgba(0,0,0,0.06)",
              transform: isActive ? "translateY(-1px)" : undefined,
            }}
          >
            <div
              className="text-2xl font-bold tabular-nums leading-none mb-1"
              style={{ color: count > 0 ? kpi.color : "var(--text-faint)" }}
            >
              {count}
            </div>
            <div className="text-xs font-semibold text-slate-500 leading-tight">{kpi.label}</div>
            {kpi.key === "sla_risk" && count > 0 && (
              <div className="mt-1.5 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block">
                ⚠ Próximas 24 h
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
