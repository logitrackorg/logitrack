import type { Shipment, TimeWindow } from "../api/shipments";
import { UserX, Ban, PackageX, Clock, ClipboardX, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const TIME_WINDOW_LABEL: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  flexible: "Flexible",
};

export const TIME_WINDOW_HOURS: Record<string, string> = {
  morning: "9–13h",
  afternoon: "14–18h",
  flexible: "Sin horario",
};

const TIME_WINDOW_RANK: Record<string, number> = {
  morning: 0,
  afternoon: 1,
  flexible: 2,
};

export function timeWindowTone(tw?: TimeWindow): {
  bg: string;
  text: string;
  border: string;
} {
  switch (tw) {
    case "morning":
      return { bg: "bg-sky-50 dark:bg-sky-500/15", text: "text-sky-700 dark:text-sky-300", border: "border-sky-200 dark:border-sky-500/30" };
    case "afternoon":
      return { bg: "bg-violet-50 dark:bg-violet-500/15", text: "text-violet-700 dark:text-violet-300", border: "border-violet-200 dark:border-violet-500/30" };
    default:
      return { bg: "bg-slate-100 dark:bg-gray-700", text: "text-slate-600 dark:text-gray-300", border: "border-slate-200 dark:border-gray-600" };
  }
}

// WhatsApp deeplink. AR-friendly: si el número viene como 54+area+nro
// (12 dígitos, sin el 9 de móvil), inserta "9" después de "54" para que
// wa.me lo entienda como móvil argentino.
export function waHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  let normalized = d;
  if (d.startsWith("54") && !d.startsWith("549")) {
    normalized = `549${d.slice(2)}`;
  }
  return `https://wa.me/${normalized}`;
}

export function waHrefWithText(phone: string, text: string): string {
  return `${waHref(phone)}?text=${encodeURIComponent(text)}`;
}

// Mensajes rápidos que ofrece el botón de WhatsApp del chofer. El texto
// final se construye con el nombre del destinatario y el tracking ID.
export const WA_QUICK_MESSAGES: ReadonlyArray<{
  id: string;
  label: string;
  build: (recipientName: string, trackingId: string) => string;
}> = [
  {
    id: "en_camino",
    label: "Estoy en camino",
    build: (name, tracking) =>
      `Hola ${name}, soy de LogiTrack. Estoy en camino con tu envío ${tracking}. ¡Te aviso cuando llegue!`,
  },
  {
    id: "en_la_puerta",
    label: "Estoy en la puerta",
    build: (name, tracking) =>
      `Hola ${name}, soy de LogiTrack. Ya estoy en la puerta con tu envío ${tracking}.`,
  },
  {
    id: "coordinar_horario",
    label: "Coordinar otro horario",
    build: (name, tracking) =>
      `Hola ${name}, soy de LogiTrack. Necesito coordinar otro horario para entregarte tu envío ${tracking}. ¿Cuándo podés recibirme?`,
  },
];

export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Orden recomendado para una ruta de chofer:
// 1) ventana horaria primero (mañana antes que tarde antes que flexible)
// 2) priority_score DESC dentro de la misma ventana
// 3) created_at ASC como desempate estable
export function sortPendingShipments<T extends Shipment>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ta = TIME_WINDOW_RANK[a.time_window ?? "flexible"] ?? 2;
    const tb = TIME_WINDOW_RANK[b.time_window ?? "flexible"] ?? 2;
    if (ta !== tb) return ta - tb;
    const sa = a.priority_score ?? 0;
    const sb = b.priority_score ?? 0;
    if (sa !== sb) return sb - sa;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

// Para "Completados" mostramos los más recientes arriba; usamos delivered_at
// si existe, si no updated_at.
export function sortCompletedShipments<T extends Shipment>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const da = a.delivered_at ?? a.updated_at ?? "";
    const db = b.delivered_at ?? b.updated_at ?? "";
    return db.localeCompare(da);
  });
}

// Extrae el nombre y dirección del destinatario considerando correcciones.
export function recipientView(shipment: Shipment) {
  const cor = shipment.corrections ?? {};
  const street = cor.destination_street ?? shipment.recipient.address?.street ?? "";
  const city = cor.destination_city ?? shipment.recipient.address?.city ?? "";
  const province = cor.destination_province ?? shipment.recipient.address?.province ?? "";
  const postal = cor.destination_postal_code ?? shipment.recipient.address?.postal_code ?? "";
  return {
    name: cor.recipient_name ?? shipment.recipient.name,
    phone: cor.recipient_phone ?? shipment.recipient.phone,
    street,
    city,
    province,
    postal,
    fullAddress: [street, city, province].filter(Boolean).join(", "),
    specialInstructions: cor.special_instructions ?? shipment.special_instructions ?? "",
  };
}

export const FAILED_REASONS: { id: string; label: string }[] = [
  { id: "ausente", label: "Ausente" },
  { id: "direccion_incorrecta", label: "Dirección incorrecta" },
  { id: "sin_acceso", label: "Sin acceso" },
  { id: "otro", label: "Otro" },
];

// Motivos predefinidos cuando el destinatario rechaza activamente el envío.
export const REJECTED_REASONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "no_lo_pedi", label: "No lo pedí", icon: UserX },
  { id: "no_lo_quiero", label: "No lo quiero", icon: Ban },
  { id: "producto_danado", label: "Producto dañado", icon: PackageX },
  { id: "llego_tarde", label: "Llegó demasiado tarde", icon: Clock },
  { id: "no_coincide_pedido", label: "No coincide con el pedido", icon: ClipboardX },
  { id: "otro", label: "Otro", icon: Pencil },
];
