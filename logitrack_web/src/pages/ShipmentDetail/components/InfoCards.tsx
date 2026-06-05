import { MapPin } from "lucide-react";
import type { Shipment, ShipmentEvent } from "../../../api/shipments";
import type { Branch } from "../../../api/branches";
import { branchLabelById } from "../../../api/branches";
import { ZoneBadge } from "../../../components/ZoneBadge";
import { PriorityBadge } from "../../../components/PriorityBadge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { fmtDateTime } from "../../../utils/date";


const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Sobre", box: "Caja",
};

const fmtAddr = (a: { street?: string; city: string; province: string; postal_code?: string }) =>
  [a.street, a.city, a.province, a.postal_code].filter(Boolean).join(", ");

interface InfoCardsProps {
  shipment: Shipment;
  branches: Branch[];
  events: ShipmentEvent[];
  isMobile: boolean;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="text-[var(--text-muted)] min-w-[90px] shrink-0">{label}</span>
      <span className="font-medium text-[var(--text-strong)]">{value}</span>
    </div>
  );
}

function InfoRowEx({ label, value, corrected, original }: { label: string; value: string; corrected: boolean; original: string }) {
  return (
    <div className="flex gap-2 text-[13px] items-start">
      <span className="text-[var(--text-muted)] min-w-[90px] shrink-0">{label}</span>
      <div className="flex flex-col gap-0.5">
        <div className="flex gap-1.5 items-center">
          <span className="font-medium text-[var(--text-strong)]">{value}</span>
          {corrected && (
            <span className="text-[10px] font-bold bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)] rounded px-[5px] py-px whitespace-nowrap">
              Modificado
            </span>
          )}
        </div>
        {corrected && original && (
          <span className="text-[11px] text-[var(--text-muted)] line-through">{original}</span>
        )}
      </div>
    </div>
  );
}

