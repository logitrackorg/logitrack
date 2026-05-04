import type { ShipmentStatus } from "../api/shipments";

const STATUS_CONFIG: Record<ShipmentStatus, { label: string; classes: string }> = {
  draft:                 { label: "Borrador",                classes: "bg-slate-100 text-slate-600 ring-slate-200" },
  at_origin_hub:         { label: "En sucursal de origen",   classes: "bg-amber-100 text-amber-700 ring-amber-200" },
  loaded:                { label: "Cargado",                 classes: "bg-cyan-100 text-cyan-700 ring-cyan-200" },
  in_transit:            { label: "En tránsito",             classes: "bg-blue-100 text-blue-700 ring-blue-200" },
  at_hub:                { label: "En sucursal",              classes: "bg-violet-100 text-violet-700 ring-violet-200" },
  out_for_delivery:      { label: "En reparto",              classes: "bg-orange-100 text-orange-700 ring-orange-200" },
  delivery_failed:       { label: "Entrega fallida",         classes: "bg-red-100 text-red-700 ring-red-200" },
  redelivery_scheduled:  { label: "Reentrega programada",   classes: "bg-orange-100 text-orange-700 ring-orange-200" },
  no_entregado:          { label: "No entregado",            classes: "bg-red-100 text-red-700 ring-red-200" },
  rechazado:             { label: "Rechazado",               classes: "bg-red-100 text-red-700 ring-red-200" },
  delivered:             { label: "Entregado",                classes: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  ready_for_pickup:      { label: "Listo para retiro",       classes: "bg-cyan-100 text-cyan-700 ring-cyan-200" },
  ready_for_return:      { label: "Listo para devolución",   classes: "bg-violet-100 text-violet-700 ring-violet-200" },
  returned:              { label: "Devuelto",                classes: "bg-slate-100 text-slate-600 ring-slate-200" },
  cancelled:             { label: "Cancelado",               classes: "bg-red-100 text-red-700 ring-red-200" },
  lost:                  { label: "Extraviado",              classes: "bg-gray-100 text-gray-600 ring-gray-200" },
  destroyed:             { label: "Daño total",              classes: "bg-gray-100 text-gray-700 ring-gray-200" },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const { label, classes } = STATUS_CONFIG[status] ?? { label: status, classes: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 ${classes}`}>
      {label}
    </span>
  );
}
