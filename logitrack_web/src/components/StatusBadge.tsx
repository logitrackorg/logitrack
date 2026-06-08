import type { ShipmentStatus } from "../api/shipments";

// eslint-disable-next-line react-refresh/only-export-components
export const STATUS_BADGE_CONFIG: Record<ShipmentStatus, { label: string; bg: string }> = {
  draft:                 { label: "Borrador",              bg: "#6b7280" },
  pending_payment:       { label: "Pago pendiente",        bg: "#d97706" },
  at_origin_hub:         { label: "En sucursal origen",    bg: "#f59e0b" },
  loaded:                { label: "Cargado en vehículo",   bg: "#4f46e5" },
  in_transit:            { label: "En tránsito",           bg: "#3b82f6" },
  at_hub:                { label: "En sucursal",           bg: "#8b5cf6" },
  out_for_delivery:      { label: "Última milla",          bg: "#f97316" },
  delivery_failed:       { label: "Entrega fallida",       bg: "#ef4444" },
  redelivery_scheduled:  { label: "Reentrega programada",  bg: "#eab308" },
  no_entregado:          { label: "No entregado",          bg: "#ec4899" },
  rechazado:             { label: "Rechazado",             bg: "#f43f5e" },
  delivered:             { label: "Entregado",             bg: "#10b981" },
  ready_for_pickup:      { label: "Listo para retiro",     bg: "#0891b2" },
  ready_for_return:      { label: "Listo para devolución", bg: "#7c3aed" },
  returned:              { label: "Devuelto",              bg: "#6b7280" },
  cancelled:             { label: "Cancelado",             bg: "#b91c1c" },
  lost:                  { label: "Extraviado",            bg: "#374151" },
  destroyed:             { label: "Daño total",            bg: "#111827" },
  expired:               { label: "Borrador expirado",     bg: "#6b7280" },
};

const BADGE_CLASSES: Record<ShipmentStatus, string> = {
  draft:                 "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-500/40",
  pending_payment:       "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-500/40",
  expired:               "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-500/40",
  at_origin_hub:         "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40",
  loaded:                "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/40",
  in_transit:            "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40",
  at_hub:                "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/40",
  out_for_delivery:      "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/40",
  delivery_failed:       "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40",
  redelivery_scheduled:  "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300 dark:border-yellow-500/40",
  no_entregado:          "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300 dark:border-pink-500/40",
  rechazado:             "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40",
  delivered:             "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/40",
  ready_for_pickup:      "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/40",
  ready_for_return:      "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/40",
  returned:              "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/40",
  cancelled:             "bg-red-50 text-red-400 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40",
  lost:                  "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/40",
  destroyed:             "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/40",
};

const DEFAULT_CLASSES = "bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-500/40";

export function StatusBadge({ status, label }: { status: ShipmentStatus; label?: string }) {
  const base = STATUS_BADGE_CONFIG[status];
  const cfgLabel = label ?? base?.label ?? status;
  const twClasses = BADGE_CLASSES[status] ?? DEFAULT_CLASSES;

  const isActive = status === "in_transit" || status === "out_for_delivery";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border border-transparent ${twClasses} ${isActive ? "animate-pulse" : ""}`}
    >
      {cfgLabel}
    </span>
  );
}
