import { AlertTriangle, Clock } from "lucide-react";
import type { Shipment, ShipmentStatus } from "../api/shipments";

// Mirrors the thresholds from the Go SLA engine and ShipmentList.tsx
const SLA_MONITORED: ReadonlySet<string> = new Set([
  "at_origin_hub", "at_hub", "loaded", "in_transit",
  "out_for_delivery", "redelivery_scheduled", "ready_for_return",
]);
const AT_RISK_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 h — SLA comprometido
const DELAYED_THRESHOLD_MS = 36 * 60 * 60 * 1000; // 36 h — demorado

function isAtRisk(s: Shipment): boolean {
  if (!SLA_MONITORED.has(s.status) || !s.updated_at) return false;
  const dwell = Date.now() - new Date(s.updated_at).getTime();
  return dwell > AT_RISK_THRESHOLD_MS && dwell <= DELAYED_THRESHOLD_MS;
}

function isDelayed(s: Shipment): boolean {
  if (!SLA_MONITORED.has(s.status) || !s.updated_at) return false;
  return Date.now() - new Date(s.updated_at).getTime() > DELAYED_THRESHOLD_MS;
}

type KPI = {
  key: string;
  label: string;
  filterValue: ShipmentStatus | "active" | "sla_risk" | "sla_compromised" | "";
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
    key: "at_hub",
    label: "En sucursal",
    filterValue: "at_hub",
    count: (list) => list.filter((s) => s.status === "at_hub" || s.status === "at_origin_hub").length,
  },
  {
    key: "sla_compromised",
    label: "SLA Comprometido",
    filterValue: "sla_compromised",
    // Prefer server-computed flag (is_at_risk) when available, fall back to dwell calc
    count: (list) => list.filter((s) => s.is_at_risk ?? isAtRisk(s)).length,
  },
  {
    key: "sla_risk",
    label: "Demorados",
    filterValue: "sla_risk",
    // Prefer server-computed flag (is_delayed) when available, fall back to dwell calc
    count: (list) => list.filter((s) => s.is_delayed ?? isDelayed(s)).length,
  },
];

/** KPI-specific Tailwind class sets, using CSS variable arbitrary values for palette tokens. */
const KPI_STYLES: Record<string, { active: string; count: string }> = {
  in_transit: {
    active: "bg-[var(--brand-tint)] border-[var(--brand-tint-border)] shadow-[0_0_0_2px_var(--brand-tint-border)] -translate-y-px",
    count: "text-[var(--brand)]",
  },
  at_hub: {
    active: "bg-[var(--purple-bg)] border-[var(--purple-bg)] shadow-[0_0_0_2px_var(--purple-bg)] -translate-y-px",
    count: "text-[var(--purple-text)]",
  },
  sla_compromised: {
    active: "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600 shadow-[0_0_0_2px_theme(colors.amber.300)] dark:shadow-[0_0_0_2px_theme(colors.amber.600)] -translate-y-px",
    count: "text-amber-600 dark:text-amber-400",
  },
  sla_risk: {
    active: "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-600 shadow-[0_0_0_2px_theme(colors.red.300)] dark:shadow-[0_0_0_2px_theme(colors.red.600)] -translate-y-px",
    count: "text-red-600 dark:text-red-400",
  },
};

const inactiveClasses = "bg-[var(--bg-card)] border-[var(--border)] shadow-sm";
const countFaint = "text-[var(--text-faint)]";

type Props = {
  shipments: Shipment[];
  activeFilter: string;
  onFilter: (v: ShipmentStatus | "active" | "sla_risk" | "sla_compromised" | "") => void;
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
            onClick={() => onFilter(isActive ? "active" : kpi.filterValue)}
            className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${isActive ? style.active : inactiveClasses}`}
          >
            <div
              className={`text-2xl font-bold tabular-nums leading-none mb-1 ${count > 0 ? style.count : countFaint}`}
            >
              {count}
            </div>
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-tight">
              {kpi.label}
            </div>
            {kpi.key === "sla_compromised" && count > 0 && (
              <div className="mt-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                <AlertTriangle size={10} className="inline align-[-1px]" />
                24–36 h en estado
              </div>
            )}
            {kpi.key === "sla_risk" && count > 0 && (
              <div className="mt-1.5 text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                <Clock size={10} className="inline align-[-1px]" />
                +36 h en estado
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
