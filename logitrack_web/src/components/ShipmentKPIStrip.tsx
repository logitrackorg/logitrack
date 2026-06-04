import type { Shipment, ShipmentStatus } from "../api/shipments";

type KPI = {
  key: string;
  label: string;
  filterValue: ShipmentStatus | "active" | "sla_risk" | "problem" | "";
  count: (list: Shipment[]) => number;
};

const KPIS: KPI[] = [
  {
    key: "in_transit",
    label: "En tránsito",
    filterValue: "in_transit",
    count: (list) => list.filter((s) => s.status === "in_transit").length,
  },
  {
    key: "out_for_delivery",
    label: "Última milla",
    filterValue: "out_for_delivery",
    count: (list) => list.filter((s) => s.status === "out_for_delivery").length,
  },
  {
    key: "at_hub",
    label: "En sucursal",
    filterValue: "at_hub",
    count: (list) => list.filter((s) => s.status === "at_hub" || s.status === "at_origin_hub").length,
  },
  {
    key: "sla_risk",
    label: "Riesgo SLA",
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

/** KPI-specific Tailwind class sets, using CSS variable arbitrary values for palette tokens. */
const KPI_STYLES: Record<string, { active: string; count: string }> = {
  in_transit: {
    active: "bg-[var(--brand-tint)] border-[var(--brand-tint-border)] shadow-[0_0_0_2px_var(--brand-tint-border)] -translate-y-px",
    count: "text-[var(--brand)]",
  },
  out_for_delivery: {
    active: "bg-[var(--warn-bg)] border-[var(--warn-border)] shadow-[0_0_0_2px_var(--warn-border)] -translate-y-px",
    count: "text-[var(--warn)]",
  },
  at_hub: {
    active: "bg-[var(--purple-bg)] border-[var(--purple-bg)] shadow-[0_0_0_2px_var(--purple-bg)] -translate-y-px",
    count: "text-[var(--purple-text)]",
  },
  sla_risk: {
    active: "bg-[var(--warn-bg)] border-[var(--warn-border)] shadow-[0_0_0_2px_var(--warn-border)] -translate-y-px",
    count: "text-[var(--warn-text)]",
  },
};

const inactiveClasses = "bg-[var(--bg-card)] border-[var(--border)] shadow-sm";
const countFaint = "text-[var(--text-faint)]";

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
        const style = KPI_STYLES[kpi.key];
        return (
          <button
            key={kpi.key}
            onClick={() => onFilter(isActive ? "active" : kpi.filterValue as ShipmentStatus | "active" | "sla_risk" | "")}
            className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${isActive ? style.active : inactiveClasses}`}
          >
            <div
              className={`text-2xl font-bold tabular-nums leading-none mb-1 ${count > 0 ? style.count : countFaint}`}
            >
              {count}
            </div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">{kpi.label}</div>
            {kpi.key === "sla_risk" && count > 0 && (
              <div className="mt-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded px-1.5 py-0.5 inline-block">
                ⚠ Próximas 24 h
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