export function InfoCards({ shipment, branches, events, isMobile: _isMobile }: InfoCardsProps) {
  const fmt = fmtDateTime;
  const cor = shipment.corrections ?? {};
  const cv = (key: string, original: string) =>
    cor[key] ? { value: cor[key], original, corrected: true } : { value: original, original, corrected: false };

  const originParts = [
    cor.origin_street ?? shipment.sender.address?.street,
    cor.origin_city ?? shipment.sender.address?.city,
    cor.origin_province ?? shipment.sender.address?.province,
    cor.origin_postal_code ?? shipment.sender.address?.postal_code,
  ].filter(Boolean).join(", ");
  const originCorrected = !!(cor.origin_street || cor.origin_city || cor.origin_province || cor.origin_postal_code);
  const originalOrigin = fmtAddr(shipment.sender.address);
  const destParts = [
    cor.destination_street ?? shipment.recipient.address?.street,
    cor.destination_city ?? shipment.recipient.address?.city,
    cor.destination_province ?? shipment.recipient.address?.province,
    cor.destination_postal_code ?? shipment.recipient.address?.postal_code,
  ].filter(Boolean).join(", ");
  const destCorrected = !!(cor.destination_street || cor.destination_city || cor.destination_province || cor.destination_postal_code);
  const originalDest = fmtAddr(shipment.recipient.address);
  const pkgVal = cv("package_type", PACKAGE_LABELS[shipment.package_type]);
  const instrVal = cv("special_instructions", shipment.special_instructions ?? "");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
      <Card className="border-l-4 border-l-[var(--border-strong)] cursor-default">
        <CardHeader className="pb-3">
          <CardTitle>Remitente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <InfoRowEx {...cv("sender_name", shipment.sender.name)} label="Nombre" />
          <InfoRowEx {...cv("sender_phone", shipment.sender.phone)} label="Teléfono" />
          {(shipment.sender.email || cor.sender_email) && <InfoRowEx {...cv("sender_email", shipment.sender.email ?? "")} label="Email" />}
          {(shipment.sender.dni || cor.sender_dni) && <InfoRowEx {...cv("sender_dni", shipment.sender.dni ?? "")} label="DNI" />}
          <InfoRowEx value={originParts || originalOrigin} original={originalOrigin} corrected={originCorrected} label="Origen" />
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-[var(--border-strong)] cursor-default">
        <CardHeader className="pb-3">
          <CardTitle>Destinatario</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <InfoRowEx {...cv("recipient_name", shipment.recipient.name)} label="Nombre" />
          <InfoRowEx {...cv("recipient_phone", shipment.recipient.phone)} label="Teléfono" />
          {(shipment.recipient.email || cor.recipient_email) && <InfoRowEx {...cv("recipient_email", shipment.recipient.email ?? "")} label="Email" />}
          {(shipment.recipient.dni || cor.recipient_dni) && <InfoRowEx {...cv("recipient_dni", shipment.recipient.dni ?? "")} label="DNI" />}
          <InfoRowEx value={destParts || originalDest} original={originalDest} corrected={destCorrected} label="Destino" />
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-[var(--border-strong)] cursor-default">
        <CardHeader className="pb-3">
          <CardTitle>Paquete</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <InfoRowEx {...pkgVal} label="Tipo" />
          {shipment.is_fragile && <InfoRow label="Frágil" value="Sí" />}
          {shipment.shipment_type && <InfoRow label="Tipo de envío" value={shipment.shipment_type === "express" ? "Express" : "Normal"} />}
          {(cor.time_window ?? shipment.time_window) && (() => {
            const tw = cor.time_window ?? shipment.time_window;
            const twLabel = tw === "morning" ? "Mañana" : tw === "afternoon" ? "Tarde" : "Flexible";
            return cor.time_window
              ? <InfoRowEx value={twLabel} original={shipment.time_window === "morning" ? "Mañana" : shipment.time_window === "afternoon" ? "Tarde" : "Flexible"} corrected label="Ventana horaria" />
              : <InfoRow label="Ventana horaria" value={twLabel} />;
          })()}
          {(() => {
            const changedByChat = events.some(ev => ev.notes === "Destinatario solicitó retiro en sucursal vía chatbot");
            const dmLabel = (shipment.delivery_method ?? "ultima_milla") === "retiro_sucursal" ? "Retiro en sucursal" : "Última milla (a domicilio)";
            return changedByChat
              ? <InfoRowEx label="Método de entrega" value="Retiro en sucursal" original="Última milla (a domicilio)" corrected />
              : <InfoRow label="Método de entrega" value={dmLabel} />;
          })()}
          {shipment.priority && <InfoRow label="Prioridad" value={<PriorityBadge priority={shipment.priority} />} />}
          <InfoRow label="Peso" value={(!shipment.weight_kg || shipment.weight_kg <= 0) && shipment.status === "draft" ? "Sin definir" : `${shipment.weight_kg} kg`} />
          {(shipment.special_instructions || cor.special_instructions) && <InfoRowEx {...instrVal} label="Instrucciones" />}
        </CardContent>
      </Card>
      <Card className="border-l-4 border-l-[var(--border-strong)] cursor-default">
        <CardHeader className="pb-3">
          <CardTitle>Fechas y ubicación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <InfoRow label="Creado" value={fmt(shipment.created_at)} />
          {(() => {
            const rescheduled = (shipment.chatbot_metadata?.reschedule_count ?? 0) > 0;
            const originalDate = shipment.chatbot_metadata?.original_delivery_date;
            if (rescheduled && originalDate && shipment.estimated_delivery_at) {
              return <InfoRowEx label="Entrega est." value={fmt(shipment.estimated_delivery_at)} original={fmt(originalDate)} corrected />;
            }
            return <InfoRow label="Entrega est." value={shipment.estimated_delivery_at ? fmt(shipment.estimated_delivery_at) : "—"} />;
          })()}
          {shipment.delivered_at && <InfoRow label="Entregado" value={fmt(shipment.delivered_at)} />}
          {shipment.current_location && (
            <InfoRow label="Ubicación actual" value={<><MapPin className="w-4 h-4 inline" /> {branchLabelById(shipment.current_location, branches)}</>} />
          )}
          {shipment.current_zone && (
            <InfoRow label="Zona" value={<ZoneBadge zone={shipment.current_zone} />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
