import type { ReactNode } from "react";
import type { Shipment, ShipmentStatus } from "../api/shipments";

type StatusFilterValue = ShipmentStatus | "active" | "sla_risk" | "sla_compromised" | "";

type KPI = {
  key: string;
  label: string;
  subtitle?: string;
  color: string;
  bg: string;
  border: string;
  filterValue: StatusFilterValue;
  count: (list: Shipment[]) => number;
  badge?: (count: number) => ReactNode;
};

const SLA_MONITORED_SET = new Set([
  "at_origin_hub", "at_hub", "loaded", "in_transit",
  "out_for_delivery", "redelivery_scheduled", "ready_for_return",
]);
const AT_RISK_MS  = 24 * 60 * 60 * 1000; // 24 h
const DELAYED_MS  = 36 * 60 * 60 * 1000; // 36 h

const KPIS: KPI[] = [
  // 1 — En tránsito
  {
    key: "in_transit",
    label: "En tránsito",
    color: "var(--brand)",
    bg: "var(--brand-tint)",
    border: "var(--brand-tint-border)",
    filterValue: "in_transit",
    count: (list) => list.filter((s) => s.status === "in_transit").length,
  },

  // 2 — En sucursal
  {
    key: "at_hub",
    label: "En sucursal",
    color: "var(--purple-text)",
    bg: "var(--purple-bg)",
    border: "var(--purple-bg)",
    filterValue: "at_hub",
    count: (list) =>
      list.filter((s) => s.status === "at_hub" || s.status === "at_origin_hub").length,
  },

  // 3 — SLA Comprometido (warning / amarillo)
  {
    key: "sla_compromised",
    label: "SLA Comprometido",
    subtitle: "Próximos a vencer",
    color: "#b45309",           // amber-700
    bg: "rgba(245,158,11,0.08)",
    border: "#fcd34d",          // amber-300
    filterValue: "sla_compromised",
    count: (list) =>
      list.filter((s) => {
        // Prefer server-computed flag (honours admin time-travel via clock.Now()).
        if (s.is_at_risk !== undefined) return s.is_at_risk;
        if (!SLA_MONITORED_SET.has(s.status) || !s.updated_at) return false;
        const dwell = Date.now() - new Date(s.updated_at).getTime();
        return dwell > AT_RISK_MS && dwell <= DELAYED_MS;
      }).length,
    badge: (count) =>
      count > 0 ? (
        <div className="mt-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5 inline-block">
          24–36 h en estado
        </div>
      ) : null,
  },

  // 4 — Demorados (crítico / rojo)
  {
    key: "sla_risk",
    label: "Demorados",
    color: "var(--danger-c, #ef4444)",
    bg: "var(--danger-bg, #fef2f2)",
    border: "var(--danger-border, #fecaca)",
    filterValue: "sla_risk",
    count: (list) =>
      list.filter((s) => {
        if (s.is_delayed !== undefined) return s.is_delayed;
        if (!SLA_MONITORED_SET.has(s.status) || !s.updated_at) return false;
        return Date.now() - new Date(s.updated_at).getTime() > DELAYED_MS;
      }).length,
    badge: (count) =>
      count > 0 ? (
        <div className="mt-1.5 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 inline-block">
          +36 h sin cambio de estado
        </div>
      ) : null,
  },
];

type Props = {
  shipments: Shipment[];
  activeFilter: string;
  onFilter: (v: StatusFilterValue) => void;
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
            onClick={() => onFilter(isActive ? "active" : kpi.filterValue)}
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
            <div className="text-xs font-semibold text-slate-500 leading-tight">
              {kpi.label}
            </div>
            {kpi.subtitle && (
              <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                {kpi.subtitle}
              </div>
            )}
            {kpi.badge?.(count)}
          </button>
        );
      })}
    </div>
  );
}
