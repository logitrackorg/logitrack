import { Package, User as UserIcon, MapPin, Clock, AlertTriangle, RotateCcw, FileText } from "lucide-react";
import type { Shipment } from "../api/shipments";
import type { Branch } from "../api/branches";
import { branchLabelById } from "../api/branches";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { fmtDateTime } from "../utils/date";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";

// Etiquetas en español para los enums del shipment.
const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Sobre",
  box: "Caja",
};
const SHIPMENT_TYPE_LABELS: Record<string, string> = {
  normal: "Normal",
  express: "Express",
};
const TIME_WINDOW_LABELS: Record<string, string> = {
  morning: "Mañana (08–12)",
  afternoon: "Tarde (12–18)",
  flexible: "Flexible",
};
const DELIVERY_METHOD_LABELS: Record<string, string> = {
  ultima_milla: "Última milla (a domicilio)",
  retiro_sucursal: "Retiro en sucursal",
};
const INCIDENT_LABELS: Record<string, string> = {
  extraviado: "Extraviado",
  danio_total: "Daño total",
  otro: "Otro",
};

// ShipmentInfoModal muestra la información del envío en modo solo-lectura.
// No incluye acciones, precio ni factores de prioridad técnicos. Pensado
// para que el operador pueda confirmar el contenido del paquete y los
// datos de entrega sin salir de la pantalla actual (ej: en /routing).
export function ShipmentInfoModal({
  shipment,
  branches,
  onClose,
}: {
  shipment: Shipment;
  branches: Branch[];
  onClose: () => void;
}) {
  const statusLabel = shipmentStatusLabelOverride(shipment);
  const branchOf = (id?: string) => (id ? branchLabelById(id, branches) : "—");

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold text-slate-900">{shipment.tracking_id}</span>
              <StatusBadge status={shipment.status} label={statusLabel} />
              {shipment.priority && <PriorityBadge priority={shipment.priority} />}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Información del envío · solo lectura
            </div>
          </div>
        </div>

        <div className="p-5 grid gap-5">
          {/* Banners de alerta — devolución, incidente, instrucciones */}
          {shipment.is_returning && (
            <Banner
              icon={<RotateCcw className="w-4 h-4" />}
              title="Devolución a remitente"
              description="Este envío vuelve hacia su origen."
              tone="orange"
            />
          )}
          {shipment.has_incident && (
            <Banner
              icon={<AlertTriangle className="w-4 h-4" />}
              title={`Incidente reportado${shipment.incident_type ? ` · ${INCIDENT_LABELS[shipment.incident_type] ?? shipment.incident_type}` : ""}`}
              description="Revisar el detalle del envío para más información."
              tone="rose"
            />
          )}
          {shipment.special_instructions && (
            <Banner
              icon={<FileText className="w-4 h-4" />}
              title="Instrucciones especiales"
              description={shipment.special_instructions}
              tone="amber"
            />
          )}

          {/* Datos del envío */}
          <Section icon={<Package className="w-4 h-4" />} title="Datos del envío">
            <KV label="Peso" value={`${shipment.weight_kg.toFixed(1)} kg`} />
            <KV label="Tipo de paquete" value={PACKAGE_LABELS[shipment.package_type] ?? shipment.package_type} />
            <KV label="Frágil" value={shipment.is_fragile ? "Sí" : "No"} />
            <KV label="Tipo de envío" value={SHIPMENT_TYPE_LABELS[shipment.shipment_type ?? ""] ?? "—"} />
            <KV label="Ventana horaria" value={TIME_WINDOW_LABELS[shipment.time_window ?? ""] ?? "—"} />
            <KV label="Método de entrega" value={DELIVERY_METHOD_LABELS[shipment.delivery_method ?? ""] ?? "—"} />
            {shipment.delivery_attempts !== undefined && shipment.delivery_attempts > 0 && (
              <KV label="Intentos de entrega" value={String(shipment.delivery_attempts)} />
            )}
          </Section>

          {/* Remitente */}
          <Section icon={<UserIcon className="w-4 h-4" />} title="Remitente">
            <KV label="Nombre" value={shipment.sender.name} />
            <KV label="DNI" value={shipment.sender.dni} />
            <KV label="Teléfono" value={shipment.sender.phone} />
            {shipment.sender.email && <KV label="Email" value={shipment.sender.email} />}
            <KV label="Dirección" value={formatAddress(shipment.sender.address)} fullRow />
          </Section>

          {/* Destinatario */}
          <Section icon={<UserIcon className="w-4 h-4" />} title="Destinatario">
            <KV label="Nombre" value={shipment.recipient.name} />
            <KV label="DNI" value={shipment.recipient.dni} />
            <KV label="Teléfono" value={shipment.recipient.phone} />
            {shipment.recipient.email && <KV label="Email" value={shipment.recipient.email} />}
            <KV label="Dirección" value={formatAddress(shipment.recipient.address)} fullRow />
          </Section>

          {/* Ruta */}
          <Section icon={<MapPin className="w-4 h-4" />} title="Ruta">
            <KV label="Sucursal de origen" value={branchOf(shipment.origin_branch_id)} />
            <KV label="Sucursal de recepción" value={branchOf(shipment.receiving_branch_id)} />
            <KV label="Sucursal de destino" value={branchOf(shipment.final_branch_id)} />
            {shipment.current_location && (
              <KV label="Ubicación actual" value={branchOf(shipment.current_location)} />
            )}
          </Section>

          {/* Fechas */}
          <Section icon={<Clock className="w-4 h-4" />} title="Tiempos">
            <KV label="Creado" value={fmtDateTime(shipment.created_at)} />
            <KV label="Última actualización" value={fmtDateTime(shipment.updated_at)} />
            {shipment.estimated_delivery_at && (
              <KV label="Entrega estimada" value={fmtDateTime(shipment.estimated_delivery_at)} />
            )}
            {shipment.delivered_at && (
              <KV label="Entregado" value={fmtDateTime(shipment.delivered_at)} />
            )}
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="w-full h-10 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-slate-700">{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
        {children}
      </div>
    </div>
  );
}

function KV({ label, value, fullRow = false }: { label: string; value: string; fullRow?: boolean }) {
  return (
    <div className={fullRow ? "sm:col-span-2" : ""}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 break-words">{value || "—"}</div>
    </div>
  );
}

function Banner({
  icon,
  title,
  description,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "orange" | "rose" | "amber";
}) {
  const palette = {
    orange: "bg-orange-50 border-orange-200 text-orange-900",
    rose:   "bg-rose-50 border-rose-200 text-rose-900",
    amber:  "bg-amber-50 border-amber-200 text-amber-900",
  }[tone];
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${palette}`}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs opacity-90 break-words">{description}</div>
      </div>
    </div>
  );
}

function formatAddress(a: { street?: string; city: string; province: string; postal_code?: string }): string {
  const parts: string[] = [];
  if (a.street) parts.push(a.street);
  parts.push(a.city);
  parts.push(a.province);
  if (a.postal_code) parts.push(`CP ${a.postal_code}`);
  return parts.join(", ");
}
